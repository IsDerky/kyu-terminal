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
    /// Tokens que ocupa la conversación ahora mismo. `limite`: el tamaño de la ventana, si el
    /// agente lo dice (los de ACP; Claude lo da en el desglose).
    Contexto {
        tokens: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        limite: Option<u64>,
    },
    /// Opciones de un agente ACP (modelo, razonamiento, modo…) con su valor actual. Llega al
    /// empezar y cada vez que cambia alguna.
    OpcionesAgente {
        opciones: Value,
    },
    /// Comandos con barra de un agente ACP, con la forma de los de Claude (name, description).
    Comandos {
        comandos: Value,
    },
    /// Un mensaje tuyo de una conversación de ACP que se está reanudando (lo repite el agente).
    MensajeTuyo {
        texto: String,
    },
    /// La conversación de ACP reanudada ya está cargada: se puede escribir.
    Cargada,
    /// Título de la conversación (lo pone el agente ACP o lo genera Claude Code).
    Titulo {
        texto: String,
    },
    /// Plan o cuota de la cuenta del agente ACP («Antigravity Starter Quota») y dónde mejorarlo.
    PlanAgente {
        nombre: String,
        enlace: Option<String>,
    },
    /// Lista de tareas del agente (TodoWrite de Claude, `plan` de ACP), entera cada vez:
    /// [{texto, activo, estado: pending|in_progress|completed}].
    Tareas {
        tareas: Value,
    },
    /// TaskCreate (Claude Code 2.1): una tarea nueva; su id llega luego con `TareaId`.
    TareaNueva {
        herramienta: String,
        texto: String,
        activo: Option<String>,
    },
    /// El id que Claude Code le dio a la tarea creada por esa herramienta.
    TareaId {
        herramienta: String,
        id: String,
    },
    /// TaskUpdate: lo que cambia de una tarea (estado «deleted» = quitarla).
    TareaCambio {
        id: String,
        estado: Option<String>,
        texto: Option<String>,
        activo: Option<String>,
    },
    /// Lo que corre en segundo plano ahora (`background_tasks_changed`), la lista entera:
    /// [{id, tipo, descripcion}].
    SegundoPlano {
        tareas: Value,
    },
    /// Algo empieza en segundo plano; `herramienta` = la que lo lanzó (Bash, Agent…).
    TareaFondo {
        id: String,
        herramienta: Option<String>,
        descripcion: String,
    },
    /// Algo en segundo plano ha acabado: completed, failed, killed… y dónde está su salida.
    TareaFondoFin {
        id: String,
        herramienta: Option<String>,
        estado: String,
        salida: Option<String>,
    },
    /// Uso de la cuenta (`rate_limit_event`): sesión de 5 h y semana, de 0 a 1, y cuándo se
    /// reinician (segundos Unix). `estado`: allowed, allowed_warning o rejected.
    Limite {
        estado: String,
        sesion: Option<Ventana>,
        semana: Option<Ventana>,
    },
    /// Lo que Claude Code cree que vas a escribir ahora (`--prompt-suggestions`). Llega tras
    /// el turno, a partir del segundo.
    Sugerencia {
        texto: String,
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

#[derive(Serialize, Clone, Debug)]
pub struct Ventana {
    uso: f64,
    reinicio: u64,
    estado: String,
}

impl Ventana {
    fn de(v: &Value) -> Option<Self> {
        Some(Self {
            uso: v["utilization"].as_f64()?,
            reinicio: v["resetsAt"].as_u64().unwrap_or(0),
            estado: v["status"].as_str().unwrap_or("allowed").to_string(),
        })
    }
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
    /// Cuenta de kyu.toml (`cuentas_claude`); sin poner = la de siempre.
    cuenta: Option<String>,
    /// Otro agente por ACP en vez de Claude Code («antigravity»).
    agente: Option<String>,
    /// ACP: opciones elegidas antes de empezar (id de la opción → valor), p. ej. model o mode.
    ajustes: Option<HashMap<String, String>>,
    /// ACP con `reanudar`: el panel ya tiene la conversación, no hace falta que la repita.
    callado: Option<bool>,
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
    /// Conversaciones con otro agente (ACP): mismos ids, mismos comandos.
    acp: Mutex<HashMap<u32, crate::acp::Sesion>>,
    siguiente: AtomicU32,
}

/// Si `id` es de un agente ACP, le hace `f`; si no, None (es de Claude).
fn con_acp<T>(
    claudes: &State<'_, Claudes>,
    id: u32,
    f: impl FnOnce(&mut crate::acp::Sesion) -> Result<T, String>,
) -> Option<Result<T, String>> {
    let mut acp = claudes.acp.lock().ok()?;
    acp.get_mut(&id).map(f)
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
    let carpeta = carpeta
        .map(PathBuf::from)
        .filter(|c| c.is_dir())
        .or_else(dirs::home_dir)
        .ok_or("no hay carpeta donde arrancar Claude")?;
    let id = claudes.siguiente.fetch_add(1, Ordering::Relaxed);
    if let Some(agente) = opciones.agente.as_deref().filter(|a| !a.is_empty()) {
        let (sesion, _) = crate::acp::abrir(
            agente,
            carpeta,
            crate::acp::Arranque {
                reanudar: opciones.reanudar.clone().filter(|v| !v.is_empty()),
                callado: opciones.callado.unwrap_or(false),
                ajustes: opciones.ajustes.clone().unwrap_or_default(),
                cuenta: opciones.cuenta.clone(),
            },
            eventos,
        )?;
        claudes
            .acp
            .lock()
            .map_err(|_| "estado roto")?
            .insert(id, sesion);
        return Ok(id);
    }
    let config = crate::config::Config::cargar();
    let programa = buscar_programa(config.claude.as_deref()).ok_or(
        "no encuentro Claude Code (claude) en el PATH; ponlo en kyu.toml con claude = \"ruta\"",
    )?;

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
    if let Some(cuenta) = crate::cuentas::buscar(&config, opciones.cuenta.as_deref())
        && !cuenta.principal
    {
        crate::cuentas::preparar(&cuenta)?;
        cmd.env("CLAUDE_CONFIG_DIR", &cuenta.carpeta);
    }
    if config.sugerencias_claude() {
        cmd.arg("--prompt-suggestions");
    }
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
    if let Some(r) = con_acp(&claudes, id, |_| Ok(())) {
        r?;
        return Err("esto solo se puede con Claude".into());
    }
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
    if let Some(r) = con_acp(&claudes, id, |s| {
        let imgs = imagenes
            .as_ref()
            .map(|v| {
                v.iter()
                    .map(|i| (i.tipo.clone(), i.datos.clone()))
                    .collect()
            })
            .unwrap_or_default();
        s.enviar(texto.clone(), imgs)
    }) {
        return r;
    }
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
/// `respuestas`: lo elegido en un AskUserQuestion ({pregunta: etiqueta}); va en
/// `updatedInput.answers`, que es de donde lo lee Claude.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn claude_responder(
    claudes: State<'_, Claudes>,
    id: u32,
    id_peticion: String,
    respuesta: String,
    mensaje: Option<String>,
    modo: Option<String>,
    respuestas: Option<Value>,
) -> Result<(), String> {
    if let Some(r) = con_acp(&claudes, id, |s| s.responder(&id_peticion, &respuesta)) {
        return r;
    }
    con_sesion(&claudes, id, |s| {
        let (mut input, sugerencias) = s
            .pendientes
            .lock()
            .map_err(|_| "estado roto")?
            .remove(&id_peticion)
            .ok_or("ese permiso ya se contestó")?;
        if let (Some(r), Some(obj)) = (respuestas, input.as_object_mut()) {
            obj.insert("answers".into(), r);
        }
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

/// Cambia una opción de un agente ACP (`session/set_config_option`): modelo, razonamiento, modo.
#[tauri::command]
pub fn claude_opcion(
    claudes: State<'_, Claudes>,
    id: u32,
    clave: String,
    valor: String,
) -> Result<(), String> {
    con_acp(&claudes, id, |s| s.opcion(&clave, &valor))
        .unwrap_or_else(|| Err("esto solo se puede con otros agentes".into()))
}

/// Para lo que esté haciendo Claude (como Esc en `claude`).
#[tauri::command]
pub fn claude_parar(claudes: State<'_, Claudes>, id: u32) -> Result<(), String> {
    if let Some(r) = con_acp(&claudes, id, |s| s.parar()) {
        return r;
    }
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
    if let Ok(mut acp) = claudes.acp.lock()
        && let Some(mut s) = acp.remove(&id)
    {
        s.matar();
    }
    if let Ok(mut sesiones) = claudes.sesiones.lock()
        && let Some(mut s) = sesiones.remove(&id)
    {
        let _ = s.hijo.kill();
    }
}

/// Al arrancar la ventana: cierra las conversaciones que quedaran de antes de recargarla.
#[tauri::command]
pub fn claude_cerrar_todas(claudes: State<'_, Claudes>) {
    if let Ok(mut acp) = claudes.acp.lock() {
        for (_, mut s) in acp.drain() {
            s.matar();
        }
    }
    if let Ok(mut sesiones) = claudes.sesiones.lock() {
        for (_, mut s) in sesiones.drain() {
            let _ = s.hijo.kill();
        }
    }
}

/// «Task #3 created successfully: …» (resultado de TaskCreate) → «3».
fn id_tarea_creada(contenido: &Value) -> Option<String> {
    let t = match contenido {
        Value::String(s) => s.as_str(),
        Value::Array(l) => l.iter().find_map(|b| b["text"].as_str())?,
        _ => return None,
    };
    let resto = t.strip_prefix("Task #")?;
    let id: String = resto.chars().take_while(char::is_ascii_digit).collect();
    (!id.is_empty() && resto[id.len()..].starts_with(" created")).then_some(id)
}

/// La entrada de TodoWrite → [{texto, activo, estado}].
fn tareas_de_todo(input: &Value) -> Value {
    let l: Vec<Value> = input["todos"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| json!({ "texto": t["content"], "activo": t["activeForm"], "estado": t["status"] }))
        .collect();
    Value::Array(l)
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
        "system" if v["subtype"] == "background_tasks_changed" => {
            let tareas: Vec<Value> = v["tasks"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|t| json!({ "id": t["task_id"], "tipo": t["task_type"], "descripcion": t["description"] }))
                .collect();
            sal.push(Evento::SegundoPlano {
                tareas: Value::Array(tareas),
            });
        }
        "system" if v["subtype"] == "task_started" && v["is_backgrounded"] != false => {
            sal.push(Evento::TareaFondo {
                id: texto(&v["task_id"]),
                herramienta: v["tool_use_id"].as_str().map(String::from),
                descripcion: texto(&v["description"]),
            })
        }
        "system" if v["subtype"] == "task_notification" => sal.push(Evento::TareaFondoFin {
            id: texto(&v["task_id"]),
            herramienta: v["tool_use_id"].as_str().map(String::from),
            estado: texto(&v["status"]),
            salida: v["output_file"].as_str().map(String::from),
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
                limite: None,
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
                sal.push(Evento::Contexto {
                    tokens,
                    limite: None,
                });
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
                        let input = &bloque["input"];
                        let cadena = |k: &str| input[k].as_str().map(String::from);
                        match nombre.as_str() {
                            "TodoWrite" => sal.push(Evento::Tareas {
                                tareas: tareas_de_todo(input),
                            }),
                            "TaskCreate" => sal.push(Evento::TareaNueva {
                                herramienta: texto(&bloque["id"]),
                                texto: cadena("subject").unwrap_or_default(),
                                activo: cadena("activeForm"),
                            }),
                            "TaskUpdate" => sal.push(Evento::TareaCambio {
                                // A veces llega como número.
                                id: match &input["taskId"] {
                                    Value::String(s) => s.clone(),
                                    otro => otro.to_string(),
                                },
                                estado: cadena("status"),
                                texto: cadena("subject"),
                                activo: cadena("activeForm"),
                            }),
                            _ => {}
                        }
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
                    if let Some(id) = id_tarea_creada(&bloque["content"]) {
                        sal.push(Evento::TareaId {
                            herramienta: texto(&bloque["tool_use_id"]),
                            id,
                        });
                    }
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
        "rate_limit_event" => {
            let info = &v["rate_limit_info"];
            let ventanas = &info["unifiedWindows"];
            sal.push(Evento::Limite {
                estado: info["status"].as_str().unwrap_or("allowed").to_string(),
                sesion: Ventana::de(&ventanas["five_hour"]),
                semana: Ventana::de(&ventanas["seven_day"]),
            });
        }
        "prompt_suggestion" => {
            let t = texto(&v["suggestion"]);
            if !t.trim().is_empty() {
                sal.push(Evento::Sugerencia { texto: t });
            }
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
pub(crate) fn foto_antes(
    herramienta: &str,
    input: &Value,
) -> (Option<String>, Option<String>, bool) {
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

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn id_de_la_tarea_creada() {
        assert_eq!(
            id_tarea_creada(&json!("Task #12 created successfully: Hola")).as_deref(),
            Some("12")
        );
        assert_eq!(
            id_tarea_creada(
                &json!([{ "type": "text", "text": "Task #3 created successfully: x" }])
            )
            .as_deref(),
            Some("3")
        );
        assert_eq!(id_tarea_creada(&json!("Task #3 updated")), None);
    }

    #[test]
    fn lee_el_limite_de_la_cuenta() {
        let v: Value = serde_json::from_str(r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1795584600,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.31,"resetsAt":1795584600,"status":"allowed"},"seven_day":{"utilization":0.04,"resetsAt":1796133600,"status":"allowed"}}}}"#).unwrap();
        let ev = traducir(&v);
        let Some(Evento::Limite {
            estado,
            sesion: Some(s),
            semana: Some(w),
        }) = ev.first()
        else {
            panic!("no es un límite: {ev:?}");
        };
        assert_eq!(estado, "allowed");
        assert_eq!((s.uso, s.reinicio), (0.31, 1795584600));
        assert_eq!(w.uso, 0.04);
    }
}
