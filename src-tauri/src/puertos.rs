//! Puertos ocupados: quién escucha en un puerto TCP y cerrarlo (con el `netstat`/`tasklist`/
//! `taskkill` de Windows o el `ss`/`kill` de Linux; nada que instalar).

use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Proceso {
    pid: u32,
    nombre: String,
}

fn sin_ventana(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn salida(cmd: &mut Command) -> Option<String> {
    let s = sin_ventana(cmd).output().ok()?;
    s.status
        .success()
        .then(|| String::from_utf8_lossy(&s.stdout).into_owned())
}

/// PID que escucha en `puerto` según la salida de `netstat -ano -p TCP` (y TCPv6).
#[cfg_attr(not(windows), allow(dead_code))]
fn pid_en_netstat(texto: &str, puerto: u16) -> Option<u32> {
    let fin = format!(":{puerto}");
    texto.lines().find_map(|l| {
        let c: Vec<&str> = l.split_whitespace().collect();
        // TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  1234   (el estado va traducido: ESCUCHANDO…)
        if c.len() == 5
            && c[0].eq_ignore_ascii_case("TCP")
            && c[1].ends_with(&fin)
            && c[2].ends_with(":0")
        {
            c[4].parse().ok().filter(|p| *p != 0)
        } else {
            None
        }
    })
}

/// PID y nombre de la salida de `ss -ltnpH`: `… users:(("node",pid=1234,fd=20))`.
#[cfg_attr(windows, allow(dead_code))]
fn pid_en_ss(texto: &str, puerto: u16) -> Option<Proceso> {
    let fin = format!(":{puerto}");
    texto.lines().find_map(|l| {
        let c: Vec<&str> = l.split_whitespace().collect();
        let local = c.get(3)?;
        if !local.ends_with(&fin) {
            return None;
        }
        let usuarios = l.split("users:((\"").nth(1)?;
        let nombre = usuarios.split('"').next()?.to_string();
        let pid = usuarios
            .split("pid=")
            .nth(1)?
            .split(|ch: char| !ch.is_ascii_digit())
            .next()?
            .parse()
            .ok()?;
        Some(Proceso { pid, nombre })
    })
}

/// Quién escucha en `puerto` (TCP). `None` si nadie o no se puede saber.
#[tauri::command]
pub async fn puerto_quien(puerto: u16) -> Option<Proceso> {
    tauri::async_runtime::spawn_blocking(move || quien(puerto))
        .await
        .ok()
        .flatten()
}

#[cfg(windows)]
fn quien(puerto: u16) -> Option<Proceso> {
    let texto = salida(Command::new("netstat").args(["-ano", "-p", "TCP"]))
        .into_iter()
        .chain(salida(
            Command::new("netstat").args(["-ano", "-p", "TCPv6"]),
        ))
        .collect::<Vec<_>>()
        .join("\n");
    let pid = pid_en_netstat(&texto, puerto)?;
    // "node.exe","1234","Console","1","45.000 KB"
    let lista = salida(Command::new("tasklist").args([
        "/FI",
        &format!("PID eq {pid}"),
        "/FO",
        "CSV",
        "/NH",
    ]))
    .unwrap_or_default();
    let nombre = lista
        .lines()
        .next()
        .and_then(|l| l.split('"').nth(1))
        .filter(|n| !n.is_empty() && !n.starts_with("INFO"))
        .unwrap_or("?")
        .to_string();
    Some(Proceso { pid, nombre })
}

#[cfg(not(windows))]
fn quien(puerto: u16) -> Option<Proceso> {
    let texto = salida(Command::new("ss").args(["-ltnpH"]))?;
    pid_en_ss(&texto, puerto)
}

/// Cierra el proceso `pid` con lo que haya lanzado (en Windows, el árbol entero: un
/// `npm run dev` deja el servidor en un `node` hijo).
#[tauri::command]
pub async fn proceso_matar(pid: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("taskkill");
            c.args(["/PID", &pid.to_string(), "/T", "/F"]);
            c
        } else {
            let mut c = Command::new("kill");
            c.args(["-TERM", &pid.to_string()]);
            c
        };
        let s = sin_ventana(&mut cmd).output().map_err(|e| e.to_string())?;
        if s.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&s.stderr).trim().to_string();
            Err(if err.is_empty() {
                format!("no se pudo cerrar el proceso {pid}")
            } else {
                err
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn netstat() {
        let t = "\n  Proto  Dirección local  Dirección remota  Estado  PID\n  TCP    0.0.0.0:135   0.0.0.0:0   ESCUCHANDO   1100\n  TCP    127.0.0.1:30000  0.0.0.0:0  ESCUCHANDO  77\n  TCP    0.0.0.0:3000   0.0.0.0:0   ESCUCHANDO   4242\n  TCP    127.0.0.1:3000  127.0.0.1:51000  ESTABLECIDA  4242\n  TCP    [::]:5173   [::]:0   LISTENING   999";
        assert_eq!(pid_en_netstat(t, 3000), Some(4242));
        assert_eq!(pid_en_netstat(t, 5173), Some(999));
        assert_eq!(pid_en_netstat(t, 300), None);
    }

    #[test]
    fn ss() {
        let t = "LISTEN 0 511 *:3000 *:* users:((\"node\",pid=1234,fd=20))\nLISTEN 0 4096 127.0.0.1:631 0.0.0.0:* ";
        assert_eq!(
            pid_en_ss(t, 3000),
            Some(Proceso {
                pid: 1234,
                nombre: "node".into()
            })
        );
        assert_eq!(pid_en_ss(t, 631), None);
    }
}
