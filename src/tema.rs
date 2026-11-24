//! Configuración de `kyu.toml` y colores del tema.
//!
//! El archivo vive en `<config>/kyu/kyu.toml` (en Windows `%APPDATA%\kyu\kyu.toml`).
//! Si no existe se usan los valores de aquí: tema neón morado y verde.

use egui::Color32;
use serde::Deserialize;

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Config {
    /// Programa de la shell; vacío = la de siempre del sistema.
    pub shell: Option<String>,
    pub argumentos: Vec<String>,
    /// Ruta a un .ttf/.otf; vacío = la primera Nerd Font conocida que haya instalada.
    pub fuente: Option<String>,
    /// `true` = no cargar el prompt de Kyu y dejar el de tu perfil (oh-my-posh…).
    pub sin_prompt: bool,
    pub tema: Tema,
}

/// Fuentes que se prueban por orden si `kyu.toml` no dice ninguna.
const FUENTES_CONOCIDAS: &[&str] = &[
    "FiraCodeNerdFontMono-Regular.ttf",
    "JetBrainsMonoNerdFontMono-Regular.ttf",
    "CaskaydiaCoveNerdFontMono-Regular.ttf",
    "CascadiaMono.ttf",
];

impl Config {
    /// Bytes de la fuente monoespaciada a usar, si se encuentra alguna.
    pub fn fuente_bytes(&self) -> Option<Vec<u8>> {
        if let Some(ruta) = &self.fuente {
            return std::fs::read(ruta).ok();
        }
        let mut carpetas = Vec::new();
        #[cfg(windows)]
        {
            if let Some(local) = dirs::data_local_dir() {
                carpetas.push(local.join("Microsoft").join("Windows").join("Fonts"));
            }
            if let Some(win) = std::env::var_os("WINDIR") {
                carpetas.push(std::path::PathBuf::from(win).join("Fonts"));
            }
        }
        #[cfg(not(windows))]
        {
            if let Some(datos) = dirs::data_dir() {
                carpetas.push(datos.join("fonts"));
            }
            carpetas.push("/usr/share/fonts/truetype".into());
        }
        FUENTES_CONOCIDAS.iter().find_map(|nombre| {
            carpetas
                .iter()
                .find_map(|c| std::fs::read(c.join(nombre)).ok())
        })
    }
}

#[derive(Deserialize)]
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
            fondo: c("#0e0c16"),
            texto: c("#d9d4ea"),
            cursor: c("#5cff2e"),
            seleccion: c("#3a2f5c"),
            ansi: [
                c("#1a1626"),
                c("#ff4d6d"),
                c("#5cff2e"),
                c("#ffb547"),
                c("#58a6ff"),
                c("#9a3cff"),
                c("#4dd8e6"),
                c("#d9d4ea"),
                c("#4a4360"),
                c("#ff7a92"),
                c("#8dff6b"),
                c("#ffd08a"),
                c("#8cc4ff"),
                c("#c48bff"),
                c("#8aeef7"),
                c("#ffffff"),
            ],
        }
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
    const SCRIPT: &str = include_str!("../shell/kyu.ps1");
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

impl Tema {
    pub fn fondo(&self) -> Color32 {
        hex(&self.fondo)
    }
    pub fn texto(&self) -> Color32 {
        hex(&self.texto)
    }
    pub fn cursor(&self) -> Color32 {
        hex(&self.cursor)
    }
    pub fn seleccion(&self) -> Color32 {
        hex(&self.seleccion)
    }
    pub fn ansi(&self, i: usize) -> Color32 {
        hex(&self.ansi[i])
    }
}

/// `#rrggbb` → color; si está mal escrito, magenta para que se note.
pub fn hex(s: &str) -> Color32 {
    let s = s.trim_start_matches('#');
    let canal = |i: usize| u8::from_str_radix(s.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
    if s.len() != 6 {
        return Color32::from_rgb(255, 0, 255);
    }
    Color32::from_rgb(canal(0), canal(2), canal(4))
}
