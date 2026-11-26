//! Sesiones de Claude Code que trabajan fuera de Kyu (VS Code, otra terminal): las que han
//! escrito en su .jsonl hace poco. Solo se leen; Kyu no puede controlar lo que no lanzó.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

/// Cuánto hace como mucho de la última escritura para contar como «trabajando».
const RECIENTE: Duration = Duration::from_secs(120);

#[derive(Serialize)]
pub struct Activa {
    id: String,
    /// Carpeta donde trabaja (la `cwd` de su última línea).
    carpeta: Option<String>,
    titulo: String,
    /// Última herramienta que ha usado.
    herramienta: Option<String>,
    /// Milisegundos desde 1970 de la última escritura.
    fecha: u64,
    /// Carpeta de configuración (`.claude`, `.claude-secundaria`…): de qué cuenta es.
    cuenta: String,
}

/// Las carpetas `projects` de todas las configuraciones de Claude que haya: la principal, las
/// de kyu.toml y cualquier `~/.claude*`. Sin repetir las enlazadas (cuentas que comparten).
fn carpetas_projects() -> Vec<(String, PathBuf)> {
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(p) = crate::cuentas::carpeta_principal() {
        bases.push(p);
    }
    let config = crate::config::Config::cargar();
    for c in &config.cuentas_claude {
        if let Some(cuenta) = crate::cuentas::buscar(&config, Some(&c.nombre)) {
            bases.push(cuenta.carpeta);
        }
    }
    if let Some(casa) = dirs::home_dir() {
        for e in std::fs::read_dir(&casa).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with(".claude") {
                bases.push(e.path());
            }
        }
    }
    let mut vistas = HashSet::new();
    bases
        .into_iter()
        .filter_map(|b| {
            let p = b.join("projects");
            let real = std::fs::canonicalize(&p).ok()?;
            vistas.insert(real).then(|| {
                let nombre = b
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                (nombre, p)
            })
        })
        .collect()
}

fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Del final del .jsonl: la carpeta y la última herramienta.
fn del_final(fin: &str) -> (Option<String>, Option<String>) {
    let mut carpeta = None;
    let mut herramienta = None;
    for v in fin
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
    {
        if carpeta.is_none() {
            carpeta = v["cwd"].as_str().map(String::from);
        }
        if herramienta.is_none() && v["type"] == "assistant" {
            herramienta = v["message"]["content"]
                .as_array()
                .into_iter()
                .flatten()
                .rev()
                .find(|b| b["type"] == "tool_use")
                .and_then(|b| b["name"].as_str())
                .map(String::from);
        }
        if carpeta.is_some() && herramienta.is_some() {
            break;
        }
    }
    (carpeta, herramienta)
}

fn buscar(excluir: &HashSet<String>, ahora: SystemTime) -> Vec<Activa> {
    let mut sal = Vec::new();
    for (cuenta, projects) in carpetas_projects() {
        for proyecto in std::fs::read_dir(&projects).into_iter().flatten().flatten() {
            if !proyecto.path().is_dir() {
                continue;
            }
            for a in std::fs::read_dir(proyecto.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                let ruta = a.path();
                if ruta.extension().is_none_or(|e| e != "jsonl") {
                    continue;
                }
                let Some(fecha) = a.metadata().ok().and_then(|m| m.modified().ok()) else {
                    continue;
                };
                if ahora.duration_since(fecha).unwrap_or_default() > RECIENTE {
                    continue;
                }
                let id = ruta
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if excluir.contains(&id) {
                    continue;
                }
                sal.push(leer(&ruta, id, fecha, &cuenta));
            }
        }
    }
    sal.sort_by_key(|a| std::cmp::Reverse(a.fecha));
    sal
}

fn leer(ruta: &Path, id: String, fecha: SystemTime, cuenta: &str) -> Activa {
    let (principio, fin) = crate::sesiones::trozos(ruta, 64 * 1024);
    let (carpeta, herramienta) = del_final(if fin.is_empty() { &principio } else { &fin });
    Activa {
        titulo: crate::sesiones::titulo_de(&principio, &fin)
            .unwrap_or_else(|| "Conversación sin título".into()),
        id,
        carpeta,
        herramienta,
        fecha: ms(fecha),
        cuenta: cuenta.to_string(),
    }
}

/// Sesiones de Claude con actividad en los últimos 2 min que no son de Kyu (`excluir` = los
/// ids de sesión de sus conversaciones).
#[tauri::command]
pub async fn claude_activas(excluir: Vec<String>) -> Result<Vec<Activa>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        buscar(&excluir.into_iter().collect(), SystemTime::now())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn carpeta_y_herramienta_del_final() {
        let fin = r#"{"type":"user","cwd":"C:\\a"}
{"type":"assistant","cwd":"C:\\b","message":{"content":[{"type":"text","text":"x"},{"type":"tool_use","name":"Bash","input":{}}]}}
{"type":"user","cwd":"C:\\c","message":{"content":[{"type":"tool_result"}]}}"#;
        let (c, h) = del_final(fin);
        assert_eq!(c.as_deref(), Some("C:\\c"));
        assert_eq!(h.as_deref(), Some("Bash"));
    }
}
