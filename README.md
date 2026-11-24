# Kyu Terminal

Terminal para Windows y Linux con Claude Code integrado. Núcleo en Rust con Tauri 2; la interfaz es React y el terminal lo dibuja xterm.js.

Estado: en desarrollo. La versión anterior, con egui (shell y panel de Claude), está en la etiqueta `v0-egui`.

## Qué hace ahora

- **Espacios de trabajo** (las pestañas de arriba, uno por proyecto). Dentro, los paneles que quieras, divididos a la derecha o abajo y redimensionables; cada panel tiene sus propias pestañas de terminales y archivos. Las pestañas se arrastran a otro panel o al borde de uno para dividirlo.
- **Perfiles**: PowerShell, Git Bash, WSL y Símbolo del sistema se detectan solos; se pueden definir otros en `kyu.toml`.
- **Bloques**: cada orden lleva encima un título con la carpeta, la rama de git, la RAM del equipo y, a la derecha, el resultado, lo que tardó y la hora; en el lateral, una franja verde, roja o morada. De momento con PowerShell (el prompt de Kyu).
- **Archivos dentro de Kyu**: Ctrl+Clic en una ruta de la salida (`src/main.rs:12:5`) abre el archivo en un editor propio, en esa línea, con colores de código; Ctrl+S guarda. Mayús+Clic lo abre en VS Code.
- **Buscar** en el terminal (Ctrl+F) y **paleta de órdenes** (Ctrl+Mayús+P).
- Ctrl+C copia si hay selección (si no, interrumpe), Ctrl+V pega; clic derecho copia o pega. Sugerencias del historial en gris con PSReadLine 2.1 o superior.

## Atajos

| Atajo | Qué hace |
|---|---|
| Ctrl+Mayús+P | Paleta de órdenes |
| Ctrl+Mayús+D / Ctrl+Mayús+E | Dividir el panel a la derecha / abajo |
| Ctrl+Mayús+T | Nueva pestaña en el panel |
| Ctrl+Mayús+N | Nuevo espacio |
| Ctrl+Mayús+W | Cerrar la pestaña (avisa si hay cambios sin guardar) |
| Ctrl+Tab / Ctrl+Mayús+Tab | Pestaña siguiente / anterior del panel |
| Ctrl+1 … Ctrl+9 | Ir al espacio n.º |
| Alt+flechas | Pasar al panel de al lado |
| Ctrl+F | Buscar en el terminal |
| Ctrl+Clic / Mayús+Clic en una ruta | Abrir en Kyu / en VS Code |

## Compilar

Hace falta Rust estable, Node 22 y pnpm. En Windows, además, las Build Tools de Visual Studio con C++ (WebView2 ya viene con Windows 11):

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup
```

En Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev libssl-dev build-essential
```

Luego:

```bash
pnpm install
pnpm tauri dev      # en desarrollo, con recarga
pnpm tauri build    # instaladores en src-tauri/target/release/bundle
```

El ejecutable se llama `kyu`.

## Estructura

```
src/lib/          estado (espacios, paneles, pestañas), registros de terminales y
                  editores, bloques, enlaces a archivos, órdenes al núcleo
src/componentes/  barra de título, espacio, panel, terminal, editor, paleta
src-tauri/        núcleo en Rust: PTY, perfiles y configuración, archivos, RAM
shell/            prompt de PowerShell que Kyu carga en cada shell
```

## Configuración

`kyu.toml` en `%APPDATA%\kyu\` (Windows) o `~/.config/kyu/` (Linux). Todo es opcional:

```toml
fuente = "JetBrainsMono Nerd Font Mono" # nombre de la familia, no la ruta al archivo
sin_prompt = false                      # true = dejar el prompt de tu perfil (oh-my-posh, starship...)

# Si pones perfiles, sustituyen a los detectados. El primero es el predeterminado.
[[perfiles]]
nombre = "PowerShell"
shell = "powershell.exe"
argumentos = ["-NoLogo"]
color = "#a78bfa"
icono = "powershell"     # powershell, bash, linux, cmd, servidor

[[perfiles]]
nombre = "Ubuntu"
shell = "wsl.exe"
argumentos = ["-d", "Ubuntu"]
color = "#fbbf24"
icono = "linux"

[tema]
fuente_tamano = 14
fondo = "#0b0b0d"
texto = "#ececf1"
cursor = "#4ade80"
seleccion = "#3b3552"
ansi = ["#1f1f24", "#f87171", "#4ade80", "#fbbf24", "#60a5fa", "#a78bfa", "#67e8f9", "#ececf1",
        "#55555e", "#fca5a5", "#86efac", "#fde68a", "#93c5fd", "#c4b5fd", "#a5f3fc", "#ffffff"]
```

## Licencia

MIT
