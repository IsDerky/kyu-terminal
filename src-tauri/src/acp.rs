//! Agentes que hablan ACP (Agent Client Protocol): Antigravity CLI (`agy acp`), Gemini CLI
//! (`gemini --acp`) o cualquier otro. JSON-RPC 2.0 por stdio, una línea por mensaje.
//!
//! Se traduce a los mismos `Evento` que Claude Code, así el panel sirve para los dos: los
//! trozos de texto son `Parcial`, las herramientas `Herramienta` / `ResultadoHerramienta`, las
//! peticiones de permiso `Permiso` y el final del turno `Fin`. Kyu no ofrece al agente ni
//! archivos ni terminales propios (capacidades a false): cada agente usa los suyos.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};
use tauri::ipc::Channel;

use crate::claude::Evento;

/// Agentes conocidos: id → (nombre para el panel, programa, argumentos).
const AGENTES: &[(&str, &str, &str, &[&str])] = &[
    ("antigravity", "Antigravity", "agy", &["acp"]),
    ("gemini", "Gemini CLI", "gemini", &["--acp"]),
];

/// Lo que espera respuesta del agente (por id de JSON-RPC).
enum Peticion {
    Inicializar,
    NuevaSesion,
    /// `session/load` de una conversación guardada.
    Cargar,
    /// `session/set_config_option`.
    Opcion,
    Turno(Instant),
}

/// Cómo empezar: seguir una conversación guardada y con qué opciones.
#[derive(Default)]
pub struct Arranque {
    pub reanudar: Option<String>,
    /// El panel ya enseña la conversación: lo que repite el agente al cargarla no se manda.
    pub callado: bool,
    /// Id de la opción → valor, para ponerlas nada más empezar.
    pub ajustes: HashMap<String, String>,
}

#[derive(Default)]
struct Estado {
    /// `sessionId` de ACP; hasta que llega, los mensajes esperan en `cola`.
    sesion: Option<String>,
    cola: Vec<Vec<Value>>,
    siguiente: u64,
    peticiones: HashMap<u64, Peticion>,
    /// Permisos sin contestar: id que ve el panel → (id de JSON-RPC, opciones del agente).
    permisos: HashMap<String, (Value, Vec<Value>)>,
    /// Herramientas ya enseñadas en el panel, y las que aún no han acabado.
    ensenadas: HashSet<String>,
    abiertas: HashSet<String>,
    /// Nombre del agente (de `initialize`), por si no dice qué modelo usa.
    agente: String,
    arranque: Arranque,
    /// Mientras llega lo que repite el agente al reanudar.
    cargando: bool,
    /// Trozos de un mensaje tuyo repetido al reanudar, hasta que llega otra cosa.
    tuyo: String,
    /// `configOptions` tal como las da el agente.
    opciones: Vec<Value>,
    /// Cambios de opción sin respuesta: los mensajes esperan a que acaben.
    ajustando: usize,
}

pub struct Sesion {
    hijo: Child,
    entrada: Arc<Mutex<ChildStdin>>,
    estado: Arc<Mutex<Estado>>,
}

/// Con `KYU_ACP_REGISTRO=1`, todo el tráfico ACP va a `%TEMP%\kyu\acp.log` (para depurar).
fn registrar(sentido: &str, linea: &str) {
    if std::env::var_os("KYU_ACP_REGISTRO").is_none() {
        return;
    }
    let ruta = std::env::temp_dir().join("kyu").join("acp.log");
    let _ = std::fs::create_dir_all(ruta.parent().expect("tiene carpeta"));
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(ruta)
    {
        let _ = writeln!(f, "{sentido} {linea}");
    }
}

fn escribir(entrada: &Mutex<ChildStdin>, v: &Value) -> Result<(), String> {
    registrar("→", &v.to_string());
    let mut e = entrada.lock().map_err(|_| "el agente no responde")?;
    writeln!(e, "{v}")
        .and_then(|_| e.flush())
        .map_err(|e| format!("el agente se ha cerrado: {e}"))
}

/// Manda una petición y apunta qué es, para saber qué hacer con la respuesta.
fn pedir(
    entrada: &Mutex<ChildStdin>,
    estado: &mut Estado,
    metodo: &str,
    params: Value,
    que: Peticion,
) -> Result<(), String> {
    estado.siguiente += 1;
    let id = estado.siguiente;
    estado.peticiones.insert(id, que);
    escribir(
        entrada,
        &json!({ "jsonrpc": "2.0", "id": id, "method": metodo, "params": params }),
    )
}

fn turno(
    entrada: &Mutex<ChildStdin>,
    estado: &mut Estado,
    sesion: &str,
    prompt: Vec<Value>,
) -> Result<(), String> {
    pedir(
        entrada,
        estado,
        "session/prompt",
        json!({ "sessionId": sesion, "prompt": prompt }),
        Peticion::Turno(Instant::now()),
    )
}

/// Programa del agente: en el PATH o donde lo deja su instalador.
fn buscar(programa: &str) -> Option<PathBuf> {
    let mut carpetas: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // El instalador de Antigravity lo deja aquí; Kyu puede tener un PATH de antes de instalarlo.
    if let Some(local) = dirs::data_local_dir() {
        carpetas.push(local.join("agy").join("bin"));
    }
    if let Some(casa) = dirs::home_dir() {
        carpetas.push(casa.join(".local").join("bin"));
        carpetas.push(casa.join(".antigravity").join("bin"));
    }
    for dir in carpetas {
        #[cfg(windows)]
        for ext in ["exe", "cmd"] {
            let p = dir.join(format!("{programa}.{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
        #[cfg(not(windows))]
        {
            let p = dir.join(programa);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Arranca el agente `agente` en `carpeta` y empieza la sesión (initialize + session/new).
pub fn abrir(
    agente: &str,
    carpeta: PathBuf,
    arranque: Arranque,
    eventos: Channel<Evento>,
) -> Result<(Sesion, String), String> {
    let (_, nombre_agente, programa, args) = AGENTES
        .iter()
        .find(|a| a.0 == agente)
        .ok_or_else(|| format!("no conozco el agente «{agente}»"))?;
    let ruta = buscar(programa).ok_or_else(|| {
        format!("no encuentro {nombre_agente} ({programa}); instálalo y vuelve a probar")
    })?;
    let es_cmd = ruta
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd"));
    let mut cmd = if es_cmd {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&ruta);
        c
    } else {
        Command::new(&ruta)
    };
    cmd.args(*args)
        .current_dir(&carpeta)
        .env("KYU_TERMINAL", env!("CARGO_PKG_VERSION"))
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
        .map_err(|e| format!("no se pudo lanzar {}: {e}", ruta.display()))?;
    let entrada = Arc::new(Mutex::new(hijo.stdin.take().ok_or("sin stdin")?));
    let salida = hijo.stdout.take().ok_or("sin stdout")?;
    let errores = hijo.stderr.take().ok_or("sin stderr")?;
    let estado = Arc::new(Mutex::new(Estado {
        agente: nombre_agente.to_string(),
        arranque,
        ..Default::default()
    }));

    // Lo que escribe por stderr es su registro: solo se enseña si se cierra sin llegar a empezar.
    let registro: Arc<Mutex<Vec<String>>> = Arc::default();
    let reg = registro.clone();
    std::thread::spawn(move || {
        for linea in BufReader::new(errores).lines().map_while(Result::ok) {
            if let Ok(mut r) = reg.lock()
                && !linea.trim().is_empty()
            {
                r.push(linea);
                if r.len() > 15 {
                    r.remove(0);
                }
            }
        }
    });

    {
        let mut e = estado.lock().map_err(|_| "estado roto")?;
        pedir(
            &entrada,
            &mut e,
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": { "readTextFile": false, "writeTextFile": false },
                    "terminal": false,
                },
                "clientInfo": { "name": "kyu", "title": "Kyu Terminal", "version": env!("CARGO_PKG_VERSION") },
            }),
            Peticion::Inicializar,
        )?;
    }

    let est = estado.clone();
    let ent = entrada.clone();
    let cwd = carpeta.to_string_lossy().to_string();
    std::thread::spawn(move || {
        for linea in BufReader::new(salida).lines().map_while(Result::ok) {
            registrar("←", &linea);
            let Ok(v) = serde_json::from_str::<Value>(&linea) else {
                continue;
            };
            let Ok(mut e) = est.lock() else { return };
            for ev in atender(&v, &mut e, &ent, &cwd) {
                if eventos.send(ev).is_err() {
                    return;
                }
            }
        }
        let empezada = est.lock().is_ok_and(|e| e.sesion.is_some());
        if !empezada {
            let r = registro.lock().map(|r| r.join("\n")).unwrap_or_default();
            let _ = eventos.send(Evento::Error {
                texto: if r.is_empty() {
                    "El agente se ha cerrado sin empezar la conversación.".into()
                } else {
                    format!("El agente se ha cerrado sin empezar la conversación:\n{r}")
                },
            });
        }
        let _ = eventos.send(Evento::Cerrado);
    });

    Ok((
        Sesion {
            hijo,
            entrada,
            estado,
        },
        nombre_agente.to_string(),
    ))
}

/// Un mensaje del agente → lo que hay que contestarle y los eventos para el panel.
fn atender(v: &Value, e: &mut Estado, entrada: &Mutex<ChildStdin>, cwd: &str) -> Vec<Evento> {
    let mut sal = Vec::new();
    let metodo = v["method"].as_str();
    let id = &v["id"];

    // Respuesta a algo nuestro.
    if metodo.is_none() && !id.is_null() {
        let Some(que) = id.as_u64().and_then(|n| e.peticiones.remove(&n)) else {
            return sal;
        };
        let error = &v["error"];
        match que {
            Peticion::Inicializar => {
                if !error.is_null() {
                    sal.push(Evento::Error {
                        texto: format!("El agente no ha arrancado: {}", mensaje(error)),
                    });
                    return sal;
                }
                if let Some(n) = v["result"]["agentInfo"]["title"]
                    .as_str()
                    .or(v["result"]["agentInfo"]["name"].as_str())
                {
                    e.agente = n.to_string();
                }
                let sabe_cargar = v["result"]["agentCapabilities"]["loadSession"] == true;
                let r = match e.arranque.reanudar.clone() {
                    Some(id) if sabe_cargar => {
                        e.cargando = true;
                        pedir(
                            entrada,
                            e,
                            "session/load",
                            json!({ "sessionId": id, "cwd": cwd, "mcpServers": [] }),
                            Peticion::Cargar,
                        )
                    }
                    _ => nueva_sesion(entrada, e, cwd),
                };
                if let Err(err) = r {
                    sal.push(Evento::Error { texto: err });
                }
            }
            Peticion::Cargar => {
                e.cargando = false;
                soltar_tuyo(e, &mut sal);
                for t in e.abiertas.drain() {
                    sal.push(Evento::ResultadoHerramienta {
                        id: t,
                        error: false,
                    });
                }
                if !error.is_null() {
                    // No se pudo seguirla (borrada, de otra versión…): se empieza otra.
                    sal.push(Evento::Error {
                        texto: format!(
                            "No se pudo reanudar la conversación ({}); sigue en una nueva.",
                            mensaje(error)
                        ),
                    });
                    sal.push(Evento::Cargada);
                    if let Err(err) = nueva_sesion(entrada, e, cwd) {
                        sal.push(Evento::Error { texto: err });
                    }
                    return sal;
                }
                let sesion = e.arranque.reanudar.clone().unwrap_or_default();
                sal.push(Evento::Cargada);
                empezar(&v["result"], sesion, e, entrada, &mut sal);
            }
            Peticion::Opcion => {
                e.ajustando = e.ajustando.saturating_sub(1);
                if !error.is_null() {
                    sal.push(Evento::Error {
                        texto: format!("No se pudo cambiar la opción: {}", mensaje(error)),
                    });
                } else if let Some(l) = v["result"]["configOptions"].as_array() {
                    e.opciones = l.clone();
                }
                avisar_opciones(e, &mut sal);
                if e.ajustando == 0 {
                    soltar_cola(e, entrada, &mut sal);
                }
            }
            Peticion::NuevaSesion => {
                if !error.is_null() {
                    // -32000 = auth_required: falta entrar con la cuenta.
                    let texto = if error["code"].as_i64() == Some(-32000) {
                        format!(
                            "{} no tiene la sesión iniciada. Pulsa «Entrar» abajo (o ejecuta `agy acp --login`) para entrar con tu cuenta de Google; luego vuelve a escribir aquí.",
                            e.agente
                        )
                    } else {
                        format!("No se pudo empezar la conversación: {}", mensaje(error))
                    };
                    sal.push(Evento::Error { texto });
                    return sal;
                }
                let r = &v["result"];
                let sesion = r["sessionId"].as_str().unwrap_or("").to_string();
                empezar(r, sesion, e, entrada, &mut sal);
            }
            Peticion::Turno(desde) => {
                let duracion = desde.elapsed().as_millis() as u64;
                let parada = v["result"]["stopReason"].as_str().unwrap_or("");
                if !error.is_null() {
                    sal.push(Evento::Error {
                        texto: mensaje(error),
                    });
                } else if parada == "refusal" {
                    sal.push(Evento::Error {
                        texto: "El agente se ha negado a seguir.".into(),
                    });
                } else if parada == "max_tokens" || parada == "max_turn_requests" {
                    sal.push(Evento::Error {
                        texto: "El agente ha llegado a su límite en este turno.".into(),
                    });
                }
                // Lo que no acabó (por parar) se da por cancelado.
                for t in e.abiertas.drain() {
                    sal.push(Evento::ResultadoHerramienta {
                        id: t,
                        error: false,
                    });
                }
                sal.push(Evento::Fin {
                    coste: 0.0,
                    error: !error.is_null() || parada == "refusal",
                    duracion,
                    resultado: None,
                });
            }
        }
        return sal;
    }

    match metodo {
        Some("session/update") => actualizar(&v["params"]["update"], e, &mut sal),
        Some("session/request_permission") => {
            let p = &v["params"];
            let tc = &p["toolCall"];
            let (herramienta, input) = como_claude(tc);
            let peticion = format!("acp-{}", id);
            e.permisos.insert(
                peticion.clone(),
                (
                    id.clone(),
                    p["options"].as_array().cloned().unwrap_or_default(),
                ),
            );
            sal.push(Evento::Permiso {
                id_peticion: peticion,
                resumen: resumen_de(tc, &herramienta, &input),
                herramienta,
                input,
            });
        }
        // Pide algo que Kyu no ofrece (archivos, terminales…): no lo tenemos.
        Some(_) if !id.is_null() => {
            let _ = escribir(
                entrada,
                &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Kyu no ofrece este método" } }),
            );
        }
        _ => {}
    }
    sal
}

fn nueva_sesion(entrada: &Mutex<ChildStdin>, e: &mut Estado, cwd: &str) -> Result<(), String> {
    pedir(
        entrada,
        e,
        "session/new",
        json!({ "cwd": cwd, "mcpServers": [] }),
        Peticion::NuevaSesion,
    )
}

/// La sesión ya existe (nueva o reanudada): opciones al panel, las elegidas antes de empezar
/// al agente y, cuando las acepte, los mensajes que esperaban.
fn empezar(
    r: &Value,
    sesion: String,
    e: &mut Estado,
    entrada: &Mutex<ChildStdin>,
    sal: &mut Vec<Evento>,
) {
    e.sesion = Some(sesion.clone());
    // Plan de la cuenta (Antigravity: «Antigravity Starter Quota»).
    if let Some(n) = r["_meta"]["antigravity"]["tier"]["name"].as_str() {
        sal.push(Evento::PlanAgente {
            nombre: n.to_string(),
            enlace: r["_meta"]["antigravity"]["tier"]["upgradeUri"]
                .as_str()
                .map(String::from),
        });
    }
    e.opciones = r["configOptions"].as_array().cloned().unwrap_or_default();
    if e.opciones.is_empty() {
        // Sin configOptions: el nombre del modelo de `models`, si lo hay.
        let actual = r["models"]["currentModelId"].as_str();
        let modelo = r["models"]["availableModels"]
            .as_array()
            .and_then(|l| l.iter().find(|m| m["modelId"].as_str() == actual))
            .and_then(|m| m["name"].as_str())
            .or(actual)
            .map(String::from)
            .unwrap_or_else(|| e.agente.clone());
        sal.push(Evento::Iniciado {
            modelo,
            sesion: sesion.clone(),
            modo: r["modes"]["currentModeId"].as_str().unwrap_or("").into(),
        });
    } else {
        avisar_opciones(e, sal);
    }
    for (clave, valor) in std::mem::take(&mut e.arranque.ajustes) {
        let Some(o) = e.opciones.iter().find(|o| o["id"] == clave.as_str()) else {
            continue;
        };
        let existe = o["options"]
            .as_array()
            .is_some_and(|l| l.iter().any(|x| x["value"] == valor.as_str()));
        if !existe || o["currentValue"] == valor.as_str() {
            continue;
        }
        match poner_opcion(entrada, e, &sesion, &clave, &valor) {
            Ok(()) => {}
            Err(err) => sal.push(Evento::Error { texto: err }),
        }
    }
    soltar_cola(e, entrada, sal);
}

fn poner_opcion(
    entrada: &Mutex<ChildStdin>,
    e: &mut Estado,
    sesion: &str,
    clave: &str,
    valor: &str,
) -> Result<(), String> {
    e.ajustando += 1;
    let r = pedir(
        entrada,
        e,
        "session/set_config_option",
        json!({ "sessionId": sesion, "configId": clave, "value": valor }),
        Peticion::Opcion,
    );
    if r.is_err() {
        e.ajustando -= 1;
    }
    r
}

/// Los mensajes en cola, si ya hay sesión y no queda ninguna opción por aplicar.
fn soltar_cola(e: &mut Estado, entrada: &Mutex<ChildStdin>, sal: &mut Vec<Evento>) {
    let Some(sesion) = e.sesion.clone() else {
        return;
    };
    if e.ajustando > 0 {
        return;
    }
    for prompt in std::mem::take(&mut e.cola) {
        if let Err(err) = turno(entrada, e, &sesion, prompt) {
            sal.push(Evento::Error { texto: err });
        }
    }
}

/// Un mensaje tuyo repetido al reanudar, ya completo.
fn soltar_tuyo(e: &mut Estado, sal: &mut Vec<Evento>) {
    let texto = std::mem::take(&mut e.tuyo);
    if !texto.is_empty() && !e.arranque.callado {
        sal.push(Evento::MensajeTuyo { texto });
    }
}

/// Opción por categoría (model, thought_level, mode) o, si no la trae, por id.
fn opcion_de<'a>(opciones: &'a [Value], cual: &str) -> Option<&'a Value> {
    opciones
        .iter()
        .find(|o| o["category"] == cual)
        .or_else(|| opciones.iter().find(|o| o["id"] == cual))
}

/// Nombre del valor actual de una opción («Gemini 4 Hydrogen», «High»).
fn nombre_actual(o: &Value) -> Option<String> {
    let actual = &o["currentValue"];
    o["options"]
        .as_array()?
        .iter()
        .find(|x| &x["value"] == actual)
        .and_then(|x| x["name"].as_str())
        .or(actual.as_str())
        .map(String::from)
}

/// Opciones al panel (con nombres en vez de ids) y el modelo y el modo que quedan.
fn avisar_opciones(e: &Estado, sal: &mut Vec<Evento>) {
    let lista: Vec<Value> = e
        .opciones
        .iter()
        .filter(|o| o["type"] == "select")
        .map(|o| {
            let valores: Vec<Value> = o["options"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|x| json!({ "valor": x["value"], "nombre": x["name"], "ayuda": x["description"] }))
                .collect();
            json!({
                "id": o["id"],
                "nombre": o["name"],
                "categoria": o["category"],
                "actual": o["currentValue"],
                "valores": valores,
            })
        })
        .collect();
    sal.push(Evento::OpcionesAgente {
        opciones: Value::Array(lista),
    });
    let modelo = opcion_de(&e.opciones, "model").and_then(nombre_actual);
    let razonamiento = opcion_de(&e.opciones, "thought_level").and_then(nombre_actual);
    let modelo = match (modelo, razonamiento) {
        (Some(m), Some(r)) => format!("{m} ({r})"),
        (Some(m), None) => m,
        _ => e.agente.clone(),
    };
    sal.push(Evento::Iniciado {
        modelo,
        sesion: e.sesion.clone().unwrap_or_default(),
        modo: opcion_de(&e.opciones, "mode")
            .and_then(|o| o["currentValue"].as_str())
            .unwrap_or("")
            .into(),
    });
}

fn mensaje(error: &Value) -> String {
    let m = error["message"].as_str().unwrap_or("error del agente");
    match error["data"].as_str() {
        Some(d) if !d.is_empty() => format!("{m} ({d})"),
        _ => m.to_string(),
    }
}

/// `session/update`: texto, razonamiento, herramientas y uso.
fn actualizar(u: &Value, e: &mut Estado, sal: &mut Vec<Evento>) {
    let texto = || u["content"]["text"].as_str().unwrap_or("").to_string();
    let tipo = u["sessionUpdate"].as_str().unwrap_or("");
    // Al reanudar, el agente repite la conversación: tus mensajes, sus respuestas y herramientas.
    if e.cargando {
        if tipo == "user_message_chunk" {
            if u["content"]["type"] == "text" {
                e.tuyo.push_str(&texto());
            }
            return;
        }
        soltar_tuyo(e, sal);
        let repetido = matches!(
            tipo,
            "agent_message_chunk"
                | "agent_thought_chunk"
                | "tool_call"
                | "tool_call_update"
                | "plan"
        );
        if repetido && e.arranque.callado {
            return;
        }
    }
    match tipo {
        "agent_message_chunk" if u["content"]["type"] == "text" => {
            sal.push(Evento::Parcial { texto: texto() })
        }
        "agent_thought_chunk" if u["content"]["type"] == "text" => {
            let t = texto();
            if !t.is_empty() {
                sal.push(Evento::ParcialRazonamiento { texto: t });
            }
        }
        tipo @ ("tool_call" | "tool_call_update") => {
            let id = u["toolCallId"].as_str().unwrap_or("").to_string();
            if id.is_empty() {
                return;
            }
            // Las actualizaciones de una que no se había visto (sin título no se sabe qué es) la crean.
            if (tipo == "tool_call" || !u["title"].is_null()) && e.ensenadas.insert(id.clone()) {
                herramienta(u, &id, e.cargando, sal);
                e.abiertas.insert(id.clone());
            }
            terminada(u, &id, e, sal);
        }
        "usage_update" => {
            if let Some(t) = u["used"].as_u64() {
                sal.push(Evento::Contexto {
                    tokens: t,
                    limite: u["size"].as_u64().filter(|n| *n > 0),
                });
            }
        }
        // Plan del agente: la lista entera cada vez.
        "plan" => {
            let l: Vec<Value> = u["entries"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|t| json!({ "texto": t["content"], "activo": Value::Null, "estado": t["status"] }))
                .collect();
            sal.push(Evento::Tareas {
                tareas: Value::Array(l),
            });
        }
        "session_info_update" => {
            if let Some(t) = u["title"].as_str().filter(|t| !t.is_empty()) {
                sal.push(Evento::Titulo { texto: t.into() });
            }
        }
        "available_commands_update" => {
            let comandos: Vec<Value> = u["availableCommands"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| {
                    let nombre = c["name"].as_str()?;
                    Some(json!({
                        "name": nombre,
                        "description": c["description"].as_str().unwrap_or(""),
                        "argumentHint": c["input"]["hint"].as_str().unwrap_or(""),
                    }))
                })
                .collect();
            sal.push(Evento::Comandos {
                comandos: Value::Array(comandos),
            });
        }
        "config_option_update" => {
            if let Some(l) = u["configOptions"].as_array() {
                e.opciones = l.clone();
                avisar_opciones(e, sal);
            }
        }
        "current_mode_update" => {
            let Some(m) = u["currentModeId"].as_str() else {
                return;
            };
            match e
                .opciones
                .iter_mut()
                .find(|o| o["category"] == "mode" || o["id"] == "mode")
            {
                Some(o) => {
                    o["currentValue"] = json!(m);
                    avisar_opciones(e, sal);
                }
                None => sal.push(Evento::Iniciado {
                    modelo: e.agente.clone(),
                    sesion: e.sesion.clone().unwrap_or_default(),
                    modo: m.into(),
                }),
            }
        }
        _ => {}
    }
}

/// `repetida`: de una conversación reanudada; ya pasó, no hay «antes» que guardar.
fn herramienta(u: &Value, id: &str, repetida: bool, sal: &mut Vec<Evento>) {
    let (nombre, input) = como_claude(u);
    let (ruta, antes, nuevo) = if repetida {
        (None, None, false)
    } else {
        crate::claude::foto_antes(&nombre, &input)
    };
    sal.push(Evento::Herramienta {
        id: id.to_string(),
        resumen: resumen_de(u, &nombre, &input),
        nombre,
        ruta,
        antes,
        nuevo,
    });
}

fn terminada(u: &Value, id: &str, e: &mut Estado, sal: &mut Vec<Evento>) {
    match u["status"].as_str() {
        Some("completed") | Some("failed") if e.abiertas.remove(id) => {
            sal.push(Evento::ResultadoHerramienta {
                id: id.to_string(),
                error: u["status"] == "failed",
            });
        }
        _ => {}
    }
}

/// Una herramienta de ACP con el nombre y la entrada que entiende el panel (los de Claude
/// Code): así salen su icono, el diff al pedir permiso y «Ver cambios».
fn como_claude(tc: &Value) -> (String, Value) {
    let titulo = tc["title"].as_str().unwrap_or("").to_string();
    let crudo = &tc["rawInput"];
    let diff = tc["content"]
        .as_array()
        .and_then(|c| c.iter().find(|x| x["type"] == "diff"));
    let ruta = diff
        .and_then(|d| d["path"].as_str())
        .or_else(|| tc["locations"][0]["path"].as_str())
        .map(ruta_local);
    match tc["kind"].as_str().unwrap_or("other") {
        "edit" | "delete" | "move" => match (diff, ruta) {
            (Some(d), Some(r)) if d["oldText"].is_null() => (
                "Write".into(),
                json!({ "file_path": r, "content": d["newText"] }),
            ),
            (Some(d), Some(r)) => (
                "Edit".into(),
                json!({ "file_path": r, "old_string": d["oldText"], "new_string": d["newText"] }),
            ),
            // Antigravity: write_file trae el contenido entero en rawInput.Content.
            (None, Some(r)) if crudo["Content"].is_string() => (
                "Write".into(),
                json!({ "file_path": r, "content": crudo["Content"] }),
            ),
            (None, Some(r)) => ("Edit".into(), json!({ "file_path": r })),
            _ => (titulo, crudo.clone()),
        },
        "execute" => {
            let orden = crudo["command"]
                .as_str()
                .or(crudo["CommandLine"].as_str())
                .or(crudo["cmd"].as_str())
                .map(String::from)
                .unwrap_or_else(|| titulo.clone());
            (
                "Bash".into(),
                json!({ "command": orden, "description": titulo }),
            )
        }
        "read" => match ruta {
            Some(r) => ("Read".into(), json!({ "file_path": r })),
            None => ("Read".into(), crudo.clone()),
        },
        "search" => ("Grep".into(), json!({ "pattern": titulo })),
        "fetch" => (
            "WebFetch".into(),
            json!({ "url": crudo["url"].as_str().unwrap_or(&titulo) }),
        ),
        _ => (
            if titulo.is_empty() {
                "Herramienta".into()
            } else {
                titulo
            },
            crudo.clone(),
        ),
    }
}

/// Antigravity manda rutas de Windows como URL sin esquema: «/C:/Users/…» → «C:\Users\…».
fn ruta_local(ruta: &str) -> String {
    let b = ruta.as_bytes();
    if b.len() > 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        return ruta[1..].replace('/', "\\");
    }
    ruta.to_string()
}

fn resumen_de(tc: &Value, nombre: &str, input: &Value) -> String {
    let r = crate::claude::resumen(nombre, input);
    if r.is_empty() || r == "null" {
        tc["title"].as_str().unwrap_or("").to_string()
    } else {
        r
    }
}

impl Sesion {
    /// Un mensaje tuyo: texto e imágenes. Si la sesión aún no existe, espera en la cola.
    pub fn enviar(&self, texto: String, imagenes: Vec<(String, String)>) -> Result<(), String> {
        let mut prompt: Vec<Value> = imagenes
            .into_iter()
            .map(|(tipo, datos)| json!({ "type": "image", "mimeType": tipo, "data": datos }))
            .collect();
        if !texto.is_empty() || prompt.is_empty() {
            prompt.push(json!({ "type": "text", "text": texto }));
        }
        let mut e = self.estado.lock().map_err(|_| "estado roto")?;
        match e.sesion.clone() {
            Some(s) if e.ajustando == 0 => turno(&self.entrada, &mut e, &s, prompt),
            _ => {
                e.cola.push(prompt);
                Ok(())
            }
        }
    }

    /// Cambia una opción (model, thought_level, mode…). Antes de tener sesión se guarda y se
    /// pone al empezar.
    pub fn opcion(&self, clave: &str, valor: &str) -> Result<(), String> {
        let mut e = self.estado.lock().map_err(|_| "estado roto")?;
        match e.sesion.clone() {
            Some(s) => poner_opcion(&self.entrada, &mut e, &s, clave, valor),
            None => {
                e.arranque.ajustes.insert(clave.into(), valor.into());
                Ok(())
            }
        }
    }

    /// «permitir», «siempre» o «denegar» → la opción del agente que más se parece.
    pub fn responder(&self, peticion: &str, respuesta: &str) -> Result<(), String> {
        let mut e = self.estado.lock().map_err(|_| "estado roto")?;
        let (id, opciones) = e
            .permisos
            .remove(peticion)
            .ok_or("ese permiso ya se contestó")?;
        let buscar = |tipos: &[&str]| {
            tipos.iter().find_map(|t| {
                opciones
                    .iter()
                    .find(|o| o["kind"] == *t)
                    .and_then(|o| o["optionId"].as_str())
            })
        };
        let elegida = match respuesta {
            "permitir" => buscar(&["allow_once", "allow_always"]),
            "siempre" => buscar(&["allow_always", "allow_once"]),
            _ => buscar(&["reject_once", "reject_always"]),
        };
        let resultado = match elegida {
            Some(o) => json!({ "outcome": { "outcome": "selected", "optionId": o } }),
            None => json!({ "outcome": { "outcome": "cancelled" } }),
        };
        escribir(
            &self.entrada,
            &json!({ "jsonrpc": "2.0", "id": id, "result": resultado }),
        )
    }

    /// Para el turno (session/cancel) y da por cancelados los permisos sin contestar.
    pub fn parar(&self) -> Result<(), String> {
        let mut e = self.estado.lock().map_err(|_| "estado roto")?;
        for (_, (id, _)) in e.permisos.drain() {
            let _ = escribir(
                &self.entrada,
                &json!({ "jsonrpc": "2.0", "id": id, "result": { "outcome": { "outcome": "cancelled" } } }),
            );
        }
        let Some(s) = e.sesion.clone() else {
            return Ok(());
        };
        escribir(
            &self.entrada,
            &json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": s } }),
        )
    }

    pub fn matar(&mut self) {
        let _ = self.hijo.kill();
    }
}

/// Ruta del programa de un agente conocido.
fn programa_de(agente: &str) -> Result<(&'static str, PathBuf), String> {
    let (_, nombre, programa, _) = AGENTES
        .iter()
        .find(|a| a.0 == agente)
        .ok_or_else(|| format!("no conozco el agente «{agente}»"))?;
    let ruta = buscar(programa).ok_or_else(|| {
        format!("no encuentro {nombre} ({programa}); instálalo y vuelve a probar")
    })?;
    Ok((nombre, ruta))
}

#[derive(serde::Serialize)]
pub struct SesionAgente {
    id: String,
    titulo: String,
    carpeta: Option<String>,
    /// Fecha ISO de la última actividad.
    fecha: Option<String>,
}

/// Conversaciones guardadas del agente (`session/list`): lo arranca un momento, pregunta y lo
/// cierra. La más reciente primero.
fn listar(agente: &str, carpeta: &str) -> Result<Vec<SesionAgente>, String> {
    let (_, ruta) = programa_de(agente)?;
    let args = AGENTES
        .iter()
        .find(|a| a.0 == agente)
        .map(|a| a.3)
        .unwrap_or(&[]);
    let mut cmd = Command::new(&ruta);
    cmd.args(args)
        .current_dir(carpeta)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut hijo = cmd.spawn().map_err(|e| e.to_string())?;
    let mut entrada = hijo.stdin.take().ok_or("sin stdin")?;
    let salida = hijo.stdout.take().ok_or("sin stdout")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for linea in BufReader::new(salida).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&linea)
                && tx.send(v).is_err()
            {
                return;
            }
        }
    });
    let mut pedir = |id: u64, metodo: &str, params: Value| {
        writeln!(
            entrada,
            "{}",
            json!({ "jsonrpc": "2.0", "id": id, "method": metodo, "params": params })
        )
        .and_then(|_| entrada.flush())
    };
    let r = (|| {
        pedir(1, "initialize", json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } }))
            .map_err(|e| e.to_string())?;
        let limite = Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let falta = limite.saturating_duration_since(Instant::now());
            let v = rx
                .recv_timeout(falta)
                .map_err(|_| "el agente no ha contestado".to_string())?;
            match v["id"].as_u64() {
                Some(1) => pedir(2, "session/list", json!({ "cwd": carpeta }))
                    .map_err(|e| e.to_string())?,
                Some(2) if !v["error"].is_null() => return Err(mensaje(&v["error"])),
                Some(2) => return Ok(v["result"]["sessions"].clone()),
                _ => {}
            }
        }
    })();
    let _ = hijo.kill();
    let mut l: Vec<SesionAgente> = r?
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| SesionAgente {
            id: s["sessionId"].as_str().unwrap_or("").to_string(),
            titulo: s["title"]
                .as_str()
                .unwrap_or("Conversación sin título")
                .to_string(),
            carpeta: s["cwd"].as_str().map(ruta_local),
            fecha: s["updatedAt"].as_str().map(String::from),
        })
        .filter(|s| !s.id.is_empty())
        .collect();
    l.sort_by(|a, b| b.fecha.cmp(&a.fecha));
    Ok(l)
}

#[tauri::command]
pub async fn acp_sesiones(agente: String, carpeta: String) -> Result<Vec<SesionAgente>, String> {
    tauri::async_runtime::spawn_blocking(move || listar(&agente, &carpeta))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre una consola con el inicio de sesión del agente (`agy acp --login`: el navegador hace el resto).
#[tauri::command]
pub fn acp_entrar(agente: String) -> Result<(), String> {
    let (_, ruta) = programa_de(&agente)?;
    let mut cmd = Command::new(&ruta);
    match agente.as_str() {
        "antigravity" => cmd.args(["acp", "--login"]),
        _ => &mut cmd,
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("no se pudo abrir el inicio de sesión: {e}"))
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn un_diff_de_acp_es_un_edit() {
        let tc: Value = serde_json::from_str(r#"{"toolCallId":"c1","title":"Editar main.rs","kind":"edit","content":[{"type":"diff","path":"C:\\x\\main.rs","oldText":"a","newText":"b"}]}"#).unwrap();
        let (n, i) = como_claude(&tc);
        assert_eq!(n, "Edit");
        assert_eq!(i["file_path"], "C:\\x\\main.rs");
        assert_eq!(i["new_string"], "b");
        let nuevo: Value = serde_json::from_str(r#"{"toolCallId":"c2","title":"Crear","kind":"edit","content":[{"type":"diff","path":"C:\\x\\n.rs","newText":"b"}]}"#).unwrap();
        assert_eq!(como_claude(&nuevo).0, "Write");
    }

    #[test]
    fn rutas_de_antigravity() {
        assert_eq!(ruta_local("/C:/Users/a/x.txt"), r"C:\Users\a\x.txt");
        assert_eq!(ruta_local("/home/a/x.txt"), "/home/a/x.txt");
        let tc: Value = serde_json::from_str(r#"{"toolCallId":"c","kind":"edit","title":"File hola.txt","locations":[{"path":"/C:/t/hola.txt"}],"rawInput":{"Content":"hola"}}"#).unwrap();
        let (n, i) = como_claude(&tc);
        assert_eq!(n, "Write");
        assert_eq!(i["file_path"], r"C:\t\hola.txt");
        assert_eq!(i["content"], "hola");
    }

    #[test]
    fn opciones_y_nombre_del_modelo() {
        let opciones: Vec<Value> = serde_json::from_str(r#"[
            {"id":"model","name":"Model","category":"model","type":"select","currentValue":"g4","options":[{"value":"g4","name":"Gemini 4"},{"value":"fl","name":"Flash"}]},
            {"id":"thought_level","name":"Thinking Level","category":"thought_level","type":"select","currentValue":"high","options":[{"value":"low","name":"Low"},{"value":"high","name":"High"}]},
            {"id":"mode","name":"Mode","category":"mode","type":"select","currentValue":"plan","options":[{"value":"default","name":"Default"},{"value":"plan","name":"Plan"}]}
        ]"#).unwrap();
        let e = Estado {
            opciones,
            sesion: Some("s1".into()),
            ..Default::default()
        };
        let mut sal = Vec::new();
        avisar_opciones(&e, &mut sal);
        match &sal[0] {
            Evento::OpcionesAgente { opciones } => {
                assert_eq!(opciones.as_array().unwrap().len(), 3);
                assert_eq!(opciones[1]["valores"][1]["nombre"], "High");
            }
            otro => panic!("{otro:?}"),
        }
        match &sal[1] {
            Evento::Iniciado {
                modelo,
                modo,
                sesion,
            } => {
                assert_eq!(modelo, "Gemini 4 (High)");
                assert_eq!(modo, "plan");
                assert_eq!(sesion, "s1");
            }
            otro => panic!("{otro:?}"),
        }
    }

    #[test]
    fn al_reanudar_se_juntan_tus_mensajes() {
        let mut e = Estado {
            cargando: true,
            ..Default::default()
        };
        let mut sal = Vec::new();
        for t in ["Hola, ", "¿qué tal?"] {
            let u = json!({ "sessionUpdate": "user_message_chunk", "content": { "type": "text", "text": t } });
            actualizar(&u, &mut e, &mut sal);
        }
        assert!(sal.is_empty());
        let u = json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Bien" } });
        actualizar(&u, &mut e, &mut sal);
        assert!(matches!(&sal[0], Evento::MensajeTuyo { texto } if texto == "Hola, ¿qué tal?"));
        assert!(matches!(&sal[1], Evento::Parcial { texto } if texto == "Bien"));
        // Callado: lo repetido no sale.
        e.arranque.callado = true;
        sal.clear();
        actualizar(&u, &mut e, &mut sal);
        assert!(sal.is_empty());
    }

    #[test]
    fn una_orden_de_acp_es_un_bash() {
        let tc: Value = serde_json::from_str(r#"{"toolCallId":"c3","title":"Listar","kind":"execute","rawInput":{"command":"ls -la"}}"#).unwrap();
        let (n, i) = como_claude(&tc);
        assert_eq!(n, "Bash");
        assert_eq!(i["command"], "ls -la");
    }
}
