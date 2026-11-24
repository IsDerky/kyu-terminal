//! Datos del equipo para el título de cada bloque (de momento, la RAM).

use std::sync::Mutex;

use serde::Serialize;
use sysinfo::System;
use tauri::State;

#[derive(Default)]
pub struct Sistema(Mutex<Option<System>>);

/// RAM en bytes: la que está en uso y la total.
#[derive(Serialize)]
pub struct Ram {
    usada: u64,
    total: u64,
}

/// `None` si el sistema no deja leerla.
#[tauri::command]
pub fn ram_uso(sistema: State<'_, Sistema>) -> Option<Ram> {
    let mut guardado = sistema.0.lock().unwrap();
    if guardado.is_none() {
        *guardado = System::new().ok();
    }
    let sys = guardado.as_mut()?;
    sys.refresh_memory();
    Some(Ram {
        usada: sys.used_memory(),
        total: sys.total_memory(),
    })
}
