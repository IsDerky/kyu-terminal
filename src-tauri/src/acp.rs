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
    Turno(Instant),
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
                if let Err(err) = pedir(
                    entrada,
                    e,
                    "session/new",
                    json!({ "cwd": cwd, "mcpServers": [] }),
                    Peticion::NuevaSesion,
                ) {
                    sal.push(Evento::Error { texto: err });
                }
            }
            Peticion::NuevaSesion => {
                if !error.is_null() {
                    // -32000 = auth_required: falta entrar con la cuenta.
                    let texto = if error["code"].as_i64() == Some(-32000) {
                        format!(
                            "{} no tiene la sesión iniciada. Abre una terminal y ejecuta `agy acp --login` para entrar con tu cuenta de Google; luego vuelve a escribir aquí.",
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
                // El nombre del modelo en uso («Gemini 4 Hydrogen (High)»), no su id.
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
                e.sesion = Some(sesion.clone());
                for prompt in std::mem::take(&mut e.cola) {
                    if let Err(err) = turno(entrada, e, &sesion, prompt) {
                        sal.push(Evento::Error { texto: err });
                    }
                }
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
    match u["sessionUpdate"].as_str().unwrap_or("") {
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
                herramienta(u, &id, sal);
                e.abiertas.insert(id.clone());
            }
            terminada(u, &id, e, sal);
        }
        "usage_update" => {
            if let Some(t) = u["used"].as_u64() {
                sal.push(Evento::Contexto { tokens: t });
            }
        }
        _ => {}
    }
}

fn herramienta(u: &Value, id: &str, sal: &mut Vec<Evento>) {
    let (nombre, input) = como_claude(u);
    let (ruta, antes, nuevo) = crate::claude::foto_antes(&nombre, &input);
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
            Some(s) => turno(&self.entrada, &mut e, &s, prompt),
            None => {
                e.cola.push(prompt);
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
    fn una_orden_de_acp_es_un_bash() {
        let tc: Value = serde_json::from_str(r#"{"toolCallId":"c3","title":"Listar","kind":"execute","rawInput":{"command":"ls -la"}}"#).unwrap();
        let (n, i) = como_claude(&tc);
        assert_eq!(n, "Bash");
        assert_eq!(i["command"], "ls -la");
    }
}
