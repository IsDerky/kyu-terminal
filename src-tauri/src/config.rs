//! Configuración de `kyu.toml`: perfiles de shell, fuente y colores del tema.
//!
//! El archivo vive en `<config>/kyu/kyu.toml` (en Windows `%APPDATA%\kyu\kyu.toml`), o en
//! `datos\kyu.toml` junto al ejecutable en la versión portable (ver `carpeta_kyu`).
//! Si no existe se usan los valores de aquí: aspecto «Sobrio» y los perfiles que haya
//! en el equipo (PowerShell, Git Bash, WSL…).

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Config {
    /// Programa de la shell; vacío = la de siempre del sistema. Si se pone, es el
    /// primer perfil («Shell»).
    pub shell: Option<String>,
    pub argumentos: Vec<String>,
    /// Perfiles propios; si no hay ninguno se detectan los del equipo.
    pub perfiles: Vec<Perfil>,
    /// Familia de la fuente (p. ej. "JetBrainsMono Nerd Font Mono"); vacío = la primera
    /// Nerd Font conocida que haya instalada.
    pub fuente: Option<String>,
    /// `true` = no cargar el prompt de Kyu y dejar el de tu perfil (oh-my-posh…).
    pub sin_prompt: bool,
    /// Ruta de Claude Code; vacío = el `claude` del PATH.
    pub claude: Option<String>,
    /// Sugerencia en gris mientras escribes (historial de Kyu, carpetas, ramas,
    /// scripts). Sin poner = sí.
    pub autocompletado: Option<bool>,
    /// Aviso de Windows cuando termina una orden que ha tardado al menos estos
    /// segundos y Kyu no está delante. Sin poner = 10; 0 = nunca.
    pub aviso_segundos: Option<u32>,
    /// Perfil de las pestañas nuevas (por nombre); sin poner = el primero.
    pub perfil_predeterminado: Option<String>,
    /// Al abrir, volver a los espacios, paneles, pestañas y conversaciones de la última
    /// vez. Sin poner = sí.
    pub restaurar_sesion: Option<bool>,
    /// Un perfil por cada `Host` de ~/.ssh/config (sin comodines). Sin poner = sí.
    pub perfiles_ssh: Option<bool>,
    /// Límite diario de Claude en miles de tokens de salida (aviso al 80 % y al 100 %).
    /// Sin poner o 0 = sin límite.
    pub limite_diario: Option<u64>,
    /// Respuesta que propone Claude Code tras cada turno, en gris en la caja del panel
    /// (Tab la usa). Sin poner = sí.
    pub sugerencias_claude: Option<bool>,
    /// Barra de pasos (runbook) encima de la caja cuando Claude da varias órdenes. Sin poner = no.
    pub runbook: Option<bool>,
    /// Cuentas de Claude entre las que elegir en el panel. Sin ninguna = la de siempre.
    pub cuentas_claude: Vec<CuentaClaude>,
    /// Cuentas de Antigravity en Windows (intercambio de credencial). Sin ninguna = la de siempre.
    pub cuentas_antigravity: Vec<CuentaAntigravity>,
    /// Mirar al abrir si hay versión nueva en GitHub. Sin poner = sí (nunca en la portable).
    pub buscar_actualizaciones: Option<bool>,
    pub tema: Tema,
}

/// Una cuenta de Claude Code: su carpeta de configuración (`CLAUDE_CONFIG_DIR`), donde
/// guarda su inicio de sesión.
#[derive(Deserialize, Clone)]
pub struct CuentaClaude {
    pub nombre: String,
    /// Sin poner = la carpeta de siempre (~/.claude). Admite `~/`.
    #[serde(default)]
    pub carpeta: Option<String>,
    /// Compartir con la principal el historial, la memoria, los agentes, las skills y
    /// los ajustes (para seguir una conversación con esta cuenta). Sin poner = sí.
    #[serde(default)]
    pub compartir: Option<bool>,
}

/// Una cuenta de Antigravity (respaldo de su credencial de Windows por nombre).
#[derive(Deserialize, Clone)]
pub struct CuentaAntigravity {
    pub nombre: String,
}

impl Config {
    pub fn autocompletado(&self) -> bool {
        self.autocompletado.unwrap_or(true)
    }

    pub fn sugerencias_claude(&self) -> bool {
        self.sugerencias_claude.unwrap_or(true)
    }

    pub fn runbook(&self) -> bool {
        self.runbook.unwrap_or(false)
    }

    pub fn buscar_actualizaciones(&self) -> bool {
        self.buscar_actualizaciones.unwrap_or(true)
    }

    pub fn restaurar_sesion(&self) -> bool {
        self.restaurar_sesion.unwrap_or(true)
    }

    pub fn perfiles_ssh(&self) -> bool {
        self.perfiles_ssh.unwrap_or(true)
    }
}

/// Lo que abre una pestaña de terminal.
#[derive(Deserialize, Serialize, Clone)]
pub struct Perfil {
    pub nombre: String,
    pub shell: String,
    #[serde(default)]
    pub argumentos: Vec<String>,
    /// `#rrggbb` del punto de la pestaña.
    #[serde(default)]
    pub color: Option<String>,
    /// powershell, bash, linux, cmd, servidor
    #[serde(default)]
    pub icono: Option<String>,
}

/// Se prueban por orden si `kyu.toml` no dice ninguna; el navegador usa la primera instalada.
pub(crate) const FUENTES_CONOCIDAS: &[&str] = &[
    "FiraCode Nerd Font Mono",
    "JetBrainsMono Nerd Font Mono",
    "CaskaydiaCove Nerd Font Mono",
    "Cascadia Mono",
    "Consolas",
    "DejaVu Sans Mono",
    "monospace",
];

#[derive(Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct Tema {
    pub fuente_tamano: f32,
    pub fondo: String,
    pub texto: String,
    pub cursor: String,
    pub seleccion: String,
    /// Los 16 colores ANSI: 8 normales y 8 brillantes.
    pub ansi: [String; 16],
}

impl Default for Tema {
    fn default() -> Self {
        let c = |s: &str| s.to_string();
        Self {
            fuente_tamano: 14.0,
            fondo: c("#0b0b0d"),
            texto: c("#ececf1"),
            cursor: c("#4ade80"),
            seleccion: c("#3b3552"),
            ansi: [
                c("#1f1f24"),
                c("#f87171"),
                c("#4ade80"),
                c("#fbbf24"),
                c("#60a5fa"),
                c("#a78bfa"),
                c("#67e8f9"),
                c("#ececf1"),
                c("#55555e"),
                c("#fca5a5"),
                c("#86efac"),
                c("#fde68a"),
                c("#93c5fd"),
                c("#c4b5fd"),
                c("#a5f3fc"),
                c("#ffffff"),
            ],
        }
    }
}

/// Lo que necesita la ventana para pintar los terminales y los menús de perfiles.
#[derive(Serialize)]
pub struct ConfigVista {
    fuente: String,
    autocompletado: bool,
    aviso_segundos: u32,
    restaurar_sesion: bool,
    limite_diario: u64,
    /// Nombres de las cuentas de Claude (vacío = solo la de siempre, sin selector).
    cuentas_claude: Vec<String>,
    /// Nombres de las cuentas de Antigravity (vacío = solo la de siempre, sin selector).
    cuentas_antigravity: Vec<String>,
    sugerencias_claude: bool,
    runbook: bool,
    /// Buscar versión nueva al abrir (false en la portable: se actualiza a mano).
    actualizaciones: bool,
    portable: bool,
    tema: Tema,
    perfiles: Vec<PerfilVista>,
}

#[derive(Serialize)]
pub struct PerfilVista {
    nombre: String,
    color: String,
    icono: String,
}

#[tauri::command]
pub fn config() -> ConfigVista {
    let config = Config::cargar();
    let mut familias: Vec<String> = config.fuente.iter().cloned().collect();
    familias.extend(FUENTES_CONOCIDAS.iter().map(|f| f.to_string()));
    let fuente = familias
        .iter()
        .map(|f| {
            if f == "monospace" {
                f.clone()
            } else {
                format!("\"{f}\"")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    let perfiles = config
        .perfiles()
        .into_iter()
        .map(|p| PerfilVista {
            color: p.color.unwrap_or_else(|| "#a78bfa".into()),
            icono: p.icono.unwrap_or_else(|| "terminal".into()),
            nombre: p.nombre,
        })
        .collect();
    ConfigVista {
        fuente,
        autocompletado: config.autocompletado(),
        aviso_segundos: config.aviso_segundos.unwrap_or(10),
        restaurar_sesion: config.restaurar_sesion(),
        limite_diario: config.limite_diario.unwrap_or(0),
        cuentas_claude: config
            .cuentas_claude
            .iter()
            .map(|c| c.nombre.clone())
            .collect(),
        cuentas_antigravity: config
            .cuentas_antigravity
            .iter()
            .map(|c| c.nombre.clone())
            .collect(),
        sugerencias_claude: config.sugerencias_claude(),
        runbook: config.runbook(),
        actualizaciones: config.buscar_actualizaciones() && carpeta_portable().is_none(),
        portable: carpeta_portable().is_some(),
        perfiles,
        tema: config.tema,
    }
}

impl Config {
    pub fn cargar() -> Self {
        let Some(ruta) = carpeta_kyu().map(|d| d.join("kyu.toml")) else {
            return Self::default();
        };
        match std::fs::read_to_string(&ruta) {
            Ok(texto) => toml::from_str(&texto).unwrap_or_else(|e| {
                eprintln!("kyu.toml no es válido, uso los valores por defecto: {e}");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    /// Los perfiles a ofrecer, el primero es el predeterminado.
    pub fn perfiles(&self) -> Vec<Perfil> {
        let mut lista = Vec::new();
        if let Some(shell) = &self.shell {
            lista.push(Perfil {
                nombre: "Shell".into(),
                shell: shell.clone(),
                argumentos: self.argumentos.clone(),
                color: None,
                icono: None,
            });
        }
        if !self.perfiles.is_empty() {
            lista.extend(self.perfiles.iter().cloned());
        } else {
            lista.extend(detectar_perfiles());
        }
        if self.perfiles_ssh() {
            // Los de kyu.toml mandan: un Host con el mismo nombre no se repite.
            for p in perfiles_ssh() {
                if !lista.iter().any(|q| q.nombre == p.nombre) {
                    lista.push(p);
                }
            }
        }
        if let Some(pred) = &self.perfil_predeterminado
            && let Some(i) = lista.iter().position(|p| &p.nombre == pred)
        {
            let p = lista.remove(i);
            lista.insert(0, p);
        }
        lista
    }

    /// Programa, argumentos y variables de entorno para lanzar un perfil (añade el
    /// prompt de Kyu a PowerShell y a bash).
    pub fn orden_de(&self, nombre: &str) -> Option<Lanzar> {
        let perfiles = self.perfiles();
        let perfil = perfiles
            .iter()
            .find(|p| p.nombre == nombre)
            .or(perfiles.first())?;
        let mut argumentos = perfil.argumentos.clone();
        let mut entorno = Vec::new();
        if self.autocompletado() {
            // kyu.ps1 apaga entonces la sugerencia de PSReadLine (no dos fantasmas).
            entorno.push(("KYU_AUTOCOMPLETADO".into(), "1".into()));
        }
        if !self.sin_prompt {
            prompt_bash(&perfil.shell, &mut argumentos, &mut entorno);
        }
        #[cfg(windows)]
        {
            let es_powershell = {
                let s = perfil.shell.to_lowercase();
                s.ends_with("powershell.exe") || s.ends_with("pwsh.exe") || s == "pwsh"
            };
            if es_powershell
                && !self.sin_prompt
                && !argumentos
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case("-Command"))
                && let Some(script) = preparar_prompt_pwsh()
            {
                argumentos.extend([
                    "-NoExit".into(),
                    "-Command".into(),
                    format!(". '{}'", script.display()),
                ]);
            }
        }
        Some(Lanzar {
            shell: perfil.shell.clone(),
            argumentos,
            entorno,
        })
    }
}

pub struct Lanzar {
    pub shell: String,
    pub argumentos: Vec<String>,
    pub entorno: Vec<(String, String)>,
}

/// bash (Git Bash, WSL o Linux): se arranca con `--rcfile shell/kyu.bash -i`, que carga
/// la configuración de siempre y pone el prompt de Kyu. Solo si el perfil no trae ya
/// su propia orden (`-c`, `--rcfile`, un programa para WSL…).
fn prompt_bash(shell: &str, argumentos: &mut Vec<String>, entorno: &mut Vec<(String, String)>) {
    let programa = std::path::Path::new(shell)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let solo_opciones_de_login = argumentos
        .iter()
        .all(|a| matches!(a.as_str(), "--login" | "-l" | "-i" | "--norc"));
    if programa == "bash" || programa == "bash.exe" {
        if !solo_opciones_de_login {
            return;
        }
        let Some(script) = preparar_prompt_bash() else {
            return;
        };
        // Con --login en el perfil (Git Bash lo trae), kyu.bash carga lo de login.
        if argumentos.iter().any(|a| a == "--login" || a == "-l") {
            entorno.push(("KYU_LOGIN".into(), "1".into()));
        }
        *argumentos = vec![
            "--rcfile".into(),
            script
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/"),
            "-i".into(),
        ];
    } else if cfg!(windows) && programa == "wsl.exe" && argumentos.is_empty() {
        let Some(script) = preparar_prompt_bash() else {
            return;
        };
        let Some(ruta) = ruta_wsl(&script) else {
            return;
        };
        // wsl.exe abre una shell de login: se hace lo mismo a mano en kyu.bash.
        entorno.push(("KYU_LOGIN".into(), "1".into()));
        // Las variables de Kyu pasan a Linux; /p traduce la ruta de Windows.
        entorno.push(("WSLENV".into(), wslenv()));
        *argumentos = vec![
            "-e".into(),
            "bash".into(),
            "--rcfile".into(),
            ruta,
            "-i".into(),
        ];
    }
}

/// C:\Users\x\… → /mnt/c/Users/x/… (el montaje por defecto de WSL).
fn ruta_wsl(ruta: &std::path::Path) -> Option<String> {
    let texto = ruta
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");
    let (unidad, resto) = texto.split_once(":/")?;
    (unidad.len() == 1).then(|| format!("/mnt/{}/{resto}", unidad.to_lowercase()))
}

fn wslenv() -> String {
    let propias = "KYU_TERMINAL:KYU_LOGIN:KYU_ESTADO/p";
    match std::env::var("WSLENV") {
        Ok(v) if !v.is_empty() => format!("{v}:{propias}"),
        _ => propias.into(),
    }
}

/// Deja el script del prompt de bash en `<config>/kyu/shell/kyu.bash` (sin BOM, en LF).
fn preparar_prompt_bash() -> Option<std::path::PathBuf> {
    const SCRIPT: &str = include_str!("../../shell/kyu.bash");
    let carpeta = carpeta_kyu()?.join("shell");
    std::fs::create_dir_all(&carpeta).ok()?;
    let ruta = carpeta.join("kyu.bash");
    let bytes = SCRIPT.replace("\r\n", "\n").into_bytes();
    if std::fs::read(&ruta).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::write(&ruta, bytes).ok()?;
    }
    Some(ruta)
}

/// Perfiles que hay en este equipo.
/// Prefijo del nombre de los perfiles que salen de ~/.ssh/config.
pub const PREFIJO_SSH: &str = "SSH · ";

/// Un perfil por cada `Host` de ~/.ssh/config que sea un nombre concreto (sin `*`, `?` ni
/// `!`): lanza `ssh <alias>` y ssh hace el resto con lo que diga ese archivo.
fn perfiles_ssh() -> Vec<Perfil> {
    let Some(texto) =
        dirs::home_dir().and_then(|h| std::fs::read_to_string(h.join(".ssh").join("config")).ok())
    else {
        return Vec::new();
    };
    #[cfg(windows)]
    let ssh = which("ssh.exe").unwrap_or_else(|| "ssh.exe".into());
    #[cfg(not(windows))]
    let ssh = "ssh".to_string();
    alias_ssh(&texto)
        .into_iter()
        .map(|alias| Perfil {
            nombre: format!("{PREFIJO_SSH}{alias}"),
            shell: ssh.clone(),
            argumentos: vec![alias],
            color: Some("#67e8f9".into()),
            icono: Some("servidor".into()),
        })
        .collect()
}

/// Los alias de las líneas `Host` (puede haber varios por línea), sin repetir y en orden.
fn alias_ssh(texto: &str) -> Vec<String> {
    let mut lista: Vec<String> = Vec::new();
    for linea in texto.lines() {
        let linea = linea.trim();
        let mut partes = linea.split_whitespace();
        let Some(clave) = partes.next() else { continue };
        // «Host=x» también vale.
        let (clave, resto): (&str, Vec<&str>) = match clave.split_once('=') {
            Some((c, v)) => (c, std::iter::once(v).chain(partes).collect()),
            None => (clave, partes.collect()),
        };
        if !clave.eq_ignore_ascii_case("host") {
            continue;
        }
        for alias in resto {
            let alias = alias.trim_matches('"');
            if alias.is_empty()
                || alias.contains(['*', '?', '!'])
                || lista.iter().any(|a| a == alias)
            {
                continue;
            }
            lista.push(alias.to_string());
        }
    }
    lista
}

fn detectar_perfiles() -> Vec<Perfil> {
    let perfil =
        |nombre: &str, shell: String, argumentos: &[&str], color: &str, icono: &str| Perfil {
            nombre: nombre.into(),
            shell,
            argumentos: argumentos.iter().map(|a| a.to_string()).collect(),
            color: Some(color.into()),
            icono: Some(icono.into()),
        };
    let mut lista = Vec::new();
    #[cfg(windows)]
    {
        let pwsh = which("pwsh.exe").unwrap_or_else(|| "powershell.exe".into());
        lista.push(perfil(
            "PowerShell",
            pwsh,
            &["-NoLogo"],
            "#a78bfa",
            "powershell",
        ));
        let git_bash = std::path::Path::new(r"C:\Program Files\Git\bin\bash.exe");
        if git_bash.is_file() {
            lista.push(perfil(
                "Git Bash",
                git_bash.display().to_string(),
                &["--login", "-i"],
                "#4ade80",
                "bash",
            ));
        }
        if let Some(wsl) = which("wsl.exe") {
            lista.push(perfil("WSL", wsl, &[], "#fbbf24", "linux"));
        }
        lista.push(perfil(
            "Símbolo del sistema",
            "cmd.exe".into(),
            &[],
            "#8b8b96",
            "cmd",
        ));
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let nombre = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Shell".into());
        lista.push(perfil(&nombre, shell, &[], "#a78bfa", "bash"));
    }
    lista
}

/// Deja el script del prompt en `<config>/kyu/shell/kyu.ps1` y devuelve su ruta.
/// Con BOM para que Windows PowerShell 5.1 lea bien los caracteres.
#[cfg(windows)]
fn preparar_prompt_pwsh() -> Option<std::path::PathBuf> {
    const SCRIPT: &str = include_str!("../../shell/kyu.ps1");
    let carpeta = carpeta_kyu()?.join("shell");
    std::fs::create_dir_all(&carpeta).ok()?;
    let ruta = carpeta.join("kyu.ps1");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(SCRIPT.as_bytes());
    // Si ya está igual no se reescribe: varias pestañas lo leen a la vez al abrirse.
    if std::fs::read(&ruta).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::write(&ruta, bytes).ok()?;
    }
    Some(ruta)
}

#[cfg(windows)]
fn which(programa: &str) -> Option<String> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|d| d.join(programa))
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
    })
}

/// Archivo que marca la versión portable: si está junto al ejecutable, todo lo de Kyu
/// (kyu.toml, scripts del prompt y datos de WebView2) va a `datos\` en esa carpeta.
const MARCA_PORTABLE: &str = "kyu.portable";

/// Carpeta `datos` de la versión portable, o None si es la instalada.
pub fn carpeta_portable() -> Option<&'static std::path::Path> {
    static CARPETA: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
    CARPETA
        .get_or_init(|| {
            let exe = std::env::current_exe().ok()?;
            let junto = exe.parent()?;
            junto
                .join(MARCA_PORTABLE)
                .is_file()
                .then(|| junto.join("datos"))
        })
        .as_deref()
}

/// Carpeta de Kyu: `datos\` en la portable, `<config>/kyu` en la instalada.
pub fn carpeta_kyu() -> Option<std::path::PathBuf> {
    match carpeta_portable() {
        Some(c) => Some(c.to_path_buf()),
        None => dirs::config_dir().map(|d| d.join("kyu")),
    }
}

#[cfg(test)]
mod pruebas_ssh {
    use super::alias_ssh;

    #[test]
    fn lee_los_host_concretos() {
        let t = "# comentario\nHost casa vps\n  HostName 192.0.2.1\nHost *\n  User x\nhost=web\nHost !malo *.lan otro \"con\"\nMatch host foo\nHost casa\n";
        assert_eq!(alias_ssh(t), vec!["casa", "vps", "web", "otro", "con"]);
    }
}
