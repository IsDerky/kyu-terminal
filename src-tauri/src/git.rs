//! Git y GitHub para la barra de estado, la pestaña «Cambios», los avisos de CI y los issues.
//! Todo con el `git` y el `gh` de la máquina (con sus credenciales); Kyu no guarda tokens.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn orden(programa: &str, carpeta: &str) -> Command {
    let mut c = Command::new(programa);
    c.current_dir(carpeta);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Ejecuta y devuelve la salida; si falla, el error (lo que dijo por stderr).
fn correr(programa: &str, carpeta: &str, args: &[&str]) -> Result<String, String> {
    let salida = orden(programa, carpeta)
        .args(args)
        .output()
        .map_err(|e| format!("no se pudo lanzar {programa}: {e}"))?;
    if salida.status.success() {
        Ok(String::from_utf8_lossy(&salida.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        let out = String::from_utf8_lossy(&salida.stdout).trim().to_string();
        Err(if err.is_empty() { out } else { err })
    }
}

async fn en_hilo<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct Resumen {
    /// Carpeta raíz del repo.
    raiz: String,
    /// Rama actual (o el commit corto si no hay rama).
    rama: String,
    delante: u32,
    detras: u32,
    /// Archivos con cambios sin commit (incluidos los nuevos).
    cambios: u32,
    /// «dueño/repo» si origin está en GitHub.
    github: Option<String>,
}

/// «git@github.com:a/b.git» o «https://github.com/a/b(.git)» → «a/b».
fn repo_github(url: &str) -> Option<String> {
    let url = url.trim();
    let resto = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| url.strip_prefix("https://github.com/"))?;
    let r = resto.trim_end_matches('/').trim_end_matches(".git");
    (r.split('/').count() == 2).then(|| r.to_string())
}

fn resumen(carpeta: &str) -> Option<Resumen> {
    let raiz = correr("git", carpeta, &["rev-parse", "--show-toplevel"]).ok()?;
    let salida = correr(
        "git",
        carpeta,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
        ],
    )
    .ok()?;
    let (mut rama, mut oid) = (String::new(), String::new());
    let (mut delante, mut detras, mut cambios) = (0, 0, 0);
    for l in salida.lines() {
        if let Some(v) = l.strip_prefix("# branch.head ") {
            rama = v.to_string();
        } else if let Some(v) = l.strip_prefix("# branch.oid ") {
            oid = v.chars().take(7).collect();
        } else if let Some(v) = l.strip_prefix("# branch.ab ") {
            let mut p = v.split_whitespace();
            delante = p
                .next()
                .and_then(|x| x.trim_start_matches('+').parse().ok())
                .unwrap_or(0);
            detras = p
                .next()
                .and_then(|x| x.trim_start_matches('-').parse().ok())
                .unwrap_or(0);
        } else if !l.starts_with('#') && !l.is_empty() {
            cambios += 1;
        }
    }
    if rama == "(detached)" {
        rama = oid;
    }
    let github = correr("git", carpeta, &["remote", "get-url", "origin"])
        .ok()
        .and_then(|u| repo_github(&u));
    Some(Resumen {
        // git da la raíz con /; en Windows, con barras invertidas como el resto de rutas de Kyu.
        raiz: if cfg!(windows) {
            raiz.trim().replace('/', "\\")
        } else {
            raiz.trim().to_string()
        },
        rama,
        delante,
        detras,
        cambios,
        github,
    })
}

/// Rama, ahead/behind, cambios y repo de GitHub de la carpeta (None si no es un repo).
#[tauri::command]
pub async fn git_resumen(carpeta: String) -> Option<Resumen> {
    en_hilo(move || resumen(&carpeta)).await.ok().flatten()
}

#[derive(Serialize)]
pub struct Cambio {
    /// Ruta relativa a la raíz, con /.
    ruta: String,
    /// «M», «A», «D», «R» o «?» (nuevo sin seguir).
    estado: String,
}

/// Los archivos con cambios sin commit, relativos a la raíz del repo.
#[tauri::command]
pub async fn git_cambios(raiz: String) -> Result<Vec<Cambio>, String> {
    en_hilo(move || {
        let salida = correr(
            "git",
            &raiz,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?;
        let mut lista = Vec::new();
        let mut partes = salida.split('\0');
        while let Some(p) = partes.next() {
            if p.len() < 4 {
                continue;
            }
            let (x, y) = (&p[0..1], &p[1..2]);
            if x == "R" || x == "C" {
                partes.next();
            }
            let estado = if x == "?" {
                "?"
            } else if x == "R" || y == "R" {
                "R"
            } else if x == "A" {
                "A"
            } else if x == "D" || y == "D" {
                "D"
            } else {
                "M"
            };
            lista.push(Cambio {
                ruta: p[3..].to_string(),
                estado: estado.into(),
            });
        }
        Ok(lista)
    })
    .await?
}

/// Diff de un archivo frente a HEAD (los nuevos sin seguir: todo como añadido).
#[tauri::command]
pub async fn git_diff(raiz: String, ruta: String) -> Result<String, String> {
    en_hilo(move || {
        let seguido = correr("git", &raiz, &["ls-files", "--error-unmatch", "--", &ruta]).is_ok();
        if !seguido {
            let texto = std::fs::read_to_string(Path::new(&raiz).join(&ruta)).unwrap_or_default();
            let n = texto.lines().count();
            let mut d = format!("@@ -0,0 +1,{n} @@ (archivo nuevo)\n");
            for l in texto.lines().take(3000) {
                d.push('+');
                d.push_str(l);
                d.push('\n');
            }
            return Ok(d);
        }
        // Sin commits todavía no hay HEAD: contra lo preparado.
        let hay_head = correr("git", &raiz, &["rev-parse", "--verify", "HEAD"]).is_ok();
        let base = if hay_head { "HEAD" } else { "--cached" };
        correr(
            "git",
            &raiz,
            &["diff", "--no-color", "--no-ext-diff", base, "--", &ruta],
        )
    })
    .await?
}

/// Commit de esas rutas con ese mensaje y, con `subir`, push de la rama a origin.
#[tauri::command]
pub async fn git_commit(
    raiz: String,
    mensaje: String,
    rutas: Vec<String>,
    subir: bool,
) -> Result<String, String> {
    en_hilo(move || {
        if mensaje.trim().is_empty() {
            return Err("falta el mensaje del commit".into());
        }
        if rutas.is_empty() {
            return Err("no hay archivos marcados".into());
        }
        let mut add = vec!["add", "-A", "--"];
        add.extend(rutas.iter().map(String::as_str));
        correr("git", &raiz, &add)?;
        let mut commit = vec!["commit", "-m", mensaje.as_str(), "--"];
        commit.extend(rutas.iter().map(String::as_str));
        let mut salida = correr("git", &raiz, &commit)?;
        if subir {
            salida.push_str(
                &correr("git", &raiz, &["push", "origin", "HEAD"])
                    .map_err(|e| format!("commit hecho, pero el push falló: {e}"))?,
            );
        }
        Ok(salida)
    })
    .await?
}

/// Push de la rama actual (lo que va por delante).
#[tauri::command]
pub async fn git_subir(raiz: String) -> Result<String, String> {
    en_hilo(move || correr("git", &raiz, &["push", "origin", "HEAD"])).await?
}

/// Últimos runs de GitHub Actions del repo (todas las ramas y etiquetas), en JSON de `gh`.
#[tauri::command]
pub async fn gh_runs(raiz: String) -> Result<serde_json::Value, String> {
    en_hilo(move || {
        let s = correr(
            "gh",
            &raiz,
            &["run", "list", "--limit", "8", "--json", "databaseId,status,conclusion,workflowName,headBranch,displayTitle,url,createdAt,updatedAt"],
        )?;
        serde_json::from_str(&s).map_err(|e| e.to_string())
    })
    .await?
}

/// Issues abiertos del repo, en JSON de `gh`.
#[tauri::command]
pub async fn gh_issues(raiz: String) -> Result<serde_json::Value, String> {
    en_hilo(move || {
        let s = correr(
            "gh",
            &raiz,
            &[
                "issue",
                "list",
                "--state",
                "open",
                "--limit",
                "50",
                "--json",
                "number,title,body,url",
            ],
        )?;
        serde_json::from_str(&s).map_err(|e| e.to_string())
    })
    .await?
}

/// Worktree nuevo junto al repo (`<padre>/<nombre>`) en la rama `rama` (la crea si no existe).
/// Devuelve su carpeta.
#[tauri::command]
pub async fn git_worktree_nuevo(
    raiz: String,
    nombre: String,
    rama: String,
) -> Result<String, String> {
    en_hilo(move || {
        if nombre.contains(['/', '\\', '.']) || nombre.is_empty() {
            return Err("nombre de carpeta no válido".into());
        }
        let destino: PathBuf = Path::new(&raiz)
            .parent()
            .ok_or("el repo no tiene carpeta padre")?
            .join(&nombre);
        if destino.exists() {
            return Err(format!("ya existe {}", destino.display()));
        }
        let d = destino.to_string_lossy().into_owned();
        let existe = correr(
            "git",
            &raiz,
            &["rev-parse", "--verify", &format!("refs/heads/{rama}")],
        )
        .is_ok();
        if existe {
            correr("git", &raiz, &["worktree", "add", &d, &rama])?;
        } else {
            correr("git", &raiz, &["worktree", "add", "-b", &rama, &d])?;
        }
        Ok(d)
    })
    .await?
}

/// Quita un worktree (git se niega si tiene cambios sin commit).
#[tauri::command]
pub async fn git_worktree_quitar(raiz: String, ruta: String) -> Result<(), String> {
    en_hilo(move || correr("git", &raiz, &["worktree", "remove", &ruta]).map(|_| ())).await?
}

/// ¿Es `hash` un commit de este repo? (para no enlazar cualquier palabra hexadecimal).
#[tauri::command]
pub async fn git_es_commit(raiz: String, hash: String) -> bool {
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    en_hilo(move || {
        correr(
            "git",
            &raiz,
            &["cat-file", "-e", &format!("{hash}^{{commit}}")],
        )
        .is_ok()
    })
    .await
    .unwrap_or(false)
}

/// Mensaje de commit propuesto por Claude (Haiku, una sola vuelta) a partir de los diffs.
#[tauri::command]
pub async fn claude_mensaje_commit(raiz: String, diff: String) -> Result<String, String> {
    let config = crate::config::Config::cargar();
    let programa = crate::claude::buscar_programa(config.claude.as_deref())
        .ok_or("no encuentro Claude Code (claude)")?;
    en_hilo(move || {
        // Los últimos commits, para copiar su idioma y su estilo.
        let estilo = correr("git", &raiz, &["log", "-8", "--format=%s"]).unwrap_or_default();
        let instrucciones = format!(
            "Escribe el mensaje de commit para estos cambios. Solo el mensaje, sin comillas ni explicaciones: \
             una primera línea corta con prefijo convencional (feat:, fix:, chore:…), una línea en blanco y, si hace falta, \
             un párrafo breve que diga qué cambia y por qué. Sin firmas ni líneas Co-Authored-By. Mismo idioma y estilo que estos commits recientes del repo:\n{estilo}"
        );
        let mut hijo = Command::new(&programa);
        hijo.current_dir(&raiz)
            .args(["-p", &instrucciones, "--model", "haiku", "--output-format", "text"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            hijo.creation_flags(CREATE_NO_WINDOW);
        }
        let mut hijo = hijo.spawn().map_err(|e| format!("no se pudo lanzar claude: {e}"))?;
        // El diff por la entrada estándar (recortado: de sobra para un mensaje).
        let recorte: String = diff.chars().take(60_000).collect();
        if let Some(mut entrada) = hijo.stdin.take() {
            let _ = entrada.write_all(recorte.as_bytes());
        }
        let salida = hijo.wait_with_output().map_err(|e| e.to_string())?;
        if !salida.status.success() {
            return Err(String::from_utf8_lossy(&salida.stderr).trim().to_string());
        }
        Ok(sin_firmas(&String::from_utf8_lossy(&salida.stdout)))
    })
    .await?
}

/// Quita las firmas que añada Claude (Co-Authored-By, «Generated with»): los commits van sin firma de IA.
fn sin_firmas(texto: &str) -> String {
    texto
        .lines()
        .filter(|l| {
            let l = l.trim().to_lowercase();
            !l.starts_with("co-authored-by:") && !l.contains("generated with")
        })
        .collect::<Vec<_>>()
        .join(
            "
",
        )
        .trim()
        .to_string()
}

#[cfg(test)]
mod pruebas {
    use super::{repo_github, sin_firmas};

    #[test]
    fn sin_firmas_de_ia() {
        assert_eq!(
            sin_firmas(
                "feat: x

Cuerpo.

Co-Authored-By: Claude <a@b>
"
            ),
            "feat: x

Cuerpo."
        );
    }

    #[test]
    fn repos_de_github() {
        assert_eq!(
            repo_github("git@github.com:IsDerky/kyu-terminal.git").as_deref(),
            Some("IsDerky/kyu-terminal")
        );
        assert_eq!(
            repo_github("https://github.com/a/b").as_deref(),
            Some("a/b")
        );
        assert_eq!(
            repo_github("https://github.com/a/b.git\n").as_deref(),
            Some("a/b")
        );
        assert_eq!(repo_github("https://gitlab.com/a/b"), None);
    }
}
