# ConPTY propio

`conpty.dll` y `OpenConsole.exe` son el ConPTY de Windows Terminal, sacados tal cual del
paquete NuGet oficial de Microsoft:

- Paquete: [`Microsoft.Windows.Console.ConPTY`](https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY) **1.25.261109001** (licencia MIT, código en [microsoft/terminal](https://github.com/microsoft/terminal))
- `conpty.dll`: `runtimes/win-x64/native/conpty.dll`
- `OpenConsole.exe`: `build/native/runtimes/x64/OpenConsole.exe`
- Los dos llevan firma Authenticode válida de Microsoft Corporation.

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `conpty.dll` | 119608 | `e971856f89748dc3b458125e9afdd79b5e9574a7c937676116d3cbbd3b71f492` |
| `OpenConsole.exe` | 1089336 | `b17e48b07ef153b420f0a6e178bacd31fb4c3390e21ae746586213fc0719a775` |

## Por qué

portable-pty usa un `conpty.dll` que esté junto al ejecutable antes que el del sistema. El
ConPTY que trae Windows se traga las secuencias que no conoce, entre ellas las imágenes
sixel; este las deja pasar hasta xterm.js.

`build.rs` los copia junto al ejecutable al compilar y `tauri.windows.conf.json` los mete en
el instalador.

## Actualizar

1. Bajar la versión nueva de `https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/<versión>/microsoft.windows.console.conpty.<versión>.nupkg` (es un zip).
2. Comprobar la firma: `Get-AuthenticodeSignature <archivo>` → `Valid`, `CN=Microsoft Corporation`.
3. Sustituir los dos archivos (x64) y poner aquí la versión y las huellas nuevas.
