# Prompt de Kyu para PowerShell. Kyu lo carga después del perfil, así que sustituye
# al prompt que haya (oh-my-posh, starship…) solo dentro de Kyu.
#
#   ╭─ ~\Aleks\kyu-terminal  main ±2                01:52
#   │ › git status -sb
#   ...salida...
#   ╰─ ✓ 0,1 s

# Windows PowerShell 5.1 escribe en la página de códigos OEM: sin esto los marcos salen como «?».
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

# UltimoId = 'inicio' → el primer prompt no pinta pie (sería el de cargar este script).
$global:__kyu = @{ UltimoId = 'inicio'; Pie = ''; Transitorio = $false }

function global:__KyuColor([string]$hex) {
    $r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
    "$([char]27)[38;2;${r};${g};${b}m"
}

function global:__KyuDuracion([TimeSpan]$t) {
    if ($t.TotalSeconds -lt 60) { return ('{0:0.0} s' -f $t.TotalSeconds).Replace('.', ',') }
    if ($t.TotalMinutes -lt 60) { return '{0} min {1} s' -f [int][Math]::Floor($t.TotalMinutes), $t.Seconds }
    '{0} h {1} min' -f [int][Math]::Floor($t.TotalHours), $t.Minutes
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
    $e = [char]27
    $fin = "$e[0m"
    $morado = __KyuColor 'c4b5fd'; $tenue = __KyuColor '8b8b96'; $muy = __KyuColor '55555e'
    $cian = __KyuColor '67e8f9'; $ambar = __KyuColor 'fbbf24'; $verde = __KyuColor '4ade80'; $rojo = __KyuColor 'f87171'

    # Al pulsar Enter, PSReadLine solo redibuja la última línea del prompt.
    if ($global:__kyu.Transitorio) {
        return "$morado│$fin $morado›$fin "
    }

    # Pie del comando anterior (solo si de verdad se ejecutó algo).
    $global:__kyu.Pie = ''
    $h = Get-History -Count 1
    if ($global:__kyu.UltimoId -eq 'inicio') {
        $global:__kyu.UltimoId = if ($h) { $h.Id } else { $null }
    } elseif ($h -and $h.Id -ne $global:__kyu.UltimoId) {
        $global:__kyu.UltimoId = $h.Id
        $dur = __KyuDuracion ($h.EndExecutionTime - $h.StartExecutionTime)
        if ($ok) {
            $global:__kyu.Pie = "$verde╰─ ✓ $muy$dur$fin`n`n"
        } else {
            $num = if ($codigo) { " $codigo" } else { '' }
            $global:__kyu.Pie = "$rojo╰─ ✕$num $ambar$dur$fin`n`n"
        }
    }

    $padre, $hoja = __KyuRuta
    $izq = "╭─ $padre$hoja"
    $izqColor = "$morado╭─$fin $tenue$padre$fin$morado$e[1m$hoja$e[22m$fin"
    $git = __KyuGit
    if ($git) {
        $rama, $cambios = $git
        $izq += "  $([char]0xE0A0) $rama"
        $izqColor += "  $cian$([char]0xE0A0) $rama$fin"
        if ($cambios) { $izq += " ±$cambios"; $izqColor += " $ambar±$cambios$fin" }
    }
    $hora = Get-Date -Format 'HH:mm'
    $ancho = $Host.UI.RawUI.WindowSize.Width
    $hueco = [Math]::Max(2, $ancho - $izq.Length - $hora.Length - 1)
    $cabecera = $izqColor + (' ' * $hueco) + "$muy$hora$fin"

    $Host.UI.RawUI.WindowTitle = $hoja
    # Kyu lee aquí la carpeta actual (para arrancar Claude en ella).
    if ($env:KYU_ESTADO) { [IO.File]::WriteAllText($env:KYU_ESTADO, $PWD.ProviderPath) }
    $global:LASTEXITCODE = $codigo
    "$($global:__kyu.Pie)$cabecera`n$morado╰─$fin $morado›$fin "
}

# Al pulsar Enter, el «╰─ ›» del prompt pasa a «│ ›»: el bloque queda abierto hasta su pie.
if (Get-Module PSReadLine) {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
        $linea = $null; $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$linea, [ref]$cursor)
        if ($linea.Trim()) {
            $global:__kyu.Transitorio = $true
            [Microsoft.PowerShell.PSConsoleReadLine]::InvokePrompt()
            $global:__kyu.Transitorio = $false
        }
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }

    # Sugerencia en gris mientras escribes, sacada del historial (→ o Fin la acepta).
    # PSReadLine la trae desde la 2.1; Windows PowerShell 5.1 viene con la 2.0, que no sabe.
    $psrl = (Get-Module PSReadLine).Version
    if ($psrl -ge [Version]'2.1.0') {
        Set-PSReadLineOption -PredictionSource History
        if ($psrl -ge [Version]'2.2.0') { Set-PSReadLineOption -PredictionViewStyle InlineView }
        Set-PSReadLineOption -Colors @{ InlinePrediction = "$([char]27)[38;2;85;85;94m" }
    }
}
