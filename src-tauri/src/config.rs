//! Configuración de `kyu.toml` y colores del tema.
//!
//! El archivo vive en `<config>/kyu/kyu.toml` (en Windows `%APPDATA%\kyu\kyu.toml`).
//! Si no existe se usan los valores de aquí: aspecto «Sobrio».

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Config {
    /// Programa de la shell; vacío = la de siempre del sistema.
    pub shell: Option<String>,
    pub argumentos: Vec<String>,
    /// Familia de la fuente (p. ej. "JetBrainsMono Nerd Font Mono"); vacío = la primera
    /// Nerd Font conocida que haya instalada.
    pub fuente: Option<String>,
    /// `true` = no cargar el prompt de Kyu y dejar el de tu perfil (oh-my-posh…).
    pub sin_prompt: bool,
    pub tema: Tema,
}

/// Se prueban por orden si `kyu.toml` no dice ninguna; el navegador usa la primera instalada.
const FUENTES_CONOCIDAS: &[&str] = &[
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

/// Lo que necesita la ventana para pintar el terminal.
#[derive(Serialize)]
pub struct ConfigVista {
    fuente: String,
    tema: Tema,
    shell: String,
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
    ConfigVista {
        fuente,
        shell: config.shell_elegida().0,
        tema: config.tema,
    }
}

impl Config {
    pub fn cargar() -> Self {
        let Some(ruta) = dirs::config_dir().map(|d| d.join("kyu").join("kyu.toml")) else {
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

    /// Shell a arrancar: la de `kyu.toml` o la del sistema.
    pub fn shell_elegida(&self) -> (String, Vec<String>) {
        if let Some(shell) = &self.shell {
            return (shell.clone(), self.argumentos.clone());
        }
        #[cfg(windows)]
        {
            let pwsh = which("pwsh.exe").unwrap_or_else(|| "powershell.exe".into());
            let mut args = vec!["-NoLogo".to_string()];
            if !self.sin_prompt
                && let Some(script) = preparar_prompt_pwsh()
            {
                args.extend([
                    "-NoExit".into(),
                    "-Command".into(),
                    format!(". '{}'", script.display()),
                ]);
            }
            (pwsh, args)
        }
        #[cfg(not(windows))]
        {
            // El prompt de bash todavía no existe; `sin_prompt` solo cuenta en Windows.
            let _ = self.sin_prompt;
            (
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()),
                vec![],
            )
        }
    }
}

/// Deja el script del prompt en `<config>/kyu/shell/kyu.ps1` y devuelve su ruta.
/// Con BOM para que Windows PowerShell 5.1 lea bien los caracteres de los marcos.
#[cfg(windows)]
fn preparar_prompt_pwsh() -> Option<std::path::PathBuf> {
    const SCRIPT: &str = include_str!("../../shell/kyu.ps1");
    let carpeta = dirs::config_dir()?.join("kyu").join("shell");
    std::fs::create_dir_all(&carpeta).ok()?;
    let ruta = carpeta.join("kyu.ps1");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(SCRIPT.as_bytes());
    std::fs::write(&ruta, bytes).ok()?;
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
