//! Pantalla de Ajustes: lee lo que hay en `kyu.toml` y cambia una clave cada vez,
//! respetando el resto del archivo (comentarios y orden) con `toml_edit`.

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct PerfilDetalle {
    nombre: String,
    orden: String,
    color: Option<String>,
    icono: Option<String>,
}

#[derive(Serialize)]
pub struct AjustesVista {
    ruta: String,
    existe: bool,
    autocompletado: bool,
    sin_prompt: bool,
    aviso_segundos: u32,
    restaurar_sesion: bool,
    perfiles_ssh: bool,
    limite_diario: u64,
    fuente: Option<String>,
    fuente_tamano: f32,
    fuentes_conocidas: Vec<String>,
    claude: Option<String>,
    /// Dónde está el `claude` que se usa de verdad (None = no se encuentra).
    claude_encontrado: Option<String>,
    perfil_predeterminado: Option<String>,
    /// En el orden en que se ofrecen (el primero es el predeterminado).
    perfiles: Vec<PerfilDetalle>,
    /// true si los perfiles salen de kyu.toml (si no, son los detectados en el equipo).
    perfiles_propios: bool,
}

pub fn ruta_config() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("kyu").join("kyu.toml"))
}

#[tauri::command]
pub fn ajustes_leer() -> AjustesVista {
    let ruta = ruta_config();
    let config = crate::config::Config::cargar();
    let perfiles = config
        .perfiles()
        .into_iter()
        .map(|p| PerfilDetalle {
            orden: std::iter::once(p.shell.clone())
                .chain(p.argumentos.iter().cloned())
                .collect::<Vec<_>>()
                .join(" "),
            nombre: p.nombre,
            color: p.color,
            icono: p.icono,
        })
        .collect();
    AjustesVista {
        ruta: ruta.as_ref().map(|r| r.display().to_string()).unwrap_or_default(),
        existe: ruta.as_ref().is_some_and(|r| r.is_file()),
        autocompletado: config.autocompletado(),
        sin_prompt: config.sin_prompt,
        aviso_segundos: config.aviso_segundos.unwrap_or(10),
        restaurar_sesion: config.restaurar_sesion(),
        perfiles_ssh: config.perfiles_ssh(),
        limite_diario: config.limite_diario.unwrap_or(0),
        fuente: config.fuente.clone(),
        fuente_tamano: config.tema.fuente_tamano,
        fuentes_conocidas: crate::config::FUENTES_CONOCIDAS
            .iter()
            .filter(|f| **f != "monospace")
            .map(|f| f.to_string())
            .collect(),
        claude: config.claude.clone(),
        claude_encontrado: crate::claude::buscar_programa(config.claude.as_deref())
            .map(|p| p.display().to_string()),
        perfil_predeterminado: config.perfil_predeterminado.clone(),
        perfiles,
        perfiles_propios: !config.perfiles.is_empty(),
    }
}

/// Cambia una clave de kyu.toml (lo crea si no existe). `valor` null = quitar la clave
/// (vuelve al valor por defecto).
#[tauri::command]
pub fn ajustes_guardar(clave: String, valor: Value) -> Result<(), String> {
    const PERMITIDAS: &[&str] = &[
        "autocompletado",
        "sin_prompt",
        "aviso_segundos",
        "restaurar_sesion",
        "perfiles_ssh",
        "limite_diario",
        "fuente",
        "tema.fuente_tamano",
        "claude",
        "perfil_predeterminado",
    ];
    if !PERMITIDAS.contains(&clave.as_str()) {
        return Err(format!("no se puede cambiar «{clave}» desde Ajustes"));
    }
    let ruta = ruta_config().ok_or("no encuentro la carpeta de configuración")?;
    let texto = std::fs::read_to_string(&ruta).unwrap_or_default();
    let mut doc = texto
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("kyu.toml no es válido: {e}"))?;

    let nuevo: Option<toml_edit::Item> = match &valor {
        Value::Null => None,
        Value::Bool(b) => Some(toml_edit::value(*b)),
        Value::Number(n) if clave == "tema.fuente_tamano" => {
            Some(toml_edit::value(n.as_f64().ok_or("número no válido")?))
        }
        Value::Number(n) => Some(toml_edit::value(n.as_i64().ok_or("número no válido")?)),
        Value::String(s) if s.trim().is_empty() => None,
        Value::String(s) => Some(toml_edit::value(s.trim())),
        _ => return Err("valor no válido".into()),
    };

    let (tabla, nombre) = match clave.split_once('.') {
        Some((t, n)) => {
            if !doc.contains_table(t) {
                doc[t] = toml_edit::table();
            }
            (doc[t].as_table_mut().ok_or("tabla rota")?, n)
        }
        None => (doc.as_table_mut(), clave.as_str()),
    };
    match nuevo {
        Some(v) => {
            tabla[nombre] = v;
        }
        None => {
            tabla.remove(nombre);
        }
    }

    // Comprobación: lo que queda tiene que seguir leyéndose bien.
    let resultado = doc.to_string();
    toml::from_str::<crate::config::Config>(&resultado).map_err(|e| format!("quedaría mal: {e}"))?;
    if let Some(carpeta) = ruta.parent() {
        std::fs::create_dir_all(carpeta).map_err(|e| e.to_string())?;
    }
    std::fs::write(&ruta, resultado).map_err(|e| e.to_string())
}
