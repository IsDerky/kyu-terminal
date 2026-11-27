//! Avisa al árbol de archivos cuando cambia algo en las carpetas que enseña, en vez de que
//! las vuelva a leer cada 3 s. No se vigila .git: `git status` reescribe el índice y se
//! avisaría a sí mismo sin parar; lo que solo cambia git lo recoge un repaso lento del árbol.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::State;
use tauri::ipc::Channel;

/// Lo que llega en este rato cuenta como un solo aviso (guardar, compilar, un `git checkout`…).
const JUNTAR: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct Vigilantes(Mutex<HashMap<String, RecommendedWatcher>>);

/// Leer un archivo no cambia el árbol, y lo que solo toca .git (git status reescribe el
/// índice; en Windows llega como cambio de la carpeta .git) haría un bucle.
fn cuenta(e: &Event) -> bool {
    let solo_git = !e.paths.is_empty()
        && e.paths
            .iter()
            .all(|p| p.components().any(|c| c.as_os_str() == ".git"));
    !matches!(e.kind, EventKind::Access(_)) && !solo_git
}

/// Vigila `carpetas` (sin bajar a las subcarpetas) para el árbol `id`; si ya vigilaba otras,
/// las cambia por estas.
#[tauri::command]
pub fn arbol_vigilar(
    vigilantes: State<'_, Vigilantes>,
    id: String,
    carpetas: Vec<String>,
    avisos: Channel<()>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<()>();
    let mut vigilante = notify::recommended_watcher(move |r: notify::Result<Event>| {
        if r.is_ok_and(|e| cuenta(&e)) {
            let _ = tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;
    for c in &carpetas {
        let p = Path::new(c);
        if p.is_dir() {
            // Una carpeta que no se deja vigilar (permisos, red) se queda con el repaso lento.
            let _ = vigilante.watch(p, RecursiveMode::NonRecursive);
        }
    }
    // Al quitar el vigilante se suelta `tx`, `recv` falla y el hilo acaba.
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(JUNTAR).is_ok() {}
            if avisos.send(()).is_err() {
                break;
            }
        }
    });
    vigilantes
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, vigilante);
    Ok(())
}

#[tauri::command]
pub fn arbol_dejar(vigilantes: State<'_, Vigilantes>, id: String) {
    if let Ok(mut v) = vigilantes.0.lock() {
        v.remove(&id);
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn avisa_al_crear_un_archivo() {
        let dir = std::env::temp_dir().join(format!("kyu-vigilante-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut w = notify::recommended_watcher(move |r: notify::Result<Event>| {
            if r.is_ok_and(|e| cuenta(&e)) {
                let _ = tx.send(());
            }
        })
        .unwrap();
        w.watch(&dir, RecursiveMode::NonRecursive).unwrap();
        std::fs::write(dir.join("nuevo.txt"), "x").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(5)).is_ok());
        // Lo de dentro de .git no avisa.
        while rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        while rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
        let git = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path(dir.join(".git").join("index"));
        assert!(!cuenta(&git));
        drop(w);
        std::fs::remove_dir_all(&dir).ok();
    }
}
