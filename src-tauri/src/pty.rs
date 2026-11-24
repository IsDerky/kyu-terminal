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

#[tauri::command]
pub fn pty_abrir(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    columnas: u16,
    filas: u16,
    salida: Channel<Response>,
) -> Result<u32, String> {
    let id = ptys.siguiente.fetch_add(1, Ordering::Relaxed);
    let (shell, argumentos) = crate::config::Config::cargar().shell_elegida();

    let par = native_pty_system()
        .openpty(tamano(columnas, filas))
        .map_err(|e| format!("no se pudo abrir el PTY: {e}"))?;

    let mut orden = CommandBuilder::new(&shell);
    orden.args(&argumentos);
    if let Some(casa) = dirs::home_dir() {
        orden.cwd(casa);
    }
    orden.env("KYU_TERMINAL", env!("CARGO_PKG_VERSION"));
    orden.env("KYU_ESTADO", archivo_estado(id));
    orden.env("TERM", "xterm-256color");
    orden.env("COLORTERM", "truecolor");

    let mut hijo = par
        .slave
        .spawn_command(orden)
        .map_err(|e| format!("no se pudo arrancar {shell}: {e}"))?;
    drop(par.slave);

    let mut lector = par.master.try_clone_reader().map_err(|e| e.to_string())?;
    let escritor = par.master.take_writer().map_err(|e| e.to_string())?;
    let matar = hijo.clone_killer();

    // Lo que escribe la shell → ventana.
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

#[tauri::command]
pub fn pty_cerrar(ptys: State<'_, Ptys>, id: u32) {
    if let Some(mut sesion) = ptys.sesiones.lock().unwrap().remove(&id) {
        let _ = sesion.matar.kill();
    }
}
