# Kyu Terminal

Terminal para Windows y Linux escrita en Rust, con Claude Code integrado.

Estado: en desarrollo, fase 0. Ya abre una shell de verdad en una ventana propia; el panel de Claude llega en la fase 2.

## Qué hace ahora

- Ventana propia con egui + wgpu; el terminal lo interpreta `alacritty_terminal` (ConPTY en Windows).
- PowerShell por defecto en Windows y `$SHELL` en Linux.
- Selección con el ratón (arrastrar, doble y triple clic), Ctrl+C copia si hay selección, Ctrl+V y clic derecho pegan.
- AltGr funciona en teclados como el español (`\ @ # [ ] { } €`).
- Prompt propio para PowerShell: cada comando va dentro de un marco con carpeta, rama de git, hora y, al acabar, el resultado y lo que tardó.
- Usa la primera Nerd Font que encuentre instalada.

## Compilar

Hace falta Rust estable. En Windows, además, las Build Tools de Visual Studio con C++:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup
```

En Debian/Ubuntu:

```bash
sudo apt install libxkbcommon-dev libxcb-render0-dev libxcb-shape0-dev libxcb-xfixes0-dev libwayland-dev
```

Luego:

```bash
cargo run --release
```

El ejecutable se llama `kyu`.

## Configuración

`kyu.toml` en `%APPDATA%\kyu\` (Windows) o `~/.config/kyu/` (Linux). Todo es opcional:

```toml
shell = "pwsh.exe"           # por defecto PowerShell / $SHELL
argumentos = ["-NoLogo"]
fuente = "C:/ruta/a/fuente.ttf"
sin_prompt = false           # true = dejar el prompt de tu perfil (oh-my-posh, starship...)

[tema]
fuente_tamano = 14.0
fondo = "#0e0c16"
texto = "#d9d4ea"
cursor = "#5cff2e"
seleccion = "#3a2f5c"
```

## Plan

| Fase | Qué |
|---|---|
| 0 | Ventana, shell, tema, copiar y pegar, prompt |
| 1 | Pestañas, perfiles (pwsh, Git Bash, WSL, SSH), búsqueda, enlaces clicables |
| 2 | Panel de Claude Code (stream-json), permisos como botones, barra de estado, avisos |
| 3 | Bloques por comando y «enviar a Claude» |
| 4 | Claude ejecuta en un panel visible a través de un servidor MCP propio |
| 5 | Paneles divididos, aviso al terminar, grabar sesión a GIF |

## Notas

`vendor/egui-winit` es una copia de egui-winit 0.37 con un solo cambio (marcado con `Kyu:`): en Windows AltGr llega como Ctrl+Alt y egui descartaba ese texto.

## Licencia

MIT.
