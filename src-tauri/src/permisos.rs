//! Reglas de permisos guardadas de Claude Code («Siempre» las añade): las de usuario
//! (`settings.json` de la configuración principal) y las del proyecto (`.claude/settings.json`,
//! compartidas, y `.claude/settings.local.json`, solo tuyas). Se ven y se quitan desde el panel.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct Regla {
    archivo: String,
    /// usuario, proyecto o local.
    ambito: &'static str,
    /// allow, deny o ask.
    tipo: String,
    regla: String,
}

fn archivos(carpeta: Option<&str>) -> Vec<(&'static str, PathBuf)> {
    let mut l = Vec::new();
    if let Some(c) = carpeta.filter(|c| !c.is_empty()) {
        let base = Path::new(c).join(".claude");
        l.push(("local", base.join("settings.local.json")));
        l.push(("proyecto", base.join("settings.json")));
    }
    if let Some(p) = crate::cuentas::carpeta_principal() {
        l.push(("usuario", p.join("settings.json")));
    }
    l
}

fn leer_json(ruta: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(ruta).ok()?).ok()
}

#[tauri::command]
pub fn permisos_leer(carpeta: Option<String>) -> Vec<Regla> {
    let mut sal = Vec::new();
    for (ambito, ruta) in archivos(carpeta.as_deref()) {
        let Some(v) = leer_json(&ruta) else { continue };
        for tipo in ["allow", "ask", "deny"] {
            for r in v["permissions"][tipo].as_array().into_iter().flatten() {
                if let Some(r) = r.as_str() {
                    sal.push(Regla {
                        archivo: ruta.display().to_string(),
                        ambito,
                        tipo: tipo.into(),
                        regla: r.into(),
                    });
                }
            }
        }
    }
    sal
}

/// Quita una regla de su archivo. Solo de los archivos que lee `permisos_leer`.
#[tauri::command]
pub fn permisos_quitar(archivo: String, tipo: String, regla: String) -> Result<(), String> {
    if !matches!(tipo.as_str(), "allow" | "ask" | "deny") {
        return Err("tipo no válido".into());
    }
    let ruta = PathBuf::from(&archivo);
    let nombre = ruta.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !matches!(nombre, "settings.json" | "settings.local.json") {
        return Err("ese archivo no es de ajustes de Claude".into());
    }
    let mut v = leer_json(&ruta).ok_or("no se pudo leer el archivo")?;
    let lista = v["permissions"][tipo.as_str()]
        .as_array_mut()
        .ok_or("esa regla ya no está")?;
    let antes = lista.len();
    lista.retain(|x| x.as_str() != Some(regla.as_str()));
    if lista.len() == antes {
        return Err("esa regla ya no está".into());
    }
    let texto = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&ruta, texto + "\n").map_err(|e| e.to_string())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn quitar_una_regla_conserva_lo_demas() {
        let dir = std::env::temp_dir().join(format!("kyu-permisos-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        let f = dir.join(".claude").join("settings.local.json");
        std::fs::write(
            &f,
            r#"{"zeta":1,"permissions":{"allow":["Bash(ls:*)","Read"],"deny":[]},"alfa":2}"#,
        )
        .unwrap();
        let c = dir.to_string_lossy().to_string();
        let l = permisos_leer(Some(c.clone()));
        assert!(
            l.iter()
                .any(|r| r.regla == "Bash(ls:*)" && r.ambito == "local")
        );
        permisos_quitar(f.display().to_string(), "allow".into(), "Bash(ls:*)".into()).unwrap();
        let texto = std::fs::read_to_string(&f).unwrap();
        assert!(!texto.contains("Bash(ls"));
        // El orden de las claves no cambia.
        assert!(texto.find("zeta").unwrap() < texto.find("alfa").unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }
}
