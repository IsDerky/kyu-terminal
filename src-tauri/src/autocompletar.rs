//! Datos para el autocompletado de Kyu: lo que hay en una carpeta y las ramas de git.
//! Lo demás (historial, scripts del package.json) lo resuelve la ventana.

use serde::Serialize;
use std::path::PathBuf;

const MAX_ENTRADAS: usize = 300;

#[derive(Serialize)]
pub struct Entrada {
    nombre: String,
    carpeta: bool,
}

/// Entradas de `carpeta` cuyo nombre empieza por `prefijo` (sin distinguir mayúsculas),
/// las carpetas primero. Vacío si no se puede leer.
#[tauri::command]
pub fn carpeta_listar(carpeta: String, prefijo: String) -> Vec<Entrada> {
    let base = PathBuf::from(&carpeta);
    let Ok(lectura) = std::fs::read_dir(&base) else {
        return Vec::new();
    };
    let prefijo = prefijo.to_lowercase();
    let mut lista: Vec<Entrada> = lectura
        .flatten()
        .filter_map(|e| {
            let nombre = e.file_name().to_string_lossy().into_owned();
            if !nombre.to_lowercase().starts_with(&prefijo) {
                return None;
            }
            let carpeta = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(Entrada { nombre, carpeta })
        })
        .take(MAX_ENTRADAS)
        .collect();
    lista.sort_by(|a, b| {
        b.carpeta
            .cmp(&a.carpeta)
            .then_with(|| a.nombre.to_lowercase().cmp(&b.nombre.to_lowercase()))
    });
    lista
}

/// Ramas locales (la actual primero no importa: la ventana ordena) y remotas de `carpeta`.
#[tauri::command]
pub fn git_ramas(carpeta: String) -> Vec<String> {
    let mut orden = std::process::Command::new("git");
    orden.args([
        "-C",
        &carpeta,
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        orden.creation_flags(CREATE_NO_WINDOW);
    }
    let salida = match orden.output() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("git_ramas: no se pudo lanzar git: {e}");
            return Vec::new();
        }
    };
    if !salida.status.success() {
        eprintln!(
            "git_ramas: {}",
            String::from_utf8_lossy(&salida.stderr).trim()
        );
        return Vec::new();
    }
    String::from_utf8_lossy(&salida.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.ends_with("/HEAD") && *l != "origin")
        .map(str::to_string)
        .collect()
}
