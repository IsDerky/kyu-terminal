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
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    Iniciado {
        modelo: String,
        sesion: String,
    },
    /// Trozo de texto mientras Claude escribe.
    Parcial { texto: String },
    /// Bloque de texto terminado (sustituye a los parciales).
    Texto { texto: String },
    Herramienta {
        id: String,
        nombre: String,
        resumen: String,
    },
    ResultadoHerramienta { id: String, error: bool },
    Permiso {
        #[serde(rename = "idPeticion")]
        id_peticion: String,
        herramienta: String,
        resumen: String,
        input: Value,
    },
    /// Tokens que ocupa la conversación ahora mismo.
    Contexto { tokens: u64 },
    Fin {
        coste: f64,
        error: bool,
        duracion: u64,
    },
    Error { texto: String },
    Cerrado,
}

struct Sesion {
    hijo: Child,
    entrada: Arc<Mutex<ChildStdin>>,
    /// Permisos sin contestar: id de la petición → (entrada, sugerencias).
    pendientes: Arc<Mutex<HashMap<String, (Value, Value)>>>,
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
    eventos: Channel<Evento>,
) -> Result<u32, String> {
    let config = crate::config::Config::cargar();
    let programa = buscar_programa(config.claude.as_deref())
        .ok_or("no encuentro Claude Code (claude) en el PATH; ponlo en kyu.toml con claude = \"ruta\"")?;
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
    ])
    .current_dir(&carpeta)
    .env("KYU_TERMINAL", env!("CARGO_PKG_VERSION"));
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
    cmd
    .stdin(Stdio::piped())
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

    let canal_err = eventos.clone();
    std::thread::spawn(move || {
        for linea in BufReader::new(errores).lines().map_while(Result::ok) {
            if !linea.trim().is_empty() {
                let _ = canal_err.send(Evento::Error { texto: linea });
            }
        }
    });

    let pend = pendientes.clone();
    std::thread::spawn(move || {
        for linea in BufReader::new(salida).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&linea) else {
                continue;
            };
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
        let _ = eventos.send(Evento::Cerrado);
    });

    claudes.sesiones.lock().map_err(|_| "estado roto")?.insert(
        id,
        Sesion {
            hijo,
            entrada,
            pendientes,
        },
    );
    Ok(id)
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
pub fn claude_enviar(claudes: State<'_, Claudes>, id: u32, texto: String) -> Result<(), String> {
    con_sesion(&claudes, id, |s| {
        s.escribir(json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": texto }] }
        }))
    })
}

/// `respuesta`: "permitir", "siempre" o "denegar". Al denegar, `mensaje` le dice a Claude
/// qué hacer en su lugar (como «No, y dile qué hacer» en `claude`).
#[tauri::command]
pub fn claude_responder(
    claudes: State<'_, Claudes>,
    id: u32,
    id_peticion: String,
    respuesta: String,
    mensaje: Option<String>,
) -> Result<(), String> {
    con_sesion(&claudes, id, |s| {
        let (input, sugerencias) = s
            .pendientes
            .lock()
            .map_err(|_| "estado roto")?
            .remove(&id_peticion)
            .ok_or("ese permiso ya se contestó")?;
        let cuerpo = match respuesta.as_str() {
            "permitir" => json!({ "behavior": "allow", "updatedInput": input }),
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
    static PETICION: AtomicU32 = AtomicU32::new(0);
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
        }),
        "stream_event" => {
            let ev = &v["event"];
            if ev["type"] == "content_block_delta"
                && ev["delta"]["type"] == "text_delta"
                && let Some(t) = ev["delta"]["text"].as_str()
            {
                sal.push(Evento::Parcial { texto: t.into() });
            }
        }
        // Mensajes de los subagentes: no van al panel.
        "assistant" if v["parent_tool_use_id"].is_null() => {
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
                    Some("tool_use") => {
                        let nombre = texto(&bloque["name"]);
                        sal.push(Evento::Herramienta {
                            id: texto(&bloque["id"]),
                            resumen: resumen(&nombre, &bloque["input"]),
                            nombre,
                        })
                    }
                    _ => {}
                }
            }
        }
        "user" => {
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
        }),
        _ => {}
    }
    sal
}

/// Lo más útil de la entrada de cada herramienta, en una línea.
fn resumen(herramienta: &str, input: &Value) -> String {
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
        .map(|s| s.trim_start_matches("select:").replace("mcp__kyu__", "kyu: "))
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
