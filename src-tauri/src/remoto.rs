//! Archivos de un servidor por ssh (visor de archivos remoto). Usa el `ssh` del sistema con
//! los alias de ~/.ssh/config, el agente y el known_hosts de siempre, y BatchMode: si el alias
//! pide frase o contraseña sin agente, falla en vez de quedarse esperando.

use std::io::Write;
use std::process::{Command, Stdio};

use serde::Serialize;

/// Lo más que se lee de un archivo remoto (como en local).
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRADAS: usize = 2000;

#[derive(Serialize, Debug, PartialEq)]
pub struct Nodo {
    nombre: String,
    ruta: String,
    carpeta: bool,
}

/// Comillas simples para la shell remota.
fn comillas(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Un alias de ssh no puede empezar por «-» ni llevar espacios (iría como opción a ssh).
fn alias_valido(host: &str) -> Result<(), String> {
    if host.is_empty() || host.starts_with('-') || host.chars().any(|c| c.is_whitespace()) {
        return Err(format!("alias de ssh no válido: {host}"));
    }
    Ok(())
}

fn ssh(host: &str, orden: &str, entrada: Option<&[u8]>) -> Result<Vec<u8>, String> {
    alias_valido(host)?;
    let mut cmd = Command::new("ssh");
    cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        host,
        "--",
        orden,
    ])
    .stdin(if entrada.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut hijo = cmd
        .spawn()
        .map_err(|e| format!("no se pudo lanzar ssh: {e}"))?;
    if let Some(datos) = entrada {
        let mut stdin = hijo.stdin.take().ok_or("sin entrada para ssh")?;
        stdin
            .write_all(datos)
            .map_err(|e| format!("ssh se ha cerrado: {e}"))?;
    }
    let salida = hijo.wait_with_output().map_err(|e| e.to_string())?;
    if !salida.status.success() {
        let error = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("ssh {host} ha fallado")
        } else {
            error
        });
    }
    Ok(salida.stdout)
}

/// `find -printf '%y\t%f'` → nodos, primero las carpetas y luego por nombre.
fn leer_listado(carpeta: &str, salida: &str) -> Vec<Nodo> {
    let base = carpeta.trim_end_matches('/');
    let mut nodos: Vec<Nodo> = salida
        .lines()
        .filter_map(|l| {
            let (tipo, nombre) = l.split_once('\t')?;
            (!nombre.is_empty()).then(|| Nodo {
                ruta: format!("{base}/{nombre}"),
                nombre: nombre.to_string(),
                carpeta: tipo == "d",
            })
        })
        .collect();
    nodos.sort_by(|a, b| {
        b.carpeta
            .cmp(&a.carpeta)
            .then_with(|| a.nombre.to_lowercase().cmp(&b.nombre.to_lowercase()))
    });
    nodos.truncate(MAX_ENTRADAS);
    nodos
}

async fn en_hilo<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Carpeta de inicio del usuario en `host`.
#[tauri::command]
pub async fn remoto_inicio(host: String) -> Result<String, String> {
    en_hilo(move || {
        let s = ssh(&host, "pwd", None)?;
        Ok(String::from_utf8_lossy(&s).trim().to_string())
    })
    .await
}

#[tauri::command]
pub async fn remoto_listar(host: String, carpeta: String) -> Result<Vec<Nodo>, String> {
    en_hilo(move || {
        // `%y` con los enlaces a carpeta como carpeta (-L no sigue fuera del primer nivel).
        let orden = format!(
            "LC_ALL=C find -L {} -mindepth 1 -maxdepth 1 -printf '%y\\t%f\\n' 2>/dev/null",
            comillas(&carpeta)
        );
        let s = ssh(&host, &orden, None)?;
        Ok(leer_listado(&carpeta, &String::from_utf8_lossy(&s)))
    })
    .await
}

#[tauri::command]
pub async fn remoto_leer(host: String, ruta: String) -> Result<String, String> {
    en_hilo(move || {
        let orden = format!("head -c {} -- {}", MAX_BYTES + 1, comillas(&ruta));
        let s = ssh(&host, &orden, None)?;
        if s.len() > MAX_BYTES {
            return Err("es demasiado grande para abrirlo aquí (más de 8 MB)".into());
        }
        String::from_utf8(s).map_err(|_| "no es texto (UTF-8)".into())
    })
    .await
}

/// Sobrescribe el archivo (mantiene dueño y permisos: no se borra ni se mueve).
#[tauri::command]
pub async fn remoto_guardar(host: String, ruta: String, texto: String) -> Result<(), String> {
    en_hilo(move || {
        let orden = format!("cat > {}", comillas(&ruta));
        ssh(&host, &orden, Some(texto.as_bytes())).map(|_| ())
    })
    .await
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn comillas_para_la_shell() {
        assert_eq!(comillas("/etc/nginx"), "'/etc/nginx'");
        assert_eq!(comillas("it's"), r"'it'\''s'");
    }

    #[test]
    fn alias_raros_no_pasan() {
        assert!(alias_valido("web").is_ok());
        assert!(alias_valido("-oProxyCommand=x").is_err());
        assert!(alias_valido("web rm").is_err());
        assert!(alias_valido("").is_err());
    }

    #[test]
    fn listado_de_find() {
        let l = leer_listado("/etc/", "f\tnginx.conf\nd\tconf.d\nf\tB.txt\n\nd\tAa\n");
        let nombres: Vec<_> = l.iter().map(|n| (n.nombre.as_str(), n.carpeta)).collect();
        assert_eq!(
            nombres,
            [
                ("Aa", true),
                ("conf.d", true),
                ("B.txt", false),
                ("nginx.conf", false)
            ]
        );
        assert_eq!(l[1].ruta, "/etc/conf.d");
    }
}
