//! Shells de verdad: un PTY por terminal (ConPTY en Windows) con `portable-pty`.
//!
//! La salida va a la ventana en bytes crudos por un canal de Tauri; xterm.js la interpreta.
//! Lo que teclea el usuario vuelve por `pty_escribir`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, State};

struct Sesion {
    maestro: Box<dyn MasterPty + Send>,
    escritor: Box<dyn Write + Send>,
    matar: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys {
    sesiones: Mutex<HashMap<u32, Sesion>>,
    siguiente: AtomicU32,
}

/// Archivo donde el prompt deja la carpeta actual de la shell `id` (lo lee el panel de Claude).
fn archivo_estado(id: u32) -> std::path::PathBuf {
    let carpeta = std::env::temp_dir().join("kyu");
    let _ = std::fs::create_dir_all(&carpeta);
    carpeta.join(format!("{}-{id}.cwd", std::process::id()))
}

fn tamano(columnas: u16, filas: u16) -> PtySize {
    PtySize {
        rows: filas.max(1),
        cols: columnas.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Abre una shell del perfil `perfil` (o el primero si no existe) en `carpeta`
/// (o en la carpeta personal).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_abrir(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    perfil: String,
    carpeta: Option<String>,
    columnas: u16,
    filas: u16,
    salida: Channel<Response>,
) -> Result<u32, String> {
    let id = ptys.siguiente.fetch_add(1, Ordering::Relaxed);
    let crate::config::Lanzar {
        shell,
        argumentos,
        entorno,
    } = crate::config::Config::cargar()
        .orden_de(&perfil)
        .ok_or("no hay ningún perfil de shell")?;

    let par = native_pty_system()
        .openpty(tamano(columnas, filas))
        .map_err(|e| format!("no se pudo abrir el PTY: {e}"))?;

    let mut orden = CommandBuilder::new(&shell);
    orden.args(&argumentos);
    let inicio = carpeta
        .map(std::path::PathBuf::from)
        .filter(|c| c.is_dir())
        .or_else(dirs::home_dir);
    if let Some(inicio) = inicio {
        orden.cwd(inicio);
    }
    orden.env("KYU_TERMINAL", env!("CARGO_PKG_VERSION"));
    orden.env("KYU_ESTADO", archivo_estado(id));
    orden.env("TERM", "xterm-256color");
    orden.env("COLORTERM", "truecolor");
    for (clave, valor) in &entorno {
        orden.env(clave, valor);
    }

    let mut hijo = par
        .slave
        .spawn_command(orden)
        .map_err(|e| format!("no se pudo arrancar {shell}: {e}"))?;
    drop(par.slave);

    let mut lector = par.master.try_clone_reader().map_err(|e| e.to_string())?;
    let escritor = par.master.take_writer().map_err(|e| e.to_string())?;
    let matar = hijo.clone_killer();

    // Lo que escribe la shell → ventana. Ojo: portable-pty abre ConPTY con
    // INHERIT_CURSOR, así que lo primero que llega es «¿dónde está el cursor?»
    // (ESC[6n) y la shell no arranca hasta que la ventana responde.
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match lector.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if salida.send(Response::new(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Cuando la shell termina se avisa a la ventana. En Windows el lector no siempre ve
    // el final (ConPTY deja la tubería abierta), así que se espera al proceso.
    let app_fin = app.clone();
    std::thread::spawn(move || {
        let _ = hijo.wait();
        let ptys = app_fin.state::<Ptys>();
        ptys.sesiones.lock().unwrap().remove(&id);
        let _ = app_fin.emit("pty:fin", id);
    });

    ptys.sesiones.lock().unwrap().insert(
        id,
        Sesion {
            maestro: par.master,
            escritor,
            matar,
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn pty_escribir(ptys: State<'_, Ptys>, id: u32, datos: String) -> Result<(), String> {
    let mut sesiones = ptys.sesiones.lock().unwrap();
    let sesion = sesiones.get_mut(&id).ok_or("esa terminal ya no existe")?;
    sesion
        .escritor
        .write_all(datos.as_bytes())
        .and_then(|_| sesion.escritor.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_redimensionar(
    ptys: State<'_, Ptys>,
    id: u32,
    columnas: u16,
    filas: u16,
) -> Result<(), String> {
    let sesiones = ptys.sesiones.lock().unwrap();
    let sesion = sesiones.get(&id).ok_or("esa terminal ya no existe")?;
    sesion
        .maestro
        .resize(tamano(columnas, filas))
        .map_err(|e| e.to_string())
}

/// Carpeta actual de la shell `id`, si su prompt la apunta (el de PowerShell de Kyu).
#[tauri::command]
pub fn pty_carpeta(id: u32) -> Option<String> {
    let texto = std::fs::read_to_string(archivo_estado(id)).ok()?;
    let ruta = texto.trim();
    std::path::Path::new(ruta)
        .is_dir()
        .then(|| ruta.to_string())
}

/// Cierra todas las shells. La ventana lo pide al arrancar: si se recargó, las de
/// antes se quedaron sin pestaña.
#[tauri::command]
pub fn pty_cerrar_todas(ptys: State<'_, Ptys>) {
    for (_, mut sesion) in ptys.sesiones.lock().unwrap().drain() {
        let _ = sesion.matar.kill();
    }
}

#[tauri::command]
pub fn pty_cerrar(ptys: State<'_, Ptys>, id: u32) {
    if let Some(mut sesion) = ptys.sesiones.lock().unwrap().remove(&id) {
        let _ = sesion.matar.kill();
    }
}
