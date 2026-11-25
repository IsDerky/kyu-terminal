//! Servidor MCP de Kyu para el Claude del panel: le da herramientas sobre los terminales
//! de Kyu (ejecutar una orden en un panel visible, leer un panel, listar los paneles).
//!
//! Va por HTTP en 127.0.0.1 (puerto libre al azar) con una clave por arranque de Kyu;
//! cada Claude se conecta a `/mcp/<id>` para que Kyu sepa de qué conversación (y de qué
//! espacio) es cada llamada. El servidor solo traduce: el trabajo lo hace la ventana,
//! que recibe el evento `mcp:llamada` y contesta con `mcp_responder`.

use serde_json::{Value, json};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct Mcp {
    pub puerto: u16,
    pub clave: String,
    pendientes: Mutex<HashMap<u64, mpsc::Sender<Respuesta>>>,
    siguiente: AtomicU64,
}

struct Respuesta {
    texto: String,
    error: bool,
}

/// Espera máxima de una llamada (la de ejecutar puede pedir hasta 10 min).
const ESPERA_MAXIMA: Duration = Duration::from_secs(11 * 60);

fn clave_al_azar() -> String {
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default(),
    );
    h.write_u32(std::process::id());
    let a = h.finish();
    let mut h2 = std::collections::hash_map::RandomState::new().build_hasher();
    h2.write_u64(a);
    format!("{a:016x}{:016x}", h2.finish())
}

/// Arranca el servidor en un hilo. None si no se pudo abrir el puerto (Kyu sigue sin MCP).
pub fn arrancar(app: AppHandle) -> Option<Arc<Mcp>> {
    let servidor = tiny_http::Server::http("127.0.0.1:0").ok()?;
    let puerto = servidor.server_addr().to_ip()?.port();
    let mcp = Arc::new(Mcp {
        puerto,
        clave: clave_al_azar(),
        pendientes: Mutex::default(),
        siguiente: AtomicU64::new(1),
    });
    let estado = mcp.clone();
    std::thread::spawn(move || {
        for peticion in servidor.incoming_requests() {
            let estado = estado.clone();
            let app = app.clone();
            // Cada petición en su hilo: ejecutar una orden puede tardar minutos.
            std::thread::spawn(move || atender(&estado, &app, peticion));
        }
    });
    Some(mcp)
}

fn responder(peticion: tiny_http::Request, codigo: u16, cuerpo: Option<Value>) {
    let mut r = match cuerpo {
        Some(v) => tiny_http::Response::from_string(v.to_string()).with_header(
            "Content-Type: application/json"
                .parse::<tiny_http::Header>()
                .expect("cabecera fija"),
        ),
        None => tiny_http::Response::from_string(String::new()),
    };
    r = r.with_status_code(codigo);
    let _ = peticion.respond(r);
}

fn atender(mcp: &Mcp, app: &AppHandle, mut peticion: tiny_http::Request) {
    let autorizado = peticion.headers().iter().any(|h| {
        h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {}", mcp.clave)
    });
    let claude: Option<u32> = peticion
        .url()
        .strip_prefix("/mcp/")
        .and_then(|r| r.split(['/', '?']).next())
        .and_then(|r| r.parse().ok());
    let (true, Some(claude)) = (autorizado, claude) else {
        return responder(peticion, 401, None);
    };
    match peticion.method() {
        tiny_http::Method::Post => {}
        // Sin flujo SSE del servidor ni sesiones: solo peticiones y respuestas.
        tiny_http::Method::Delete => return responder(peticion, 200, None),
        _ => return responder(peticion, 405, None),
    }
    let mut cuerpo = String::new();
    if peticion.as_reader().read_to_string(&mut cuerpo).is_err() {
        return responder(peticion, 400, None);
    }
    let Ok(msg) = serde_json::from_str::<Value>(&cuerpo) else {
        return responder(peticion, 400, None);
    };
    // Notificaciones (sin id): se aceptan y ya.
    let Some(id) = msg.get("id").cloned() else {
        return responder(peticion, 202, None);
    };
    let resultado = match msg["method"].as_str().unwrap_or_default() {
        "initialize" => Ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "kyu", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Estás dentro de Kyu Terminal. Con estas herramientas puedes ver los terminales del usuario (listar_paneles, leer_panel) y ejecutar órdenes en un panel visible llamado «Claude» (ejecutar_en_panel), que el usuario ve en directo. Úsalo para órdenes largas o que el usuario quiera ver (servidores de desarrollo, compilaciones, pruebas)."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": herramientas() })),
        "tools/call" => {
            let nombre = msg["params"]["name"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let argumentos = msg["params"]["arguments"].clone();
            let r = llamar(mcp, app, claude, &nombre, argumentos);
            Ok(json!({
                "content": [{ "type": "text", "text": r.texto }],
                "isError": r.error,
            }))
        }
        otro => Err(json!({ "code": -32601, "message": format!("método desconocido: {otro}") })),
    };
    let respuesta = match resultado {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    };
    responder(peticion, 200, Some(respuesta));
}

/// Pasa la llamada a la ventana y espera su respuesta.
fn llamar(
    mcp: &Mcp,
    app: &AppHandle,
    claude: u32,
    herramienta: &str,
    argumentos: Value,
) -> Respuesta {
    let id = mcp.siguiente.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    if let Ok(mut p) = mcp.pendientes.lock() {
        p.insert(id, tx);
    }
    let enviado = app.emit(
        "mcp:llamada",
        json!({ "id": id, "claude": claude, "herramienta": herramienta, "argumentos": argumentos }),
    );
    let r = match enviado {
        Ok(()) => rx.recv_timeout(ESPERA_MAXIMA).unwrap_or(Respuesta {
            texto: "Kyu no ha contestado a tiempo.".into(),
            error: true,
        }),
        Err(e) => Respuesta {
            texto: format!("no se pudo avisar a la ventana de Kyu: {e}"),
            error: true,
        },
    };
    if let Ok(mut p) = mcp.pendientes.lock() {
        p.remove(&id);
    }
    r
}

/// La ventana contesta a una llamada.
#[tauri::command]
pub fn mcp_responder(mcp: State<'_, Option<Arc<Mcp>>>, id: u64, texto: String, error: bool) {
    let Some(mcp) = mcp.inner() else { return };
    if let Some(tx) = mcp.pendientes.lock().ok().and_then(|mut p| p.remove(&id)) {
        let _ = tx.send(Respuesta { texto, error });
    }
}

/// Configuración para `claude --mcp-config` de la conversación `claude`.
pub fn config_para(mcp: &Mcp, claude: u32) -> Value {
    json!({
        "mcpServers": {
            "kyu": {
                "type": "http",
                "url": format!("http://127.0.0.1:{}/mcp/{claude}", mcp.puerto),
                "headers": { "Authorization": format!("Bearer {}", mcp.clave) }
            }
        }
    })
}

fn herramientas() -> Value {
    json!([
        {
            "name": "ejecutar_en_panel",
            "description": "Ejecuta una orden de shell en el panel «Claude» de Kyu, visible para el usuario (se abre a la derecha si no existe, en la carpeta de la conversación). Espera a que termine y devuelve el código de salida, la duración y la salida (las últimas 300 líneas). Si tarda más de espera_segundos, devuelve lo que lleve y la orden sigue en el panel: mira luego con leer_panel. La shell es la predeterminada del usuario (PowerShell en Windows).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "orden": { "type": "string", "description": "La orden, en una sola línea." },
                    "espera_segundos": { "type": "integer", "minimum": 1, "maximum": 600, "description": "Cuánto esperar a que termine (por defecto 60)." }
                },
                "required": ["orden"]
            }
        },
        {
            "name": "leer_panel",
            "description": "Lee lo último que hay en un terminal de Kyu del espacio de esta conversación (por defecto el que tiene el foco del usuario). Sirve para ver un error o la salida de algo que el usuario ha ejecutado.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": { "type": "string", "description": "id del terminal (de listar_paneles); sin poner = el del foco." },
                    "lineas": { "type": "integer", "minimum": 1, "maximum": 1000, "description": "Cuántas líneas del final (por defecto 120)." }
                }
            }
        },
        {
            "name": "listar_paneles",
            "description": "Lista los terminales de Kyu del espacio de esta conversación: id, título, carpeta, shell, si es el del foco y el estado de su última orden.",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}
