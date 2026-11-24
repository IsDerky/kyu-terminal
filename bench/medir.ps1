# Benchmark de Kyu frente a Windows Terminal (Windows PowerShell 5.1).
#
#   .\bench\medir.ps1 [-Veces 5]
#
# Mide, con una pestaña de Windows PowerShell en cada uno:
#   1. Arranque: desde lanzar el programa hasta que la shell está lista (Kyu: el prompt
#      escribe su archivo de estado; Windows Terminal: la shell ejecuta una orden al arrancar).
#   2. Memoria: suma de todos los procesos (programa, WebView2 u OpenConsole, la shell) con
#      la pestaña quieta 5 s después de arrancar.
#   3. Salida: lo que tarda `cmd /c type` de un archivo de 10 MB (la shell espera a que el
#      terminal lo pinte, así que mide la velocidad del terminal).
# Hace falta Kyu compilado en release (pnpm tauri build --no-bundle) y Windows Terminal
# cerrado (para medir arranques en frío).
param([int]$Veces = 5)

$ErrorActionPreference = "Stop"
$raiz = Split-Path $PSScriptRoot -Parent
$kyu = Join-Path $raiz "src-tauri\target\release\kyu.exe"
if (-not (Test-Path $kyu)) { throw "No está ${kyu}: compila con pnpm tauri build --no-bundle" }
if (Get-Process WindowsTerminal -ErrorAction SilentlyContinue) { throw "Cierra Windows Terminal antes de medir" }
$tmp = Join-Path $env:TEMP "kyu-bench"
New-Item -ItemType Directory -Force $tmp | Out-Null
$estado = Join-Path $env:TEMP "kyu"

function Medir-Arbol([int]$raizPid) {
  # Suma la memoria del proceso y de todos sus descendientes.
  $todos = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($raizPid)
  do {
    $antes = $ids.Count
    foreach ($p in $todos) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } }
  } while ($ids.Count -ne $antes)
  $procs = Get-Process -Id ([int[]]$ids) -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Procesos   = $procs.Count
    TrabajoMB  = [math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum) / 1MB)
    PrivadaMB  = [math]::Round((($procs | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB)
  }
}

function Esperar-Archivo([scriptblock]$hay, [int]$maxMs = 30000) {
  $reloj = [Diagnostics.Stopwatch]::StartNew()
  while (-not (& $hay)) {
    if ($reloj.ElapsedMilliseconds -gt $maxMs) { throw "No ha arrancado en $maxMs ms" }
    Start-Sleep -Milliseconds 10
  }
  $reloj.ElapsedMilliseconds
}

function Cerrar-Todo {
  # Solo el Kyu de release que lanza este script (no uno que tengas abierto).
  Get-Process kyu -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $kyu } | Stop-Process -Force
  Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 1500
}

# Archivo de 10 MB para la prueba de salida.
$grande = Join-Path $tmp "grande.txt"
if (-not (Test-Path $grande)) {
  $linea = "Kyu benchmark " + ("0123456789abcdef" * 5)
  $sb = New-Object System.Text.StringBuilder
  for ($i = 1; $i -le 110000; $i++) { [void]$sb.AppendLine("$i $linea") }
  [IO.File]::WriteAllText($grande, $sb.ToString())
}
$mb = [math]::Round((Get-Item $grande).Length / 1MB, 1)

$res = @()
Cerrar-Todo
for ($v = 1; $v -le $Veces; $v++) {
  # ---- Kyu ----
  $p = Start-Process $kyu -PassThru
  $ms = Esperar-Archivo { Get-ChildItem $estado -Filter "$($p.Id)-*.cwd" -ErrorAction SilentlyContinue }
  Start-Sleep 5
  $m = Medir-Arbol $p.Id
  $res += [pscustomobject]@{ Terminal = "Kyu"; Vez = $v; ArranqueMs = $ms; Procesos = $m.Procesos; TrabajoMB = $m.TrabajoMB; PrivadaMB = $m.PrivadaMB }
  Cerrar-Todo

  # ---- Windows Terminal ----
  $marca = Join-Path $tmp "wt-$v.listo"
  Remove-Item $marca -ErrorAction SilentlyContinue
  $t0 = [Diagnostics.Stopwatch]::StartNew()
  Start-Process wt.exe -ArgumentList "-w new powershell.exe -NoLogo -NoExit -Command `"Set-Content '$marca' x`""
  while (-not (Test-Path $marca)) {
    if ($t0.ElapsedMilliseconds -gt 30000) { throw "Windows Terminal no ha arrancado" }
    Start-Sleep -Milliseconds 10
  }
  $ms = $t0.ElapsedMilliseconds
  Start-Sleep 5
  $wt = Get-Process WindowsTerminal | Select-Object -First 1
  $m = Medir-Arbol $wt.Id
  $res += [pscustomobject]@{ Terminal = "Windows Terminal"; Vez = $v; ArranqueMs = $ms; Procesos = $m.Procesos; TrabajoMB = $m.TrabajoMB; PrivadaMB = $m.PrivadaMB }
  Cerrar-Todo
}

$res | Format-Table -AutoSize
$res | Export-Csv (Join-Path $tmp "arranque-memoria.csv") -NoTypeInformation -Encoding UTF8

function Mediana($xs) { $o = @($xs | Sort-Object); $o[[int][math]::Floor($o.Count / 2)] }
foreach ($t in "Kyu", "Windows Terminal") {
  $f = $res | Where-Object Terminal -eq $t
  "{0}: arranque {1} ms, memoria {2} MB (privada {3} MB), {4} procesos (medianas de {5})" -f $t,
    (Mediana $f.ArranqueMs), (Mediana $f.TrabajoMB), (Mediana $f.PrivadaMB), (Mediana $f.Procesos), $Veces
}
"Archivo de salida: $grande ($mb MB)"
