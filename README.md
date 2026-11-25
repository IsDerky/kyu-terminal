# Kyu Terminal

Terminal para Windows y Linux con Claude Code integrado. Núcleo en Rust con Tauri 2; la interfaz es React y el terminal lo dibuja xterm.js.

Estado: en desarrollo (0.2). La primera versión, con egui, está en la etiqueta `v0-egui`.

## Terminal

- **Espacios de trabajo** (las pestañas de arriba, uno por proyecto). Dentro, paneles divididos a la derecha o abajo, cada uno con sus pestañas de terminales y archivos; se arrastran de un panel a otro. Al abrir Kyu vuelve todo como estaba (se puede apagar).
- **Perfiles**: PowerShell, Git Bash, WSL y Símbolo del sistema se detectan solos, y cada `Host` de `~/.ssh/config` sale como perfil SSH. Se pueden definir otros en `kyu.toml`.
- **Bloques**: cada orden lleva encima un título con la carpeta, la rama de git y la RAM, y a la derecha el resultado, lo que tardó y la hora. Funciona con PowerShell y bash (Git Bash, WSL, Linux).
- **Autocompletado** en gris mientras escribes: historial de la carpeta, scripts de `package.json`, ramas de git, carpetas y archivos.
- **Archivos**: Ctrl+Clic en una ruta de la salida (`src/main.rs:12:5`) la abre en el editor de Kyu en esa línea; Mayús+Clic, en VS Code. Pestaña con el árbol de la carpeta y el estado de git (Ctrl+Mayús+B).
- Botón para abrir en el navegador los `localhost:puerto` que salen mientras corre una orden.
- Imágenes sixel (Kyu lleva su propio ConPTY, el de Windows se las come).
- Aviso de Windows cuando acaba una orden larga y no estás mirando, grabación del panel a GIF y pantalla de ajustes (Ctrl+,) que escribe en `kyu.toml` sin perder sus comentarios.

## Claude Code

Cada conversación es una pestaña más, al lado de terminales y archivos: Ctrl+Mayús+C va a la última (o abre una a la derecha), Ctrl+Mayús+K abre otra y el botón «Claude» de la barra enseña todas, con cuál trabaja y cuál espera un permiso. Arranca Claude Code en la carpeta del terminal con el foco.

- Modelo, esfuerzo y modo de permisos (Mayús+Tab), comandos con `/`, `@archivo` (también arrastrando desde Archivos o una pestaña), imágenes pegadas o soltadas y desglose del contexto.
- Alt+K manda lo seleccionado en el terminal o en el editor (con su archivo y líneas) para preguntar sobre ello.
- Permisos con el diff del cambio; los planes se aprueban desde el panel.
- Varias conversaciones a la vez, mensajes en cola mientras trabaja, reanudar las anteriores y volver a un mensaje (conversación, archivos o las dos cosas).
- Los archivos que cambia Claude se abren con lo cambiado marcado, y se puede deshacer.
- Respuesta sugerida en gris tras cada turno (Tab la usa).
- Varias cuentas: cada una con su sesión y el mismo historial; se cambia desde el pie del panel y la conversación sigue con la otra. El pie enseña cuánto lleva gastado la cuenta de su sesión de 5 h y de la semana, y al 90 % propone seguir con otra.
- Claude puede leer tus terminales y ejecutar órdenes en uno a la vista, siempre con permiso.
- Uso por día y por proyecto, y límite diario con aviso.

## Atajos

| Atajo | Qué hace |
|---|---|
| Ctrl+Mayús+P | Paleta de órdenes |
| Ctrl+, | Ajustes |
| Ctrl+Mayús+C | Ir a la última conversación con Claude / volver |
| Ctrl+Mayús+K | Nueva conversación con Claude en el panel |
| Ctrl+Mayús+X | Maximizar el panel con el foco / volver |
| Mayús+Tab (en el panel) | Siguiente modo de permisos |
| Alt+K | Lo seleccionado (terminal o archivo) a la caja de Claude |
| Ctrl+Mayús+D / Ctrl+Mayús+E | Dividir el panel a la derecha / abajo |
| Ctrl+Mayús+T | Nueva pestaña en el panel |
| Ctrl+Mayús+N | Nuevo espacio |
| Ctrl+Mayús+W | Cerrar la pestaña (avisa si hay cambios sin guardar) |
| Ctrl+Tab / Ctrl+Mayús+Tab | Pestaña siguiente / anterior del panel |
| Ctrl+1 … Ctrl+9 | Ir al espacio n.º |
| Alt+flechas | Pasar al panel de al lado |
| Ctrl+Mayús+B | Árbol de archivos |
| Ctrl+Mayús+G | Grabar el panel a GIF (empezar / parar) |
| Ctrl+F | Buscar en el terminal |
| → · Ctrl+→ | Aceptar la sugerencia · palabra a palabra |
| Ctrl+Clic / Mayús+Clic en una ruta | Abrir en Kyu / en VS Code |

## Instalar

En las [releases](https://github.com/IsDerky/kyu-terminal/releases):

- **Windows**: el instalador `.exe` (para tu usuario, sin permisos de administrador) o el `.msi`. También hay un zip portable. Los instaladores no van firmados, así que SmartScreen avisa la primera vez («Más información» → «Ejecutar de todas formas»).
- **Linux**: la `.AppImage` (`chmod +x` y a ejecutar) o el `.deb`.

Lo instalado mira al abrir si hay versión nueva y avisa en la barra de arriba (se puede apagar en Ajustes). La portable y el `.deb` se actualizan a mano.

Para publicar una versión: subir la versión en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`, y empujar la etiqueta `vX.Y.Z`; el flujo `release` hace el resto.

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

Versión portable (Windows), después de `pnpm tauri build`: `powershell -File scripts/portable.ps1`. Con el archivo `kyu.portable` junto a `kyu.exe`, la configuración y los datos van a `datos\` en esa carpeta.

## Estructura

```
src/lib/          estado (espacios, paneles, pestañas), terminales, bloques, editores,
                  panel de Claude, sesión, órdenes al núcleo
src/componentes/  barra de título, espacio, panel, terminal, editor, árbol, Claude, ajustes
src-tauri/src/    núcleo: PTY, configuración, Claude Code (stream-json), cuentas,
                  servidor MCP de Kyu, archivos, git, GIF, uso
src-tauri/conpty/ ConPTY oficial de Microsoft (ver LEEME.md)
shell/            prompts de PowerShell y bash que Kyu carga en cada shell
bench/            medidas de arranque, memoria y salida frente a Windows Terminal
```

## Configuración

`kyu.toml` en `%APPDATA%\kyu\` (Windows) o `~/.config/kyu/` (Linux). Casi todo se cambia desde Ajustes; todo es opcional:

```toml
fuente = "JetBrainsMono Nerd Font Mono" # nombre de la familia, no la ruta al archivo
sin_prompt = false                      # true = dejar el prompt de tu perfil (oh-my-posh, starship...)
perfil_predeterminado = "PowerShell"
restaurar_sesion = true
perfiles_ssh = true                     # un perfil por cada Host de ~/.ssh/config
aviso_segundos = 10                     # 0 = sin avisos
limite_diario = 0                       # miles de tokens de salida de Claude al día; 0 = sin límite
sugerencias_claude = true

# Si pones perfiles, sustituyen a los detectados.
[[perfiles]]
nombre = "Ubuntu"
shell = "wsl.exe"
argumentos = ["-d", "Ubuntu"]
color = "#fbbf24"
icono = "linux"          # powershell, bash, linux, cmd, servidor

# Cuentas de Claude Code. La que no tiene carpeta es la de siempre (~/.claude).
[[cuentas_claude]]
nombre = "Personal"

[[cuentas_claude]]
nombre = "Trabajo"
carpeta = "~/.claude-trabajo"
compartir = true         # historial, memoria, agentes, skills y ajustes de la principal

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
