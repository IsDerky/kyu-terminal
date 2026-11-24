//! Núcleo de Kyu: lo que la ventana (React) no puede hacer sola.
//! Abre las shells en un PTY, lee `kyu.toml` y da datos del equipo (RAM).

mod config;
mod pty;
mod sistema;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::Ptys::default())
        .manage(sistema::Sistema::default())
        .invoke_handler(tauri::generate_handler![
            config::config,
            pty::pty_abrir,
            pty::pty_escribir,
            pty::pty_redimensionar,
            pty::pty_cerrar,
            sistema::ram_uso,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar Kyu");
}
