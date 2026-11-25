//! Claude Code como proceso hijo en modo stream-json, uno por conversación.
//!
//! Se lanza `claude -p --input-format stream-json --output-format stream-json --verbose
//! --include-partial-messages --permission-prompt-tool stdio`: cada línea de stdout es un JSON
//! que se traduce a un `Evento` y va a la ventana por un canal de Tauri. Las peticiones de
//! permiso llegan como `control_request` / `can_use_tool` y se contestan por stdin.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    /// Llega al arrancar y al principio de cada turno (el modo puede cambiar, p. ej. al salir del plan).
    Iniciado {
        modelo: String,
        sesion: String,
        modo: String,
    },
    /// «compacting» mientras compacta; null al acabar.
    Estado {
        estado: Option<String>,
    },
    Compactado {
        antes: u64,
        despues: u64,
    },
    /// Trozo de texto mientras Claude escribe.
    Parcial {
        texto: String,
    },
    /// Bloque de texto terminado (sustituye a los parciales).
    Texto {
        texto: String,
    },
    /// Trozo del resumen de lo que va pensando (`--thinking-display summarized`).
    ParcialRazonamiento {
        texto: String,
    },
    /// Resumen del razonamiento terminado (sustituye a los parciales).
    Razonamiento {
        texto: String,
    },
    Herramienta {
        id: String,
        nombre: String,
        resumen: String,
        /// En las que cambian un archivo (Write, Edit, MultiEdit): su ruta y cómo estaba
        /// justo antes (se lee al llegar, antes de que se ejecute). `nuevo` = no existía.
        ruta: Option<String>,
        antes: Option<String>,
        nuevo: bool,
    },
    /// Herramienta que usa un subagente: `padre` es el id de la herramienta Task que lo lanzó.
    Subherramienta {
        padre: String,
        nombre: String,
        resumen: String,
    },
    /// Eco de un mensaje tuyo (`--replay-user-messages`): su uuid sirve de punto de control.
    Eco {
        uuid: String,
    },
    /// Uuid de cada pieza de la conversación (respuestas y resultados): la última antes de un
    /// mensaje tuyo es por donde se corta al volver a ese punto.
    Cadena {
        uuid: String,
    },
    ResultadoHerramienta {
        id: String,
        error: bool,
    },
    Permiso {
        #[serde(rename = "idPeticion")]
        id_peticion: String,
        herramienta: String,
        resumen: String,
        input: Value,
    },
    /// Tokens que ocupa la conversación ahora mismo.
    Contexto {
        tokens: u64,
    },
    Fin {
        coste: f64,
        error: bool,
        duracion: u64,
        /// Texto del resultado cuando no hubo turno del modelo (p. ej. «Unknown command: /x»).
        resultado: Option<String>,
    },
    Error {
        texto: String,
    },
    Cerrado,
}

struct Sesion {
    hijo: Child,
    entrada: Arc<Mutex<ChildStdin>>,
    /// Permisos sin contestar: id de la petición → (entrada, sugerencias).
    pendientes: Arc<Mutex<HashMap<String, (Value, Value)>>>,
    /// Órdenes de control de Kyu esperando respuesta: id → quien espera.
    respuestas: Esperando,
}

type Esperando = Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>>;

/// Cómo arrancar Claude: lo elegido en el panel antes del primer mensaje.
#[derive(Deserialize, Default)]
pub struct Opciones {
    modelo: Option<String>,
    modo: Option<String>,
    esfuerzo: Option<String>,
    /// Id de una conversación guardada para seguirla (`--resume`).
    reanudar: Option<String>,
    /// Con `reanudar`: seguirla solo hasta esta pieza, en una copia (`--resume-session-at`
    /// + `--fork-session`). Es «volver a este punto» de la conversación.
    #[serde(rename = "reanudarEn")]
    reanudar_en: Option<String>,
}

/// Imagen pegada o soltada en el panel: tipo MIME y datos en base64.
#[derive(Deserialize)]
pub struct Imagen {
    tipo: String,
    datos: String,
}

impl Sesion {
    fn escribir(&self, v: Value) -> Result<(), String> {
        let mut e = self.entrada.lock().map_err(|_| "Claude no responde")?;
        writeln!(e, "{v}")
            .and_then(|_| e.flush())
            .map_err(|e| format!("Claude se ha cerrado: {e}"))
    }
}

#[derive(Default)]
pub struct Claudes {
    sesiones: Mutex<HashMap<u32, Sesion>>,
    siguiente: AtomicU32,
}

/// Arranca Claude Code en `carpeta`. Los eventos llegan por `eventos`.
#[tauri::command]
pub fn claude_abrir(
    claudes: State<'_, Claudes>,
    mcp: State<'_, Option<Arc<crate::mcp::Mcp>>>,
    carpeta: Option<String>,
    opciones: Option<Opciones>,
    eventos: Channel<Evento>,
) -> Result<u32, String> {
    let opciones = opciones.unwrap_or_default();
    let config = crate::config::Config::cargar();
    let programa = buscar_programa(config.claude.as_deref()).ok_or(
        "no encuentro Claude Code (claude) en el PATH; ponlo en kyu.toml con claude = \"ruta\"",
    )?;
    let carpeta = carpeta
        .map(PathBuf::from)
        .filter(|c| c.is_dir())
        .or_else(dirs::home_dir)
        .ok_or("no hay carpeta donde arrancar Claude")?;

    let id = claudes.siguiente.fetch_add(1, Ordering::Relaxed);
    let mut cmd = Command::new(&programa);
    cmd.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        // Uuid de cada mensaje tuyo, para los puntos de control.
        "--replay-user-messages",
        // Resumen de lo que piensa (sin esto el razonamiento llega vacío).
        "--thinking-display",
        "summarized",
    ])
    .current_dir(&carpeta)
    .env("KYU_TERMINAL", env!("CARGO_PKG_VERSION"))
    // Copia de los archivos antes de cada cambio de Claude: `rewind_files` los devuelve.
    .env("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "true");
    if opciones.reanudar.is_some()
        && let Some(en) = opciones.reanudar_en.as_deref().filter(|v| !v.is_empty())
    {
        cmd.args(["--resume-session-at", en, "--fork-session"]);
    }
    for (opcion, valor) in [
        ("--model", &opciones.modelo),
        ("--permission-mode", &opciones.modo),
        ("--effort", &opciones.esfuerzo),
        ("--resume", &opciones.reanudar),
    ] {
        if let Some(v) = valor.as_deref().filter(|v| !v.is_empty()) {
            cmd.arg(opcion).arg(v);
        }
    }
    // Herramientas de Kyu (MCP propio). Leer y listar no piden permiso; ejecutar sí.
    if let Some(mcp) = mcp.inner() {
        let ruta = std::env::temp_dir()
            .join("kyu")
            .join(format!("mcp-{}-{id}.json", std::process::id()));
        let escrito = std::fs::create_dir_all(ruta.parent().expect("tiene carpeta"))
            .and_then(|_| std::fs::write(&ruta, crate::mcp::config_para(mcp, id).to_string()));
        if escrito.is_ok() {
            cmd.arg("--mcp-config").arg(&ruta).args([
                "--allowedTools",
                "mcp__kyu__leer_panel,mcp__kyu__listar_paneles",
            ]);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut hijo = cmd
        .spawn()
        .map_err(|e| format!("no se pudo lanzar {}: {e}", programa.display()))?;
    let entrada = Arc::new(Mutex::new(hijo.stdin.take().ok_or("sin stdin")?));
    let salida = hijo.stdout.take().ok_or("sin stdout")?;
    let errores = hijo.stderr.take().ok_or("sin stderr")?;
    let pendientes: Arc<Mutex<HashMap<String, (Value, Value)>>> = Arc::default();
    let respuestas: Esperando = Arc::default();

    let canal_err = eventos.clone();
    std::thread::spawn(move || {
        for linea in BufReader::new(errores).lines().map_while(Result::ok) {
            if !linea.trim().is_empty() {
                let _ = canal_err.send(Evento::Error { texto: linea });
            }
        }
    });

    let pend = pendientes.clone();
    let resp = respuestas.clone();
    std::thread::spawn(move || {
        for linea in BufReader::new(salida).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&linea) else {
                continue;
            };
            if v["type"] == "control_response" {
                let r = &v["response"];
                if let (Some(id), Ok(mut esperando)) = (r["request_id"].as_str(), resp.lock())
                    && let Some(quien) = esperando.remove(id)
                {
                    let _ = quien.send(if r["subtype"] == "success" {
                        Ok(r["response"].clone())
                    } else {
                        Err(r["error"]
                            .as_str()
                            .unwrap_or("Claude no pudo hacerlo")
                            .to_string())
                    });
                }
                continue;
            }
            if v["type"] == "control_request" && v["request"]["subtype"] == "can_use_tool" {
                let r = &v["request"];
                if let (Some(id), Ok(mut p)) = (v["request_id"].as_str(), pend.lock()) {
                    p.insert(
                        id.to_string(),
                        (r["input"].clone(), r["permission_suggestions"].clone()),
                    );
                }
            }
            for ev in traducir(&v) {
                if eventos.send(ev).is_err() {
                    return;
                }
            }
        }
        // Nadie va a contestar ya a lo que esté esperando.
        if let Ok(mut esperando) = resp.lock() {
            esperando.clear();
        }
        let _ = eventos.send(Evento::Cerrado);
    });

    claudes.sesiones.lock().map_err(|_| "estado roto")?.insert(
        id,
        Sesion {
            hijo,
            entrada,
            pendientes,
            respuestas,
        },
    );
    Ok(id)
}

static PETICION: AtomicU32 = AtomicU32::new(0);

/// Manda una orden de control (`initialize`, `set_model`, `get_context_usage`…) y espera su
/// respuesta, hasta 30 s.
#[tauri::command]
pub async fn claude_control(
    claudes: State<'_, Claudes>,
    id: u32,
    peticion: Value,
) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    let id_peticion = format!("kyu-{}", PETICION.fetch_add(1, Ordering::Relaxed));
    con_sesion(&claudes, id, |s| {
        s.respuestas
            .lock()
            .map_err(|_| "estado roto")?
            .insert(id_peticion.clone(), tx);
        s.escribir(
            json!({ "type": "control_request", "request_id": id_peticion, "request": peticion }),
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(30)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "Claude no ha contestado".to_string())?
}

fn con_sesion<T>(
    claudes: &State<'_, Claudes>,
    id: u32,
    f: impl FnOnce(&Sesion) -> Result<T, String>,
) -> Result<T, String> {
    let sesiones = claudes.sesiones.lock().map_err(|_| "estado roto")?;
    f(sesiones.get(&id).ok_or("esa conversación ya no existe")?)
}

#[tauri::command]
pub fn claude_enviar(
    claudes: State<'_, Claudes>,
    id: u32,
    texto: String,
    imagenes: Option<Vec<Imagen>>,
) -> Result<(), String> {
    let mut contenido: Vec<Value> = imagenes
        .unwrap_or_default()
        .into_iter()
        .map(|i| json!({ "type": "image", "source": { "type": "base64", "media_type": i.tipo, "data": i.datos } }))
        .collect();
    if !texto.is_empty() || contenido.is_empty() {
        contenido.push(json!({ "type": "text", "text": texto }));
    }
    con_sesion(&claudes, id, |s| {
        s.escribir(json!({ "type": "user", "message": { "role": "user", "content": contenido } }))
    })
}

/// `respuesta`: "permitir", "siempre" o "denegar". Al denegar, `mensaje` le dice a Claude
/// qué hacer en su lugar (como «No, y dile qué hacer» en `claude`). Al permitir, `modo`
/// cambia el modo de permisos a la vez (aprobar un plan: «sí, y edita sin preguntar»).
#[tauri::command]
pub fn claude_responder(
    claudes: State<'_, Claudes>,
    id: u32,
    id_peticion: String,
    respuesta: String,
    mensaje: Option<String>,
    modo: Option<String>,
) -> Result<(), String> {
    con_sesion(&claudes, id, |s| {
        let (input, sugerencias) = s
            .pendientes
            .lock()
            .map_err(|_| "estado roto")?
            .remove(&id_peticion)
            .ok_or("ese permiso ya se contestó")?;
        let cuerpo = match respuesta.as_str() {
            "permitir" => match modo {
                Some(m) => json!({
                    "behavior": "allow",
                    "updatedInput": input,
                    "updatedPermissions": [{ "type": "setMode", "mode": m, "destination": "session" }],
                }),
                None => json!({ "behavior": "allow", "updatedInput": input }),
            },
            "siempre" => json!({
                "behavior": "allow",
                "updatedInput": input,
                "updatedPermissions": sugerencias,
            }),
            _ => {
                let motivo = match mensaje.as_deref().map(str::trim) {
                    Some(m) if !m.is_empty() => format!("El usuario lo ha denegado y dice: {m}"),
                    _ => "El usuario lo ha denegado desde Kyu.".to_string(),
                };
                json!({ "behavior": "deny", "message": motivo })
            }
        };
        s.escribir(json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": id_peticion, "response": cuerpo }
        }))
    })
}

/// Para lo que esté haciendo Claude (como Esc en `claude`).
#[tauri::command]
pub fn claude_parar(claudes: State<'_, Claudes>, id: u32) -> Result<(), String> {
    con_sesion(&claudes, id, |s| {
        s.escribir(json!({
            "type": "control_request",
            "request_id": format!("kyu-{}", PETICION.fetch_add(1, Ordering::Relaxed)),
            "request": { "subtype": "interrupt" }
        }))
    })
}

#[tauri::command]
pub fn claude_cerrar(claudes: State<'_, Claudes>, id: u32) {
    if let Ok(mut sesiones) = claudes.sesiones.lock()
        && let Some(mut s) = sesiones.remove(&id)
    {
        let _ = s.hijo.kill();
    }
}

/// Al arrancar la ventana: cierra las conversaciones que quedaran de antes de recargarla.
#[tauri::command]
pub fn claude_cerrar_todas(claudes: State<'_, Claudes>) {
    if let Ok(mut sesiones) = claudes.sesiones.lock() {
        for (_, mut s) in sesiones.drain() {
            let _ = s.hijo.kill();
        }
    }
}

/// Un mensaje de stream-json → los eventos que interesan al panel.
fn traducir(v: &Value) -> Vec<Evento> {
    let tipo = v["type"].as_str().unwrap_or("");
    let texto = |v: &Value| v.as_str().unwrap_or("").to_string();
    let mut sal = Vec::new();
    match tipo {
        "system" if v["subtype"] == "init" => sal.push(Evento::Iniciado {
            modelo: texto(&v["model"]),
            sesion: texto(&v["session_id"]),
            modo: texto(&v["permissionMode"]),
        }),
        "system" if v["subtype"] == "status" => sal.push(Evento::Estado {
            estado: v["status"].as_str().map(String::from),
        }),
        "system" if v["subtype"] == "compact_boundary" => {
            let m = &v["compact_metadata"];
            sal.push(Evento::Compactado {
                antes: m["pre_tokens"].as_u64().unwrap_or(0),
                despues: m["post_tokens"].as_u64().unwrap_or(0),
            });
            sal.push(Evento::Contexto {
                tokens: m["post_tokens"].as_u64().unwrap_or(0),
            });
        }
        "stream_event" if v["parent_tool_use_id"].is_null() => {
            let ev = &v["event"];
            if ev["type"] == "content_block_delta" {
                let d = &ev["delta"];
                match (
                    d["type"].as_str(),
                    d["text"].as_str(),
                    d["thinking"].as_str(),
                ) {
                    (Some("text_delta"), Some(t), _) => {
                        sal.push(Evento::Parcial { texto: t.into() })
                    }
                    (Some("thinking_delta"), _, Some(t)) if !t.is_empty() => {
                        sal.push(Evento::ParcialRazonamiento { texto: t.into() })
                    }
                    _ => {}
                }
            }
        }
        // Mensajes de los subagentes: solo las herramientas que usan, bajo la Task que los lanzó.
        "assistant" if !v["parent_tool_use_id"].is_null() => {
            let padre = texto(&v["parent_tool_use_id"]);
            for bloque in v["message"]["content"].as_array().into_iter().flatten() {
                if bloque["type"] == "tool_use" {
                    let nombre = texto(&bloque["name"]);
                    sal.push(Evento::Subherramienta {
                        padre: padre.clone(),
                        resumen: resumen(&nombre, &bloque["input"]),
                        nombre,
                    });
                }
            }
        }
        "assistant" => {
            if let Some(u) = v["uuid"].as_str() {
                sal.push(Evento::Cadena { uuid: u.into() });
            }
            let uso = &v["message"]["usage"];
            let tokens = [
                "input_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            ]
            .iter()
            .filter_map(|k| uso[*k].as_u64())
            .sum::<u64>();
            if tokens > 0 {
                sal.push(Evento::Contexto { tokens });
            }
            for bloque in v["message"]["content"].as_array().into_iter().flatten() {
                match bloque["type"].as_str() {
                    Some("text") => sal.push(Evento::Texto {
                        texto: texto(&bloque["text"]),
                    }),
                    Some("thinking") => {
                        let t = texto(&bloque["thinking"]);
                        if !t.trim().is_empty() {
                            sal.push(Evento::Razonamiento { texto: t });
                        }
                    }
                    Some("tool_use") => {
                        let nombre = texto(&bloque["name"]);
                        let (ruta, antes, nuevo) = foto_antes(&nombre, &bloque["input"]);
                        sal.push(Evento::Herramienta {
                            id: texto(&bloque["id"]),
                            resumen: resumen(&nombre, &bloque["input"]),
                            nombre,
                            ruta,
                            antes,
                            nuevo,
                        })
                    }
                    _ => {}
                }
            }
        }
        "user" if v["parent_tool_use_id"].is_null() => {
            if let Some(u) = v["uuid"].as_str() {
                sal.push(if v["isReplay"].as_bool() == Some(true) {
                    Evento::Eco { uuid: u.into() }
                } else {
                    Evento::Cadena { uuid: u.into() }
                });
            }
            for bloque in v["message"]["content"].as_array().into_iter().flatten() {
                if bloque["type"] == "tool_result" {
                    sal.push(Evento::ResultadoHerramienta {
                        id: texto(&bloque["tool_use_id"]),
                        error: bloque["is_error"].as_bool().unwrap_or(false),
                    });
                }
            }
        }
        "control_request" if v["request"]["subtype"] == "can_use_tool" => {
            let r = &v["request"];
            let herramienta = texto(&r["tool_name"]);
            sal.push(Evento::Permiso {
                id_peticion: texto(&v["request_id"]),
                resumen: resumen(&herramienta, &r["input"]),
                herramienta,
                input: r["input"].clone(),
            });
        }
        "result" => sal.push(Evento::Fin {
            coste: v["total_cost_usd"].as_f64().unwrap_or(0.0),
            error: v["is_error"].as_bool().unwrap_or(false),
            duracion: v["duration_ms"].as_u64().unwrap_or(0),
            resultado: (v["num_turns"].as_u64() == Some(0))
                .then(|| texto(&v["result"]))
                .filter(|t| !t.is_empty()),
        }),
        _ => {}
    }
    sal
}

/// Cómo estaba el archivo que va a cambiar una herramienta, para enseñar luego el diff:
/// (ruta, contenido, no existía). Sin ruta si la herramienta no cambia archivos o el archivo
/// no es de texto o pasa de 4 MB.
fn foto_antes(herramienta: &str, input: &Value) -> (Option<String>, Option<String>, bool) {
    if !matches!(herramienta, "Write" | "Edit" | "MultiEdit") {
        return (None, None, false);
    }
    let Some(ruta) = input["file_path"].as_str().filter(|r| !r.is_empty()) else {
        return (None, None, false);
    };
    let p = std::path::Path::new(ruta);
    if !p.exists() {
        return (Some(ruta.to_string()), None, true);
    }
    let texto = std::fs::metadata(p)
        .ok()
        .filter(|m| m.is_file() && m.len() <= 4 * 1024 * 1024)
        .and_then(|_| std::fs::read(p).ok())
        .and_then(|b| String::from_utf8(b).ok());
    match texto {
        Some(t) => (Some(ruta.to_string()), Some(t), false),
        None => (None, None, false),
    }
}

/// Lo más útil de la entrada de cada herramienta, en una línea.
pub(crate) fn resumen(herramienta: &str, input: &Value) -> String {
    let campo = match herramienta {
        "Bash" | "PowerShell" => "command",
        "mcp__kyu__ejecutar_en_panel" => "orden",
        "mcp__kyu__leer_panel" => "panel",
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => "file_path",
        "Grep" | "Glob" => "pattern",
        "WebFetch" => "url",
        "WebSearch" => "query",
        "Agent" | "Task" => "description",
        "Skill" => "skill",
        "ToolSearch" => "query",
        _ => "",
    };
    if input.as_object().is_some_and(|o| o.is_empty()) {
        return String::new();
    }
    input[campo]
        .as_str()
        .map(|s| {
            s.trim_start_matches("select:")
                .replace("mcp__kyu__", "kyu: ")
        })
        .unwrap_or_else(|| {
            let s = input.to_string();
            if s.len() > 80 {
                format!("{}…", &s[..s.floor_char_boundary(80)])
            } else {
                s
            }
        })
}

/// Busca el ejecutable de Claude Code. En Windows, si solo está `claude.cmd` de npm, usa el
/// `claude.exe` que hay dentro del paquete.
pub(crate) fn buscar_programa(configurado: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = configurado {
        return Some(PathBuf::from(p));
    }
    let mut carpetas: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // El instalador nativo lo deja aquí, y puede que no esté en el PATH de Kyu.
    if let Some(casa) = dirs::home_dir() {
        carpetas.push(casa.join(".local").join("bin"));
    }
    for dir in carpetas {
        #[cfg(windows)]
        {
            let exe = dir.join("claude.exe");
            if exe.is_file() {
                return Some(exe);
            }
            if dir.join("claude.cmd").is_file() {
                let interno = dir.join(r"node_modules\@anthropic-ai\claude-code\bin\claude.exe");
                if interno.is_file() {
                    return Some(interno);
                }
            }
        }
        #[cfg(not(windows))]
        {
            let p = dir.join("claude");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}
