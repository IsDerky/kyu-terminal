fn main() {
    copiar_conpty();
    tauri_build::build()
}

/// En Windows, deja `conpty.dll` y `OpenConsole.exe` (ver conpty/LEEME.md) junto al
/// ejecutable: portable-pty los prefiere al ConPTY del sistema, que se traga las imágenes
/// sixel. El instalador los lleva por tauri.windows.conf.json.
fn copiar_conpty() {
    println!("cargo:rerun-if-changed=conpty");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let Ok(salida) = std::env::var("OUT_DIR") else { return };
    // OUT_DIR = target/<perfil>/build/<paquete>/out → target/<perfil>
    let Some(destino) = std::path::Path::new(&salida).ancestors().nth(3) else { return };
    for archivo in ["conpty.dll", "OpenConsole.exe"] {
        let origen = std::path::Path::new("conpty").join(archivo);
        if let Err(e) = std::fs::copy(&origen, destino.join(archivo)) {
            println!("cargo:warning=no se pudo copiar {}: {e}", origen.display());
        }
    }
}
