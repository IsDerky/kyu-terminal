//! Datos del equipo para el título de cada bloque (de momento, la RAM).

use std::sync::Mutex;

use sysinfo::System;
use tauri::State;

#[derive(Default)]
pub struct Sistema(Mutex<Option<System>>);

/// Porcentaje de RAM en uso, de 0 a 100; `None` si el sistema no deja leerla.
#[tauri::command]
pub fn ram_uso(sistema: State<'_, Sistema>) -> Option<f32> {
    let mut guardado = sistema.0.lock().unwrap();
    if guardado.is_none() {
        *guardado = System::new().ok();
    }
    let sys = guardado.as_mut()?;
    sys.refresh_memory();
    let total = sys.total_memory().max(1) as f64;
    Some((sys.used_memory() as f64 / total * 100.0) as f32)
}
