//! Conversaciones guardadas de Claude Code (`~/.claude/projects/<carpeta>/<id>.jsonl`) para
//! reanudarlas desde el panel, y búsqueda de archivos para las menciones `@archivo`.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

/// Claude Code guarda cada proyecto en una carpeta con la ruta y todo lo que no es letra o
/// número cambiado por «-». La letra de la unidad sale a veces en minúscula: se compara sin
/// mayúsculas y se juntan todas las que encajen.
fn carpetas_de_proyecto(carpeta: &str) -> Vec<PathBuf> {
    let Some(base) = dirs::home_dir().map(|h| h.join(".claude").join("projects")) else {
        return Vec::new();
    };
    let nombre: String = carpeta
        .trim_end_matches(['\\', '/'])
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .to_lowercase();
    std::fs::read_dir(&base)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().to_lowercase() == nombre)
        .map(|e| e.path())
        .collect()
}

#[derive(Serialize)]
pub struct SesionGuardada {
    id: String,
    titulo: String,
    /// Lo último que escribió el usuario (para distinguir conversaciones con el mismo título).
    ultimo: Option<String>,
    /// Milisegundos desde 1970 (última modificación).
    fecha: u64,
    bytes: u64,
}

/// Los primeros y los últimos `n` bytes del archivo, por líneas enteras.
fn trozos(ruta: &Path, n: u64) -> (String, String) {
    let Ok(mut f) = File::open(ruta) else {
        return Default::default();
    };
    let largo = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut leer = |desde: u64, cuanto: u64| {
        let mut buf = vec![0; cuanto as usize];
        let _ = f.seek(SeekFrom::Start(desde));
        let leido = f.read(&mut buf).unwrap_or(0);
        buf.truncate(leido);
        String::from_utf8_lossy(&buf).into_owned()
    };
    let principio = leer(0, n.min(largo));
    let fin = if largo > n { leer(largo - n, n) } else { String::new() };
    (principio, fin)
}

/// Texto escrito por el usuario en un mensaje `user` (sin recordatorios ni salidas de órdenes).
fn texto_usuario(v: &Value) -> Option<String> {
    if v["isMeta"].as_bool() == Some(true) || v["isCompactSummary"].as_bool() == Some(true) {
        return None;
    }
    let c = &v["message"]["content"];
    let t = match c {
        Value::String(s) => s.clone(),
        Value::Array(bloques) => {
            if bloques.iter().any(|b| b["type"] == "tool_result") {
                return None;
            }
            let textos: Vec<&str> = bloques.iter().filter_map(|b| b["text"].as_str()).collect();
            let imagenes = bloques.iter().filter(|b| b["type"] == "image").count();
            let mut t = textos.join("\n");
            if imagenes > 0 {
                let marca = if imagenes == 1 { "[1 imagen]".to_string() } else { format!("[{imagenes} imágenes]") };
                t = if t.is_empty() { marca } else { format!("{marca} {t}") };
            }
            t
        }
        _ => return None,
    };
    // Órdenes con barra: «<command-name>/compact</command-name>…» → «/compact …».
    if let Some(i) = t.find("<command-name>") {
        let resto = &t[i + 14..];
        let nombre = resto.split("</command-name>").next().unwrap_or("").trim();
        let args = t
            .split("<command-args>")
            .nth(1)
            .and_then(|a| a.split("</command-args>").next())
            .unwrap_or("")
            .trim();
        return Some(if args.is_empty() { nombre.to_string() } else { format!("{nombre} {args}") });
    }
    let t = t.trim();
    // Lo que mete el propio Claude Code como si fuera del usuario va entre etiquetas
    // (<system-reminder>, <task-notification>, <local-command-stdout>…).
    let etiqueta = t
        .strip_prefix('<')
        .and_then(|r| r.split_once('>'))
        .is_some_and(|(nombre, _)| !nombre.is_empty() && nombre.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
    if t.is_empty() || etiqueta || t.starts_with("Caveat:") {
        return None;
    }
    Some(t.to_string())
}

fn titulo_de(principio: &str, fin: &str) -> Option<String> {
    let lineas = |s: &str| s.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect::<Vec<_>>();
    let del_fin = lineas(fin);
    for clave in ["customTitle", "aiTitle"] {
        if let Some(t) = del_fin.iter().rev().find_map(|v| v[clave].as_str()) {
            return Some(t.to_string());
        }
    }
    let del_principio = lineas(principio);
    for clave in ["customTitle", "aiTitle"] {
        if let Some(t) = del_principio.iter().rev().find_map(|v| v[clave].as_str()) {
            return Some(t.to_string());
        }
    }
    del_principio
        .iter()
        .filter(|v| v["type"] == "user")
        .find_map(texto_usuario)
}

/// Conversaciones de Claude Code en `carpeta`, la más reciente primero (máx. 40).
#[tauri::command]
pub async fn claude_sesiones(carpeta: String) -> Result<Vec<SesionGuardada>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut archivos: Vec<(PathBuf, u64, u64)> = carpetas_de_proyecto(&carpeta)
            .iter()
            .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
            .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .filter_map(|e| {
                let m = e.metadata().ok()?;
                let fecha = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
                Some((e.path(), fecha, m.len()))
            })
            .collect();
        archivos.sort_by_key(|a| std::cmp::Reverse(a.1));
        archivos
            .into_iter()
            .take(60)
            .filter_map(|(ruta, fecha, bytes)| {
                let (principio, fin) = trozos(&ruta, 96 * 1024);
                // Sin ningún mensaje del usuario (Claude arrancado y cerrado): no se puede reanudar.
                let titulo = titulo_de(&principio, &fin)?;
                let id = ruta.file_stem()?.to_string_lossy().into_owned();
                // El último mensaje del usuario que se vea (principio y luego final); si no hay
                // ninguno entero en esos trozos, el `lastPrompt` que apunta Claude Code.
                let leer = |s: &str| s.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect::<Vec<_>>();
                let buscar = |lineas: &[Value]| {
                    lineas
                        .iter()
                        .rev()
                        .filter(|v| v["type"] == "user")
                        .find_map(texto_usuario)
                        .or_else(|| lineas.iter().rev().find_map(|v| v["lastPrompt"].as_str().map(String::from)))
                };
                let ultimo = buscar(&leer(&fin))
                    .or_else(|| buscar(&leer(&principio)))
                    .map(|t| t.trim().replace('\n', " "))
                    .filter(|t| !t.is_empty() && t.to_lowercase() != titulo.to_lowercase());
                Some(SesionGuardada {
                    id,
                    titulo: titulo.chars().take(120).collect(),
                    ultimo: ultimo.map(|t| t.chars().take(160).collect()),
                    fecha,
                    bytes,
                })
            })
            .take(40)
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Pasado {
    Tu { texto: String },
    Claude { texto: String },
    Herramienta { id: String, nombre: String, resumen: String, error: bool },
    Aviso { texto: String },
}

/// Lo que se ve de una conversación guardada: mensajes, respuestas y herramientas (las
/// últimas 400 piezas).
#[tauri::command]
pub async fn claude_historial(carpeta: String, id: String) -> Result<Vec<Pasado>, String> {
    if id.contains(['/', '\\', '.']) {
        return Err("id no válido".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let ruta = carpetas_de_proyecto(&carpeta)
            .into_iter()
            .map(|d| d.join(format!("{id}.jsonl")))
            .find(|r| r.is_file())
            .ok_or("no encuentro esa conversación")?;
        let f = File::open(&ruta).map_err(|e| e.to_string())?;
        let mut sal: Vec<Pasado> = Vec::new();
        let mut errores: HashMap<String, bool> = HashMap::new();
        for linea in BufReader::new(f).lines().map_while(Result::ok) {
            // Las líneas enormes que no son mensajes (instantáneas del prompt…) ni se analizan.
            if !(linea.contains("\"type\":\"user\"")
                || linea.contains("\"type\":\"assistant\"")
                || linea.contains("compact_boundary"))
            {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&linea) else { continue };
            if v["isSidechain"].as_bool() == Some(true) {
                continue;
            }
            match v["type"].as_str() {
                Some("user") => {
                    for b in v["message"]["content"].as_array().into_iter().flatten() {
                        if b["type"] == "tool_result"
                            && let Some(i) = b["tool_use_id"].as_str()
                        {
                            errores.insert(i.to_string(), b["is_error"].as_bool().unwrap_or(false));
                        }
                    }
                    if let Some(t) = texto_usuario(&v) {
                        if t.starts_with("[Request interrupted") {
                            sal.push(Pasado::Aviso { texto: "Parado por ti".into() });
                        } else {
                            sal.push(Pasado::Tu { texto: t });
                        }
                    }
                }
                Some("assistant") => {
                    if v["message"]["model"] == "<synthetic>" && v["message"]["content"][0]["text"].as_str().is_some_and(|t| t.starts_with("No response requested")) {
                        continue;
                    }
                    for b in v["message"]["content"].as_array().into_iter().flatten() {
                        match b["type"].as_str() {
                            Some("text") => {
                                let t = b["text"].as_str().unwrap_or("").trim();
                                if !t.is_empty() {
                                    sal.push(Pasado::Claude { texto: t.to_string() });
                                }
                            }
                            Some("tool_use") => {
                                let nombre = b["name"].as_str().unwrap_or("").to_string();
                                sal.push(Pasado::Herramienta {
                                    id: b["id"].as_str().unwrap_or("").to_string(),
                                    resumen: crate::claude::resumen(&nombre, &b["input"]),
                                    nombre,
                                    error: false,
                                });
                            }
                            _ => {}
                        }
                    }
                }
                Some("system") if v["subtype"] == "compact_boundary" => {
                    sal.push(Pasado::Aviso { texto: "Conversación compactada".into() });
                }
                _ => {}
            }
        }
        for p in &mut sal {
            if let Pasado::Herramienta { id, error, .. } = p {
                *error = errores.get(id).copied().unwrap_or(false);
            }
        }
        let quitar = sal.len().saturating_sub(400);
        sal.drain(..quitar);
        Ok(sal)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- @archivo ----------

const MAX_ARCHIVOS: usize = 40_000;

/// Lista de archivos y carpetas por carpeta de trabajo, guardada unos segundos.
type Lista = std::sync::Arc<Vec<String>>;
static LISTAS: Mutex<Option<HashMap<PathBuf, (Instant, Lista)>>> = Mutex::new(None);

fn listar(raiz: &Path) -> Lista {
    if let Ok(mut g) = LISTAS.lock() {
        let mapa = g.get_or_insert_with(HashMap::new);
        if let Some((cuando, lista)) = mapa.get(raiz)
            && cuando.elapsed() < Duration::from_secs(20)
        {
            return lista.clone();
        }
    }
    let mut lista = Vec::new();
    // Respeta .gitignore (también fuera de un repo). Los archivos ocultos sí entran (.env…),
    // pero no las carpetas ocultas (.git, .cargo, .cache…) salvo las de configuración del
    // proyecto, ni las que solo tienen dependencias o compilados.
    const CARPETAS_FUERA: [&str; 4] = ["node_modules", "target", "AppData", "__pycache__"];
    const OCULTAS_DENTRO: [&str; 3] = [".github", ".claude", ".vscode"];
    let paseo = ignore::WalkBuilder::new(raiz)
        .hidden(false)
        .require_git(false)
        .max_depth(Some(12))
        .filter_entry(|e| {
            if !e.file_type().is_some_and(|t| t.is_dir()) || e.depth() == 0 {
                return true;
            }
            let n = e.file_name().to_string_lossy();
            !CARPETAS_FUERA.contains(&n.as_ref()) && (!n.starts_with('.') || OCULTAS_DENTRO.contains(&n.as_ref()))
        })
        .build();
    for e in paseo.flatten() {
        if e.depth() == 0 {
            continue;
        }
        let Ok(rel) = e.path().strip_prefix(raiz) else { continue };
        let mut s = rel.to_string_lossy().replace('\\', "/");
        if e.file_type().is_some_and(|t| t.is_dir()) {
            s.push('/');
        }
        lista.push(s);
        if lista.len() >= MAX_ARCHIVOS {
            break;
        }
    }
    let lista = std::sync::Arc::new(lista);
    if let Ok(mut g) = LISTAS.lock() {
        g.get_or_insert_with(HashMap::new).insert(raiz.to_path_buf(), (Instant::now(), lista.clone()));
    }
    lista
}

/// Letras de `consulta` en orden dentro de `r[desde..]`: suma si van seguidas o al principio
/// de un trozo (tras «/», «-», «_», «.»).
fn encajar(r: &[char], desde: usize, consulta: &[char]) -> Option<i64> {
    let mut puntos = 0i64;
    let mut i = desde;
    let mut anterior: Option<usize> = None;
    for &q in consulta {
        let j = (i..r.len()).find(|&j| r[j] == q)?;
        if anterior.is_some_and(|a| a + 1 == j) {
            puntos += 15;
        }
        if j == 0 || matches!(r[j - 1], '/' | '-' | '_' | '.' | ' ') {
            puntos += 10;
        }
        anterior = Some(j);
        i = j + 1;
    }
    Some(puntos)
}

/// Puntuación de `ruta` para lo escrito (None = no encaja). Gana si encaja en el nombre del
/// archivo, y más si el nombre empieza así; las rutas cortas van antes.
fn puntuar(ruta: &str, consulta: &str) -> Option<i64> {
    let r: Vec<char> = ruta.to_lowercase().chars().collect();
    if consulta.is_empty() {
        return Some(-(r.len() as i64) - 40 * ruta.matches('/').count() as i64);
    }
    let q: Vec<char> = consulta.to_lowercase().chars().collect();
    let sin_barra = r.len() - usize::from(r.last() == Some(&'/'));
    let nombre = r[..sin_barra].iter().rposition(|&c| c == '/').map_or(0, |i| i + 1);
    let en_nombre = encajar(&r[..sin_barra], nombre, &q).map(|p| {
        let empieza = r[nombre..].starts_with(&q);
        p + 60 + if empieza { 50 } else { 0 }
    });
    let mut puntos = en_nombre.or_else(|| encajar(&r, 0, &q))?;
    // Lo escrito tal cual, seguido, vale mucho más que letras sueltas («kyu» en kyu-terminal
    // antes que en «virtual-keyboard»).
    let seguido: String = q.iter().collect();
    let ruta_min: String = r.iter().collect();
    if ruta_min[ruta_min.rfind('/').map_or(0, |i| i + 1)..].contains(&seguido) || r[nombre..].iter().collect::<String>().contains(&seguido) {
        puntos += 300;
    } else if ruta_min.contains(&seguido) {
        puntos += 200;
    }
    Some(puntos * 10 - r.len() as i64)
}

/// Archivos y carpetas de `carpeta` que encajan con `consulta` (los 30 mejores).
#[tauri::command]
pub async fn archivos_buscar(carpeta: String, consulta: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raiz = PathBuf::from(&carpeta);
        if !raiz.is_dir() {
            return Vec::new();
        }
        let lista = listar(&raiz);
        let consulta = consulta.replace('\\', "/");
        let mut con: Vec<(i64, &String)> = lista.iter().filter_map(|r| Some((puntuar(r, &consulta)?, r))).collect();
        con.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));
        con.into_iter().take(30).map(|(_, r)| r.clone()).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod pruebas {
    use super::puntuar;

    #[test]
    fn el_nombre_gana_a_la_ruta() {
        let a = puntuar("src/componentes/PanelClaude.tsx", "panel").unwrap();
        let b = puntuar("src/lib/paneles/otro.ts", "panel").unwrap();
        assert!(a > b);
        assert!(puntuar("src/lib/claude.ts", "xyz").is_none());
    }
}
