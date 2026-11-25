//! Varias cuentas de Claude Code. Cada una es una carpeta de configuración propia
//! (`CLAUDE_CONFIG_DIR`) con su inicio de sesión. Por defecto comparten con la principal el
//! historial y la memoria (`projects`), los agentes, las skills y los ajustes, así una
//! conversación empezada con una cuenta se puede seguir con la otra (`--resume`).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

use crate::config::{Config, CuentaClaude};

/// Carpetas de la principal que se enlazan en las demás.
const COMPARTIDAS: &[&str] = &[
    "projects",
    "file-history",
    "agents",
    "skills",
    "commands",
    "plugins",
];
/// Archivos que se copian la primera vez (Claude Code los reescribe enteros: un enlace se
/// rompería al primer cambio).
const COPIADOS: &[&str] = &["settings.json", "CLAUDE.md", "keybindings.json"];

/// La carpeta de siempre: la de `CLAUDE_CONFIG_DIR` si Kyu arrancó con ella, si no ~/.claude.
pub fn carpeta_principal() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
}

/// `~/x` → carpeta personal; tiene que quedar una ruta absoluta (Claude Code no admite otra).
/// En Windows las `/` pasan a `\` (`mklink` no las entiende).
fn expandir(ruta: &str) -> Option<PathBuf> {
    let ruta = ruta.trim();
    let ruta = if cfg!(windows) {
        ruta.replace('/', "\\")
    } else {
        ruta.to_string()
    };
    let p = match ruta.strip_prefix("~\\").or_else(|| ruta.strip_prefix("~/")) {
        Some(resto) => dirs::home_dir()?.join(resto),
        None if ruta == "~" => dirs::home_dir()?,
        None => PathBuf::from(&ruta),
    };
    p.is_absolute().then_some(p)
}

pub struct Cuenta {
    pub nombre: String,
    pub carpeta: PathBuf,
    pub principal: bool,
    pub compartir: bool,
}

fn resolver(c: &CuentaClaude) -> Option<Cuenta> {
    let principal = carpeta_principal()?;
    let carpeta = match &c.carpeta {
        Some(r) if !r.trim().is_empty() => expandir(r)?,
        _ => principal.clone(),
    };
    Some(Cuenta {
        nombre: c.nombre.clone(),
        principal: misma(&carpeta, &principal),
        carpeta,
        compartir: c.compartir.unwrap_or(true),
    })
}

fn misma(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        p.to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .replace('\\', "/")
            .to_lowercase()
    };
    norm(a) == norm(b)
}

/// La cuenta con ese nombre (None si no hay o no existe: se usa la de siempre).
pub fn buscar(config: &Config, nombre: Option<&str>) -> Option<Cuenta> {
    let nombre = nombre?;
    config
        .cuentas_claude
        .iter()
        .find(|c| c.nombre == nombre)
        .and_then(resolver)
}

/// Deja lista la carpeta de una cuenta que no es la principal: la crea y, si comparte,
/// enlaza las carpetas de la principal y copia sus ajustes. Lo que ya exista no se toca.
pub fn preparar(c: &Cuenta) -> Result<(), String> {
    if c.principal {
        return Ok(());
    }
    std::fs::create_dir_all(&c.carpeta)
        .map_err(|e| format!("no se pudo crear {}: {e}", c.carpeta.display()))?;
    if !c.compartir {
        return Ok(());
    }
    let Some(principal) = carpeta_principal() else {
        return Ok(());
    };
    for nombre in COMPARTIDAS {
        let destino = c.carpeta.join(nombre);
        if destino.symlink_metadata().is_ok() {
            continue;
        }
        let origen = principal.join(nombre);
        // El historial se comparte siempre, aunque la principal aún no lo tenga.
        if !origen.is_dir() && matches!(*nombre, "projects" | "file-history") {
            let _ = std::fs::create_dir_all(&origen);
        }
        if origen.is_dir() {
            enlazar(&origen, &destino)?;
        }
    }
    for nombre in COPIADOS {
        let destino = c.carpeta.join(nombre);
        let origen = principal.join(nombre);
        if !destino.exists() && origen.is_file() {
            let _ = std::fs::copy(&origen, &destino);
        }
    }
    copiar_confianza(&json_de(&principal), &c.carpeta.join(".claude.json"));
    Ok(())
}

/// `.claude.json` de una carpeta de configuración: dentro de ella, salvo la de siempre sin
/// `CLAUDE_CONFIG_DIR`, que está en la carpeta personal (~/.claude.json).
fn json_de(carpeta: &Path) -> PathBuf {
    let por_defecto = std::env::var_os("CLAUDE_CONFIG_DIR").is_none()
        && dirs::home_dir().is_some_and(|h| misma(carpeta, &h.join(".claude")));
    match (por_defecto, dirs::home_dir()) {
        (true, Some(h)) => h.join(".claude.json"),
        _ => carpeta.join(".claude.json"),
    }
}

/// Las carpetas en las que la principal ya aceptó «confiar en este proyecto» quedan aceptadas
/// también en la otra cuenta (si no, Claude Code ignora sus permisos y ajustes de proyecto).
/// Solo añade `hasTrustDialogAccepted`; el resto de ese archivo es de Claude Code.
fn copiar_confianza(origen: &Path, destino: &Path) {
    let leer = |p: &Path| {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    };
    let Some(principal) = leer(origen) else {
        return;
    };
    let Some(proyectos) = principal["projects"].as_object() else {
        return;
    };
    let confiadas: Vec<&String> = proyectos
        .iter()
        .filter(|(_, v)| v["hasTrustDialogAccepted"].as_bool() == Some(true))
        .map(|(k, _)| k)
        .collect();
    // Si existe pero no se puede leer, mejor no tocarlo.
    let mut otra = match leer(destino) {
        Some(v) if v.is_object() => v,
        Some(_) => return,
        None if destino.exists() => return,
        None => Value::Object(Default::default()),
    };
    let mut cambiado = false;
    if !otra["projects"].is_object() {
        otra["projects"] = Value::Object(Default::default());
    }
    for k in confiadas {
        let p = &mut otra["projects"][k.as_str()];
        if p["hasTrustDialogAccepted"].as_bool() != Some(true) {
            if !p.is_object() {
                *p = Value::Object(Default::default());
            }
            p["hasTrustDialogAccepted"] = Value::Bool(true);
            cambiado = true;
        }
    }
    if cambiado && let Ok(texto) = serde_json::to_string_pretty(&otra) {
        // Escribir aparte y renombrar: Claude Code puede estar leyéndolo.
        let temporal = destino.with_extension("json.kyu");
        if std::fs::write(&temporal, texto).is_ok() {
            let _ = std::fs::rename(&temporal, destino);
        }
    }
}

/// Enlace de carpeta: unión (junction) en Windows, que no pide permisos de administrador.
fn enlazar(origen: &Path, destino: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let salida = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(destino)
            .arg(origen)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("no se pudo lanzar mklink: {e}"))?;
        if !salida.status.success() {
            let motivo = String::from_utf8_lossy(&salida.stderr);
            return Err(format!(
                "no se pudo enlazar {} con {}: {}",
                destino.display(),
                origen.display(),
                motivo.trim()
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(origen, destino).map_err(|e| {
            format!(
                "no se pudo enlazar {} con {}: {e}",
                destino.display(),
                origen.display()
            )
        })
    }
}

/// Orden de Claude Code con la carpeta de la cuenta puesta (si no es la principal).
fn orden_claude(config: &Config, c: &Cuenta) -> Result<Command, String> {
    let programa = crate::claude::buscar_programa(config.claude.as_deref())
        .ok_or("no encuentro Claude Code (claude)")?;
    let mut cmd = Command::new(programa);
    if !c.principal {
        cmd.env("CLAUDE_CONFIG_DIR", &c.carpeta);
    }
    Ok(cmd)
}

#[derive(Serialize)]
pub struct CuentaVista {
    nombre: String,
    carpeta: String,
    principal: bool,
    compartir: bool,
    /// Con sesión iniciada: correo y plan (pro, max…).
    sesion: bool,
    correo: Option<String>,
    plan: Option<String>,
}

/// Las cuentas de kyu.toml con quién ha iniciado sesión en cada una (`claude auth status`).
#[tauri::command]
pub async fn claude_cuentas() -> Result<Vec<CuentaVista>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = Config::cargar();
        let hilos: Vec<_> = config
            .cuentas_claude
            .iter()
            .filter_map(resolver)
            .map(|c| {
                let cmd = orden_claude(&config, &c);
                std::thread::spawn(move || {
                    let estado = cmd.ok().and_then(|mut cmd| {
                        cmd.args(["auth", "status"]);
                        sin_ventana(&mut cmd);
                        let salida = cmd.output().ok()?;
                        serde_json::from_slice::<Value>(&salida.stdout).ok()
                    });
                    let texto = |k: &str| {
                        estado
                            .as_ref()
                            .and_then(|v| v[k].as_str())
                            .filter(|s| !s.is_empty())
                            .map(String::from)
                    };
                    CuentaVista {
                        sesion: estado
                            .as_ref()
                            .and_then(|v| v["loggedIn"].as_bool())
                            .unwrap_or(false),
                        correo: texto("email"),
                        plan: texto("subscriptionType"),
                        nombre: c.nombre,
                        carpeta: c.carpeta.display().to_string(),
                        principal: c.principal,
                        compartir: c.compartir,
                    }
                })
            })
            .collect();
        hilos
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Abre una consola con `claude auth login` para esa cuenta (el navegador hace el resto).
#[tauri::command]
pub fn claude_cuenta_entrar(nombre: String) -> Result<(), String> {
    let config = Config::cargar();
    let c = buscar(&config, Some(&nombre)).ok_or("esa cuenta no está en kyu.toml")?;
    preparar(&c)?;
    let mut cmd = orden_claude(&config, &c)?;
    cmd.args(["auth", "login"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("no se pudo abrir el inicio de sesión: {e}"))
}

/// Añade una cuenta a kyu.toml con su carpeta `~/.claude-<nombre>`. Si aún no había
/// ninguna, antes añade «Principal» (la de siempre), para poder volver a ella.
#[tauri::command]
pub fn claude_cuenta_anadir(nombre: String) -> Result<(), String> {
    let nombre = nombre.trim().to_string();
    if nombre.is_empty() {
        return Err("ponle un nombre".into());
    }
    let config = Config::cargar();
    if config.cuentas_claude.iter().any(|c| c.nombre == nombre) {
        return Err(format!("ya hay una cuenta «{nombre}»"));
    }
    let carpeta = format!("~/.claude-{}", carpeta_para(&nombre));
    if config
        .cuentas_claude
        .iter()
        .any(|c| c.carpeta.as_deref() == Some(carpeta.as_str()))
    {
        return Err(format!("{carpeta} ya es de otra cuenta"));
    }
    let mut doc = crate::ajustes::leer_documento()?;
    if !doc.contains_array_of_tables("cuentas_claude") {
        doc["cuentas_claude"] = toml_edit::Item::ArrayOfTables(toml_edit::ArrayOfTables::new());
    }
    let lista = doc["cuentas_claude"]
        .as_array_of_tables_mut()
        .ok_or("cuentas_claude no es una lista de tablas en kyu.toml")?;
    if lista.is_empty() {
        let mut principal = toml_edit::Table::new();
        principal["nombre"] = toml_edit::value("Principal");
        lista.push(principal);
    }
    let mut nueva = toml_edit::Table::new();
    nueva["nombre"] = toml_edit::value(nombre.as_str());
    nueva["carpeta"] = toml_edit::value(carpeta.as_str());
    lista.push(nueva);
    crate::ajustes::escribir_documento(&doc)
}

/// Quita la cuenta de kyu.toml (su carpeta y su sesión se quedan en el disco).
#[tauri::command]
pub fn claude_cuenta_quitar(nombre: String) -> Result<(), String> {
    let mut doc = crate::ajustes::leer_documento()?;
    let lista = doc["cuentas_claude"]
        .as_array_of_tables_mut()
        .ok_or("no hay cuentas en kyu.toml")?;
    let antes = lista.len();
    lista.retain(|t| t.get("nombre").and_then(|v| v.as_str()) != Some(nombre.as_str()));
    if lista.len() == antes {
        return Err(format!("no hay ninguna cuenta «{nombre}»"));
    }
    // Con una sola ya no hay nada que elegir.
    if lista.len() <= 1 {
        doc.remove("cuentas_claude");
    }
    crate::ajustes::escribir_documento(&doc)
}

/// «Cuenta Trabajo» → «cuenta-trabajo».
fn carpeta_para(nombre: &str) -> String {
    let mut s = String::new();
    for ch in nombre.to_lowercase().chars() {
        let ch = match ch {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            c => c,
        };
        if ch.is_ascii_alphanumeric() {
            s.push(ch);
        } else if !s.ends_with('-') {
            s.push('-');
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "otra".into() } else { s }
}

fn sin_ventana(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn nombre_de_carpeta() {
        assert_eq!(carpeta_para("Trabajo"), "trabajo");
        assert_eq!(carpeta_para("Cuenta Dos"), "cuenta-dos");
        assert_eq!(carpeta_para("Diseño / 2"), "diseno-2");
        assert_eq!(carpeta_para("  ¿?  "), "otra");
    }

    #[test]
    fn copia_la_confianza() {
        let dir = std::env::temp_dir().join(format!("kyu-prueba-confianza-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let origen = dir.join("a.json");
        let destino = dir.join("b.json");
        std::fs::write(
            &origen,
            r#"{"projects":{"C:/p1":{"hasTrustDialogAccepted":true,"x":1},"C:/p2":{"hasTrustDialogAccepted":false}}}"#,
        )
        .unwrap();
        std::fs::write(&destino, r#"{"userID":"u","projects":{"C:/p3":{"y":2}}}"#).unwrap();
        copiar_confianza(&origen, &destino);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&destino).unwrap()).unwrap();
        assert_eq!(v["userID"], "u");
        assert_eq!(v["projects"]["C:/p1"]["hasTrustDialogAccepted"], true);
        assert!(v["projects"]["C:/p1"]["x"].is_null());
        assert!(v["projects"]["C:/p2"].is_null());
        assert_eq!(v["projects"]["C:/p3"]["y"], 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rutas() {
        let casa = dirs::home_dir().unwrap();
        assert_eq!(expandir("~/.claude-b"), Some(casa.join(".claude-b")));
        #[cfg(windows)]
        assert_eq!(expandir("C:/x/y"), Some(PathBuf::from(r"C:\x\y")));
        assert_eq!(expandir("relativa"), None);
        assert!(misma(Path::new("C:\\a\\B\\"), Path::new("c:/a/b")));
    }
}
