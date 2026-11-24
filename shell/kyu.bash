# Prompt de Kyu para bash (Git Bash, WSL y Linux). Kyu arranca bash con
# `--rcfile` apuntando aquí: primero se carga la configuración de siempre y luego
# este prompt sustituye al que hubiera, solo dentro de Kyu.
#
# Igual que en PowerShell (shell/kyu.ps1), el prompt no dibuja nada: deja una línea
# vacía para el título y dos espacios para la flecha, y marca el bloque:
#
#   A = empieza el prompt (título)   B = empieza lo que escribes
#   C = empieza a ejecutarse         D;código;kyu-dur=ms = ha terminado (y lo que tardó)
#   7701;{json} = carpeta (ruta completa, padre y hoja) y git del bloque

# --rcfile no es una shell de login: si el perfil de Kyu lo era (Git Bash, WSL), se
# carga a mano lo mismo que cargaría bash con --login.
if [[ -n $KYU_LOGIN ]]; then
    unset KYU_LOGIN
    [[ -r /etc/profile ]] && . /etc/profile
    if [[ -r ~/.bash_profile ]]; then
        . ~/.bash_profile
    elif [[ -r ~/.bash_login ]]; then
        . ~/.bash_login
    elif [[ -r ~/.profile ]]; then
        . ~/.profile
    fi
else
    [[ -r ~/.bashrc ]] && . ~/.bashrc
fi

__kyu_esc=$'\e'
__kyu_bel=$'\a'

# Ruta para Kyu: la de Windows en Git Bash y WSL (enlaces, pestañas nuevas, Claude).
__kyu_ruta_kyu() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w "$PWD"
    elif command -v wslpath >/dev/null 2>&1; then
        wslpath -w "$PWD" 2>/dev/null || printf '%s' "$PWD"
    else
        printf '%s' "$PWD"
    fi
}

__kyu_json() {
    local s=${1//\\/\\\\}
    s=${s//\"/\\\"}
    printf '"%s"' "$s"
}

__kyu_prompt() {
    local codigo=${__kyu_codigo:-0}
    __kyu_cierre=
    # __kyu_t0 lo pone PS0, que bash solo enseña si de verdad se ejecuta una orden.
    if [[ -n $__kyu_t0 ]]; then
        local dur=
        if [[ -n $EPOCHREALTIME ]]; then
            local ahora=${EPOCHREALTIME//[!0-9]/}
            dur=";kyu-dur=$(((ahora - __kyu_t0) / 1000))"
        fi
        __kyu_cierre="${__kyu_esc}]133;D;${codigo}${dur}${__kyu_bel}"
        __kyu_t0=
    fi

    # Carpeta para el título: hoja en grande y padre abreviado (~/…/Aleks/).
    local ruta=$PWD
    [[ -n $HOME && $ruta == "$HOME"* ]] && ruta="~${ruta#"$HOME"}"
    local IFS=/
    local -a partes
    read -ra partes <<<"$ruta"
    local -a limpias=()
    local p
    for p in "${partes[@]}"; do [[ -n $p ]] && limpias+=("$p"); done
    unset IFS
    local n=${#limpias[@]} hoja padre=
    if ((n == 0)); then
        hoja=/
    else
        hoja=${limpias[n - 1]}
        if ((n > 3)); then
            padre="${limpias[0]}/…/${limpias[n - 2]}/"
        elif ((n >= 2)); then
            padre=$(
                IFS=/
                printf '%s/' "${limpias[*]:0:n-1}"
            )
        fi
        [[ $ruta == /* && ${limpias[0]} != "~" && -n $padre ]] && padre="/$padre"
    fi

    local rama= cambios=0
    if rama=$(git branch --show-current 2>/dev/null); then
        [[ -z $rama ]] && rama=$(git rev-parse --short HEAD 2>/dev/null)
        cambios=$(git status --porcelain 2>/dev/null | wc -l)
        cambios=${cambios//[!0-9]/}
    else
        rama=
    fi

    local ruta_kyu
    ruta_kyu=$(__kyu_ruta_kyu)
    local json="{\"padre\":$(__kyu_json "$padre"),\"hoja\":$(__kyu_json "$hoja"),\"ruta\":$(__kyu_json "$ruta_kyu"),\"rama\":"
    if [[ -n $rama ]]; then json+="$(__kyu_json "$rama")"; else json+="null"; fi
    json+=",\"cambios\":${cambios:-0}}"

    # Kyu lee aquí la carpeta actual (para arrancar Claude en ella).
    [[ -n $KYU_ESTADO ]] && printf '%s' "$ruta_kyu" >"$KYU_ESTADO" 2>/dev/null

    __kyu_a="${__kyu_esc}]0;${hoja}${__kyu_bel}${__kyu_esc}]133;A${__kyu_bel}${__kyu_esc}]7701;${json}${__kyu_bel}"
    __kyu_b="${__kyu_esc}]133;B${__kyu_bel}"
    return "$codigo"
}

# Las marcas van en variables: así las barras de las rutas de Windows no se toman
# por escapes del prompt. Línea en blanco, línea del título (vacía) y dos espacios.
PS1='\[${__kyu_cierre}\]\n\[${__kyu_a}\]\n  \[${__kyu_b}\]'
# PS0 sale justo antes de ejecutar: marca C y apunta la hora (en microsegundos) con
# una asignación dentro de un índice, que se evalúa en la propia shell.
if [[ -n $EPOCHREALTIME ]]; then
    PS0='${__kyu_nada[__kyu_t0=${EPOCHREALTIME//[!0-9]/}]}\e]133;C\a'
else
    PS0='${__kyu_nada[__kyu_t0=1]}\e]133;C\a'
fi
PS2='  '

# El código de salida se guarda antes que nada; el prompt de Kyu va el último para
# que gane a cualquier otro (starship, oh-my-posh…) que cambie PS1.
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
    PROMPT_COMMAND=('__kyu_codigo=$?' "${PROMPT_COMMAND[@]}" '__kyu_prompt')
else
    PROMPT_COMMAND="__kyu_codigo=\$?${PROMPT_COMMAND:+;$PROMPT_COMMAND};__kyu_prompt"
fi
