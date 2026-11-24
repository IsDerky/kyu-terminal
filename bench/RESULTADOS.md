# Benchmark: Kyu frente a Windows Terminal

Medido el 24-11-2026 con `bench/medir.ps1` (arranque y memoria, 5 vueltas, medianas) y a mano
la salida (3 vueltas).

- Equipo: AMD Ryzen 9 5900X, 32 GB, Windows 11 (10.0.26300), WebView2 158.0.4370.33.
- Kyu 0.2.0 en release (`pnpm tauri build --no-bundle`), con el ConPTY de `src-tauri/conpty/`.
- Windows Terminal 1.25.3131.0, arrancado en frío (cerrado antes de cada vuelta).
- Una pestaña de Windows PowerShell 5.1 con el perfil del usuario en los dos.

| | Kyu | Windows Terminal |
|---|---|---|
| Arranque hasta la shell lista | 2569 ms | 2144 ms |
| Memoria (conjunto de trabajo, todos los procesos) | 516 MB | 213 MB |
| Memoria privada | 342 MB | 152 MB |
| Procesos | 9 | 3 |
| Volcar 10,7 MB con `cmd /c type` | 433 · 463 · 499 ms | 428 · 428 · 530 ms |

## Qué dicen

- **Arranque**: unos 0,4 s más que Windows Terminal. La mayor parte de los ~2 s en los dos es
  PowerShell cargando el perfil; lo de Kyu de más es levantar WebView2.
- **Memoria**: el doble y pico. El propio `kyu.exe` ocupa 31 MB; casi todo es WebView2 (seis
  procesos, ~370 MB de conjunto de trabajo; el de GPU, por el WebGL de xterm.js, 133 MB
  privados). PowerShell ocupa unos 100 MB en los dos.
- **Salida**: igual. Ojo: mide lo que tarda el programa en soltar la salida; en los dos el
  terminal la lee sin frenarlo y la pinta a su ritmo.

Reparto de Kyu (una pestaña, quieta):

| Proceso | Conjunto de trabajo | Privada |
|---|---|---|
| kyu.exe | 31 MB | 8 MB |
| WebView2 (principal) | 120 MB | 35 MB |
| WebView2 GPU | 77 MB | 133 MB |
| WebView2 renderer | 102 MB | 52 MB |
| WebView2 utility ×2 + crashpad | 69 MB | 23 MB |
| OpenConsole.exe | 13 MB | 3 MB |
| powershell.exe | 101 MB | 76 MB |

## Repetir

```powershell
pnpm tauri build --no-bundle
.\bench\medir.ps1 -Veces 5
```

La salida se midió escribiendo en cada terminal:

```powershell
1..3 | % { $t=(Measure-Command { cmd /c type "$env:TEMP\kyu-bench\grande.txt" }).TotalMilliseconds; Add-Content "$env:TEMP\kyu-bench\salida.txt" ([int]$t) }
```
