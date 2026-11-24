# Memoria de Kyu (release) con una pestaña: nada más arrancar y tras un rato sin foco.
#
#   .\bench\memoria.ps1 [-Veces 3] [-Opciones "--opcion-de-webview2 ..."] [-SinFoco 45]
#
# -Opciones se pasa a WebView2 (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) para probar opciones sin
# recompilar. -SinFoco: segundos que se deja Kyu en segundo plano antes de la segunda
# medida (Kyu pide a WebView2 el nivel de memoria bajo a los 30 s sin foco). 0 = no.
param([int]$Veces = 3, [string]$Opciones = "", [int]$SinFoco = 45)

$ErrorActionPreference = "Stop"
$kyu = Join-Path (Split-Path $PSScriptRoot -Parent) "src-tauri\target\release\kyu.exe"
$estado = Join-Path $env:TEMP "kyu"

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Ventanas { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }
"@

function Medir([int]$raizPid) {
  $todos = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($raizPid)
  do {
    $n = $ids.Count
    foreach ($p in $todos) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } }
  } while ($ids.Count -ne $n)
  $procs = Get-Process -Id ([int[]]$ids) -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Procesos = $procs.Count
    TrabajoMB = [math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum) / 1MB)
    PrivadaMB = [math]::Round((($procs | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB)
  }
}

function Cerrar { Get-Process kyu -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $kyu } | Stop-Process -Force; Start-Sleep -Milliseconds 1500 }

$res = @()
Cerrar
for ($v = 1; $v -le $Veces; $v++) {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $Opciones
  $p = Start-Process $kyu -PassThru
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
  $r = [Diagnostics.Stopwatch]::StartNew()
  while (-not (Get-ChildItem $estado -Filter "$($p.Id)-*.cwd" -ErrorAction SilentlyContinue)) {
    if ($r.ElapsedMilliseconds -gt 30000) { throw "Kyu no ha arrancado" }
    Start-Sleep -Milliseconds 20
  }
  Start-Sleep 5
  $a = Medir $p.Id
  $fila = [ordered]@{ Vez = $v; Procesos = $a.Procesos; TrabajoMB = $a.TrabajoMB; PrivadaMB = $a.PrivadaMB }
  if ($SinFoco -gt 0) {
    [uint32]$fpid = 0
    [void][Ventanas]::GetWindowThreadProcessId([Ventanas]::GetForegroundWindow(), [ref]$fpid)
    $fila.ConFoco = ($fpid -eq $p.Id)
    Start-Sleep $SinFoco
    $b = Medir $p.Id
    $fila.TrabajoSinFocoMB = $b.TrabajoMB
    $fila.PrivadaSinFocoMB = $b.PrivadaMB
  }
  $res += [pscustomobject]$fila
  Cerrar
}
$res | Format-Table -AutoSize
function Mediana($xs) { $o = @($xs | Sort-Object); $o[[int][math]::Floor($o.Count / 2)] }
$texto = "Medianas: {0} MB (privada {1} MB), {2} procesos" -f (Mediana $res.TrabajoMB), (Mediana $res.PrivadaMB), (Mediana $res.Procesos)
if ($SinFoco -gt 0) { $texto += "; sin foco {0} MB (privada {1} MB)" -f (Mediana $res.TrabajoSinFocoMB), (Mediana $res.PrivadaSinFocoMB) }
if ($Opciones) { $texto += "  [args: $Opciones]" }
$texto
