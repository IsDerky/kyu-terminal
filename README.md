# Kyu Terminal

Terminal para Windows y Linux con Claude Code integrado. Núcleo en Rust con Tauri 2; la interfaz es React y el terminal lo dibuja xterm.js.

Estado: en desarrollo. Pasando de egui a Tauri; la versión con egui (shell y panel de Claude) está en la etiqueta `v0-egui`.

## Qué hace ahora (fase 0)

- Ventana propia sin marco, con barra de título, pestaña y botones de ventana.
- Terminal con xterm.js y WebGL; la shell corre en un PTY de verdad (`portable-pty`: ConPTY en Windows).
- PowerShell por defecto en Windows y `$SHELL` en Linux.
- Ctrl+C copia si hay selección (si no, interrumpe), Ctrl+V pega; clic derecho copia o pega.
- Enlaces clicables; usa la primera Nerd Font que haya instalada.
- Prompt propio para PowerShell: cada comando va dentro de un marco con carpeta, rama de git, hora y, al acabar, el resultado y lo que tardó.

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
src/          interfaz (React + Tailwind): barra de título y terminal
src-tauri/    núcleo en Rust: PTY, configuración
shell/        prompt de PowerShell que Kyu carga en cada shell
```

## Configuración

`kyu.toml` en `%APPDATA%\kyu\` (Windows) o `~/.config/kyu/` (Linux). Todo es opcional:

```toml
shell = "pwsh.exe"                      # por defecto PowerShell / $SHELL
argumentos = ["-NoLogo"]
fuente = "JetBrainsMono Nerd Font Mono" # nombre de la familia, no la ruta al archivo
sin_prompt = false                      # true = dejar el prompt de tu perfil (oh-my-posh, starship...)

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
