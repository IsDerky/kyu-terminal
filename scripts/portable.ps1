# Monta la versión portable de Kyu a partir de un build de release:
#   pnpm tauri build   (o --no-bundle)
#   powershell -File scripts/portable.ps1
# Deja Kyu-Terminal-<versión>-portable-x64.zip en src-tauri/target/release/bundle/portable.
# El archivo kyu.portable hace que Kyu guarde todo en datos\ junto al exe.
param(
    [string]$Release = "$PSScriptRoot\..\src-tauri\target\release"
)
$ErrorActionPreference = "Stop"

$conf = Get-Content "$PSScriptRoot\..\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
$nombre = "Kyu-Terminal-$version-portable-x64"

$salida = Join-Path $Release "bundle\portable"
$carpeta = Join-Path $salida $nombre
if (Test-Path $carpeta) { Remove-Item $carpeta -Recurse -Force }
New-Item -ItemType Directory -Force $carpeta | Out-Null

foreach ($f in "kyu.exe", "conpty.dll", "OpenConsole.exe") {
    $origen = Join-Path $Release $f
    if (-not (Test-Path $origen)) { throw "Falta $origen (¿se hizo el build de release?)" }
    Copy-Item $origen $carpeta
}
Copy-Item "$PSScriptRoot\..\LICENSE" $carpeta

Set-Content (Join-Path $carpeta "kyu.portable") "Con este archivo Kyu guarda su configuración y sus datos en la carpeta datos. Bórralo para usar los de la versión instalada." -Encoding UTF8

$zip = Join-Path $salida "$nombre.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $carpeta -DestinationPath $zip
Write-Output $zip
