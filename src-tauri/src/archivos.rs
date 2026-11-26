//! Abrir y guardar archivos desde la ventana (el editor de Kyu).

use std::path::{Path, PathBuf};

/// Lo más grande que se abre en el editor.
const MAXIMO: u64 = 8 * 1024 * 1024;

/// Ruta absoluta de `ruta` si es un archivo que existe. Las relativas se buscan
/// desde `base` (la carpeta del terminal donde salió el enlace).
#[tauri::command]
pub fn archivo_resolver(ruta: String, base: Option<String>) -> Option<String> {
    let ruta = ruta
        .trim()
        .trim_start_matches("./")
        .trim_start_matches(".\\");
    let ruta = expandir_casa(ruta);
    let candidata = if ruta.is_absolute() {
        ruta
    } else {
        PathBuf::from(base?).join(ruta)
    };
    candidata
        .is_file()
        .then(|| limpiar(&candidata).display().to_string())
}

#[tauri::command]
pub fn archivo_leer(ruta: String) -> Result<String, String> {
    let meta = std::fs::metadata(&ruta).map_err(|e| e.to_string())?;
    if meta.len() > MAXIMO {
        return Err(format!(
            "es demasiado grande para el editor ({} MB)",
            meta.len() / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(&ruta).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "no es un archivo de texto (UTF-8)".into())
}

#[tauri::command]
pub fn archivo_guardar(ruta: String, contenido: String) -> Result<(), String> {
    std::fs::write(&ruta, contenido).map_err(|e| e.to_string())
}

/// Guarda una conversación exportada en Documentos\Kyu\conversaciones y devuelve la ruta.
#[tauri::command]
pub fn conversacion_exportar(nombre: String, contenido: String) -> Result<String, String> {
    let dir = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or("no encuentro la carpeta Documentos")?
        .join("Kyu")
        .join("conversaciones");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Sin caracteres que Windows no admite en un nombre.
    let limpio: String = nombre
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let ruta = dir.join(format!("{}.md", limpio.trim()));
    std::fs::write(&ruta, contenido).map_err(|e| e.to_string())?;
    Ok(ruta.display().to_string())
}

/// Borra un archivo (no carpetas): «Deshacer» de un archivo que creó Claude.
#[tauri::command]
pub fn archivo_borrar(ruta: String) -> Result<(), String> {
    let p = Path::new(&ruta);
    if !p.is_file() {
        return Err("no es un archivo".into());
    }
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

/// Un nombre de archivo o carpeta válido (sin rutas ni «..»), para crear y renombrar desde el árbol.
fn nombre_valido(nombre: &str) -> Result<&str, String> {
    let n = nombre.trim();
    if n.is_empty() {
        return Err("ponle un nombre".into());
    }
    if n == "." || n == ".." || n.contains(['/', '\\']) {
        return Err("el nombre no puede llevar «/» ni «\\»".into());
    }
    if n.chars().any(|c| "<>:\"|?*".contains(c) || c.is_control()) {
        return Err("el nombre no puede llevar < > : \" | ? *".into());
    }
    Ok(n)
}

/// Crea un archivo vacío `nombre` dentro de `carpeta` y devuelve su ruta. No pisa nada.
#[tauri::command]
pub fn archivo_crear(carpeta: String, nombre: String) -> Result<String, String> {
    let dir = Path::new(&carpeta);
    if !dir.is_dir() {
        return Err("esa carpeta ya no existe".into());
    }
    let ruta = dir.join(nombre_valido(&nombre)?);
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&ruta)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => "ya hay algo con ese nombre".to_string(),
            _ => e.to_string(),
        })?;
    Ok(ruta.display().to_string())
}

/// Renombra un archivo o carpeta en su misma carpeta y devuelve la ruta nueva. No pisa nada
/// (salvo cambiar solo mayúsculas, que en Windows es el mismo archivo).
#[tauri::command]
pub fn archivo_renombrar(ruta: String, nombre: String) -> Result<String, String> {
    let viejo = Path::new(&ruta);
    if !viejo.exists() {
        return Err("ya no existe".into());
    }
    let padre = viejo.parent().ok_or("no se puede renombrar la raíz")?;
    let nuevo = padre.join(nombre_valido(&nombre)?);
    let mismo = nuevo.to_string_lossy().to_lowercase() == viejo.to_string_lossy().to_lowercase();
    if nuevo.exists() && !mismo {
        return Err("ya hay algo con ese nombre".into());
    }
    std::fs::rename(viejo, &nuevo).map_err(|e| e.to_string())?;
    Ok(nuevo.display().to_string())
}

fn expandir_casa(ruta: &str) -> PathBuf {
    if let Some(resto) = ruta.strip_prefix("~/").or_else(|| ruta.strip_prefix("~\\"))
        && let Some(casa) = dirs::home_dir()
    {
        return casa.join(resto);
    }
    PathBuf::from(ruta)
}

/// Quita `.` y `..` sin tocar el disco (canonicalize en Windows añade `\\?\`).
fn limpiar(ruta: &Path) -> PathBuf {
    let mut fuera = PathBuf::new();
    for parte in ruta.components() {
        match parte {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                fuera.pop();
            }
            otra => fuera.push(otra),
        }
    }
    fuera
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn crear_y_renombrar_desde_el_arbol() {
        let dir = std::env::temp_dir().join(format!("kyu-prueba-arbol-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let carpeta = dir.display().to_string();
        assert!(archivo_crear(carpeta.clone(), "../fuera.txt".into()).is_err());
        assert!(archivo_crear(carpeta.clone(), "a:b".into()).is_err());
        let a = archivo_crear(carpeta.clone(), " nuevo.ts ".into()).unwrap();
        assert!(a.ends_with("nuevo.ts"));
        assert!(archivo_crear(carpeta.clone(), "nuevo.ts".into()).is_err());
        archivo_crear(carpeta.clone(), "otro.ts".into()).unwrap();
        assert!(archivo_renombrar(a.clone(), "otro.ts".into()).is_err());
        let b = archivo_renombrar(a, "Nuevo.ts".into()).unwrap();
        assert!(b.ends_with("Nuevo.ts"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
