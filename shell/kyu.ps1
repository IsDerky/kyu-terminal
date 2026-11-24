# Prompt de Kyu para PowerShell. Kyu lo carga después del perfil, así que sustituye
# al prompt que haya (oh-my-posh, starship…) solo dentro de Kyu.
#
# El prompt no dibuja nada: deja una línea vacía para el título y dos espacios para la
# flecha, y marca el bloque con OSC 133 para que Kyu pinte encima:
#
#   kyu-terminal ~\Aleks  [rama tauri ±3] [RAM 59 %]           ✓ 0,2 s   10:42
#   › git log --oneline -3
#   ...salida...
#
#   A = empieza el prompt (título)   B = empieza lo que escribes
#   C = empieza a ejecutarse         D;código;kyu-dur=ms = ha terminado (y lo que tardó)
#   7701;{json} = carpeta (ruta completa, padre y hoja) y git del bloque

# Windows PowerShell 5.1 escribe en la página de códigos OEM: sin esto los acentos se rompen.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

# UltimoId = 'inicio' → el primer prompt no cierra ningún bloque (sería el de cargar este script).
$global:__kyu = @{ UltimoId = 'inicio' }

function global:__KyuOsc([string]$datos) {
    "$([char]27)]$datos$([char]7)"
}

function global:__KyuRuta {
    $ruta = $PWD.ProviderPath
    $casa = $HOME.TrimEnd('\', '/')
    if ($ruta.StartsWith($casa, [StringComparison]::OrdinalIgnoreCase)) { $ruta = '~' + $ruta.Substring($casa.Length) }
    $sep = [IO.Path]::DirectorySeparatorChar
    $partes = $ruta.Split(@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)
    $hoja = if ($partes.Count) { $partes[-1] } else { $ruta }
    $padre = ''
    if ($partes.Count -ge 2) {
        $padre = if ($partes.Count -gt 3 -or ($partes.Count -eq 3 -and $partes[0] -ne '~')) { "$($partes[0])$sep…$sep$($partes[-2])$sep" } else { ($partes[0..($partes.Count - 2)] -join $sep) + $sep }
    }
    @($padre, $hoja)
}

function global:__KyuGit {
    $rama = git branch --show-current 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    if (-not $rama) { $rama = (git rev-parse --short HEAD 2>$null) }
    $cambios = @(git status --porcelain 2>$null).Count
    @($rama, $cambios)
}

function global:prompt {
    $ok = $?
    $codigo = $global:LASTEXITCODE

    # Cierre del bloque anterior, solo si de verdad se ejecutó algo.
    $cierre = ''
    $h = Get-History -Count 1
    if ($global:__kyu.UltimoId -eq 'inicio') {
        $global:__kyu.UltimoId = if ($h) { $h.Id } else { $null }
    } elseif ($h -and $h.Id -ne $global:__kyu.UltimoId) {
        $global:__kyu.UltimoId = $h.Id
        $num = if ($ok) { 0 } elseif ($codigo) { $codigo } else { 1 }
        # Lo que tardó de verdad (sin contar este prompt, que pregunta a git).
        $ms = [int]($h.EndExecutionTime - $h.StartExecutionTime).TotalMilliseconds
        $cierre = __KyuOsc "133;D;$num;kyu-dur=$ms"
    }

    $padre, $hoja = __KyuRuta
    $datos = @{ padre = $padre; hoja = $hoja; ruta = $PWD.ProviderPath; rama = $null; cambios = 0 }
    $git = __KyuGit
    if ($git) { $datos.rama, $datos.cambios = $git }
    $json = ConvertTo-Json $datos -Compress

    $Host.UI.RawUI.WindowTitle = $hoja
    # Kyu lee aquí la carpeta actual (para arrancar Claude en ella).
    if ($env:KYU_ESTADO) { [IO.File]::WriteAllText($env:KYU_ESTADO, $PWD.ProviderPath) }
    $global:LASTEXITCODE = $codigo

    # Línea en blanco de separación, línea del título (vacía) y dos espacios para la flecha.
    "$cierre`n$(__KyuOsc '133;A')$(__KyuOsc "7701;$json")`n  $(__KyuOsc '133;B')"
}

if (Get-Module PSReadLine) {
    # Al pulsar Intro con algo escrito, Kyu empieza a contar lo que tarda la orden.
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
        $linea = $null; $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$linea, [ref]$cursor)
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        if ($linea.Trim()) { [Console]::Write((__KyuOsc '133;C')) }
    }

    # Sugerencia en gris mientras escribes, sacada del historial (→ o Fin la acepta).
    # PSReadLine la trae desde la 2.1; Windows PowerShell 5.1 viene con la 2.0, que no sabe.
    # Con el autocompletado de Kyu encendido, la sugerencia la pinta Kyu: se apaga la de
    # PSReadLine para no tener dos.
    $psrl = (Get-Module PSReadLine).Version
    if ($env:KYU_AUTOCOMPLETADO) {
        if ($psrl -ge [Version]'2.1.0') { Set-PSReadLineOption -PredictionSource None }
    } elseif ($psrl -ge [Version]'2.1.0') {
        Set-PSReadLineOption -PredictionSource History
        if ($psrl -ge [Version]'2.2.0') { Set-PSReadLineOption -PredictionViewStyle InlineView }
        Set-PSReadLineOption -Colors @{ InlinePrediction = "$([char]27)[38;2;85;85;94m" }
    }
}
