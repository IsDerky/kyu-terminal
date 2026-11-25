//! Árbol de archivos (pestaña «Archivos»): lo que hay en una carpeta, respetando
//! .gitignore, y el estado de git de cada archivo.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Lo más que se enseña de una carpeta.
const MAX_ENTRADAS: usize = 2000;

#[derive(Serialize)]
pub struct Nodo {
    nombre: String,
    ruta: String,
    carpeta: bool,
}

/// Lo que hay dentro de `carpeta` (sin entrar en las subcarpetas): primero las carpetas,
/// luego los archivos, por nombre. Se salta lo que ignora git y la carpeta .git.
#[tauri::command]
pub async fn arbol_listar(carpeta: String) -> Result<Vec<Nodo>, String> {
    tauri::async_runtime::spawn_blocking(move || listar(Path::new(&carpeta)))
        .await
        .map_err(|e| e.to_string())?
}

fn listar(carpeta: &Path) -> Result<Vec<Nodo>, String> {
    if !carpeta.is_dir() {
        return Err("esa carpeta ya no existe".into());
    }
    let mut lista: Vec<Nodo> = ignore::WalkBuilder::new(carpeta)
        .max_depth(Some(1))
        // Los archivos ocultos se ven (.github, .gitignore…); lo ignorado por git, no.
        .hidden(false)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
        .filter(|e| e.depth() == 1)
        .take(MAX_ENTRADAS)
        .map(|e| Nodo {
            nombre: e.file_name().to_string_lossy().into_owned(),
            ruta: e.path().display().to_string(),
            carpeta: e.file_type().is_some_and(|t| t.is_dir()),
        })
        .collect();
    lista.sort_by(|a, b| {
        b.carpeta
            .cmp(&a.carpeta)
            .then_with(|| a.nombre.to_lowercase().cmp(&b.nombre.to_lowercase()))
    });
    Ok(lista)
}

/// Estado de git de los archivos con cambios del repositorio de `carpeta`: ruta absoluta →
/// letra (M cambiado, A añadido, D borrado, R renombrado, ? nuevo sin añadir). Vacío si no
/// es un repositorio.
#[tauri::command]
pub async fn git_estado(carpeta: String) -> HashMap<String, String> {
    tauri::async_runtime::spawn_blocking(move || estado(&carpeta))
        .await
        .unwrap_or_default()
}

fn git(carpeta: &str, args: &[&str]) -> Option<Vec<u8>> {
    let mut orden = std::process::Command::new("git");
    orden.arg("-C").arg(carpeta).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        orden.creation_flags(CREATE_NO_WINDOW);
    }
    let salida = orden.output().ok()?;
    salida.status.success().then_some(salida.stdout)
}

fn estado(carpeta: &str) -> HashMap<String, String> {
    let mut mapa = HashMap::new();
    let Some(raiz) = git(carpeta, &["rev-parse", "--show-toplevel"]) else {
        return mapa;
    };
    let raiz = PathBuf::from(String::from_utf8_lossy(&raiz).trim());
    let Some(salida) = git(
        carpeta,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ) else {
        return mapa;
    };
    // Cada entrada: «XY ruta\0»; en los renombrados viene además la ruta vieja «\0vieja\0».
    let mut partes = salida.split(|b| *b == 0);
    while let Some(p) = partes.next() {
        if p.len() < 4 {
            continue;
        }
        let (x, y) = (p[0] as char, p[1] as char);
        let ruta = String::from_utf8_lossy(&p[3..]);
        if x == 'R' || x == 'C' {
            partes.next();
        }
        let letra = match (x, y) {
            ('?', _) => "?",
            ('A', _) => "A",
            ('R', _) => "R",
            (_, 'D') | ('D', _) => "D",
            _ => "M",
        };
        let absoluta = raiz.join(ruta.as_ref());
        #[cfg(windows)]
        let absoluta = PathBuf::from(absoluta.display().to_string().replace('/', "\\"));
        mapa.insert(absoluta.display().to_string(), letra.to_string());
    }
    mapa
}
