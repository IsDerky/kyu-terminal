//! Pantalla de Uso: lee los registros de Claude Code (`~/.claude/projects/**/*.jsonl`) y
//! suma los tokens de cada respuesta del modelo por día (hora local), proyecto y modelo.
//! Sin precios: cambian y no se inventan.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Default, Clone)]
pub struct Dia {
    fecha: String,
    salida: u64,
    entrada: u64,
    cache_leida: u64,
    cache_creada: u64,
    peticiones: u64,
}

#[derive(Serialize)]
pub struct Parte {
    nombre: String,
    salida: u64,
}

#[derive(Serialize)]
pub struct UsoVista {
    carpeta: String,
    dias: Vec<Dia>,
    proyectos: Vec<Parte>,
    modelos: Vec<Parte>,
    sesiones: usize,
}

/// Días desde 1970-01-01 de una fecha civil (algoritmo de Howard Hinnant).
fn dias_desde_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_desde_dias(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if m <= 2 {
            yoe + era * 400 + 1
        } else {
            yoe + era * 400
        },
        m,
        d,
    )
}

/// "2026-11-24T15:03:00.123Z" → minutos desde 1970 (UTC).
fn minutos_iso(t: &str) -> Option<i64> {
    let n = |a: usize, b: usize| t.get(a..b)?.parse::<i64>().ok();
    Some(dias_desde_civil(n(0, 4)?, n(5, 7)?, n(8, 10)?) * 1440 + n(11, 13)? * 60 + n(14, 16)?)
}

fn fecha(dia: i64) -> String {
    let (y, m, d) = civil_desde_dias(dia);
    format!("{y:04}-{m:02}-{d:02}")
}

/// "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5".
fn nombre_modelo(m: &str) -> String {
    let partes: Vec<&str> = m
        .trim_start_matches("claude-")
        .split('-')
        .filter(|p| p.len() < 8)
        .collect();
    let Some((familia, version)) = partes.split_first() else {
        return m.to_string();
    };
    let mut f = familia.to_string();
    if let Some(c) = f.get_mut(0..1) {
        c.make_ascii_uppercase();
    }
    if version.is_empty() {
        f
    } else {
        format!("{f} {}", version.join("."))
    }
}

fn jsonl(carpeta: &Path, desde: SystemTime, salida: &mut Vec<PathBuf>, nivel: u8) {
    let Ok(lectura) = std::fs::read_dir(carpeta) else {
        return;
    };
    for e in lectura.flatten() {
        let ruta = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() && nivel < 3 {
            jsonl(&ruta, desde, salida, nivel + 1);
        } else if ruta.extension().is_some_and(|x| x == "jsonl")
            && meta.modified().is_ok_and(|t| t >= desde)
        {
            salida.push(ruta);
        }
    }
}

/// `dias`: cuántos días hacia atrás (hoy incluido). `desfase_min`: lo que da
/// `new Date().getTimezoneOffset()` en la ventana (minutos por detrás de UTC).
#[tauri::command(async)]
pub fn uso_leer(dias: u32, desfase_min: i64) -> Result<UsoVista, String> {
    let dias = dias.clamp(1, 90) as i64;
    let carpeta = dirs::home_dir()
        .ok_or("sin carpeta personal")?
        .join(".claude")
        .join("projects");
    let ahora_min = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64
        / 60;
    let hoy = (ahora_min - desfase_min).div_euclid(1440);
    let primero = hoy - dias + 1;

    let desde = SystemTime::now() - Duration::from_secs((dias as u64 + 1) * 86_400);
    let mut archivos = Vec::new();
    jsonl(&carpeta, desde, &mut archivos, 0);

    let mut por_dia: HashMap<i64, Dia> = HashMap::new();
    let mut proyectos: HashMap<String, u64> = HashMap::new();
    let mut modelos: HashMap<String, u64> = HashMap::new();
    let mut sesiones: HashSet<String> = HashSet::new();
    let mut vistos: HashSet<String> = HashSet::new();

    for ruta in archivos {
        let Ok(f) = std::fs::File::open(&ruta) else {
            continue;
        };
        // Cada sesión cuenta entera en la carpeta donde empezó (la primera `cwd` del
        // registro): si Claude hace `cd` dentro, no se reparte entre carpetas sueltas.
        let mut proyecto: Option<String> = None;
        for linea in BufReader::new(f).lines().map_while(Result::ok) {
            if proyecto.is_none()
                && let Some(i) = linea.find("\"cwd\":\"")
            {
                let resto = &linea[i + 7..];
                if let Some(fin) = resto.find('"') {
                    let cwd = resto[..fin].replace("\\\\", "\\");
                    proyecto = cwd
                        .trim_end_matches(['\\', '/'])
                        .rsplit(['\\', '/'])
                        .next()
                        .filter(|p| !p.is_empty())
                        .map(str::to_string);
                }
            }
            // Filtro rápido antes de leer el JSON: solo respuestas con uso de tokens.
            if !linea.contains("\"usage\"") || !linea.contains("\"assistant\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&linea) else {
                continue;
            };
            if v["type"] != "assistant" {
                continue;
            }
            let msg = &v["message"];
            let u = &msg["usage"];
            let Some(dia) = v["timestamp"]
                .as_str()
                .and_then(minutos_iso)
                .map(|m| (m - desfase_min).div_euclid(1440))
            else {
                continue;
            };
            if dia < primero || dia > hoy {
                continue;
            }
            // Una respuesta sale en varias líneas (una por bloque) con el mismo uso.
            let clave = format!(
                "{}|{}",
                msg["id"].as_str().unwrap_or(""),
                v["requestId"].as_str().unwrap_or("")
            );
            if clave != "|" && !vistos.insert(clave) {
                continue;
            }
            let n = |c: &str| u[c].as_u64().unwrap_or(0);
            let salida = n("output_tokens");
            let d = por_dia.entry(dia).or_default();
            d.salida += salida;
            d.entrada += n("input_tokens");
            d.cache_leida += n("cache_read_input_tokens");
            d.cache_creada += n("cache_creation_input_tokens");
            d.peticiones += 1;
            if let Some(s) = v["sessionId"].as_str() {
                sesiones.insert(s.to_string());
            }
            let nombre = proyecto.clone().unwrap_or_else(|| "(sin carpeta)".into());
            *proyectos.entry(nombre).or_default() += salida;
            if let Some(m) = msg["model"].as_str().filter(|m| m.starts_with("claude")) {
                *modelos.entry(nombre_modelo(m)).or_default() += salida;
            }
        }
    }

    let ordenar = |m: HashMap<String, u64>| {
        let mut v: Vec<Parte> = m
            .into_iter()
            .map(|(nombre, salida)| Parte { nombre, salida })
            .collect();
        v.sort_by_key(|a| std::cmp::Reverse(a.salida));
        v
    };
    Ok(UsoVista {
        carpeta: carpeta.display().to_string(),
        dias: (primero..=hoy)
            .map(|d| Dia {
                fecha: fecha(d),
                ..por_dia.get(&d).cloned().unwrap_or_default()
            })
            .collect(),
        proyectos: ordenar(proyectos),
        modelos: ordenar(modelos),
        sesiones: sesiones.len(),
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn fechas_y_modelos() {
        assert_eq!(fecha(dias_desde_civil(2026, 11, 24)), "2026-11-24");
        assert_eq!(fecha(dias_desde_civil(2024, 2, 29)), "2024-02-29");
        assert_eq!(minutos_iso("1970-01-02T00:01:00Z"), Some(1441));
        assert_eq!(nombre_modelo("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(nombre_modelo("claude-haiku-4-5-20251001"), "Haiku 4.5");
    }
}
