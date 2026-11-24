//! Núcleo de Kyu: lo que la ventana (React) no puede hacer sola.
//! Abre las shells en un PTY, lee `kyu.toml`, abre y guarda archivos y da datos
//! del equipo (RAM) y habla con Claude Code.

mod ajustes;
mod archivos;
mod autocompletar;
mod claude;
mod config;
mod mcp;
mod pty;
mod sistema;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(pty::Ptys::default())
        .manage(sistema::Sistema::default())
        .manage(claude::Claudes::default())
        .setup(|app| {
            use tauri::Manager;
            // Servidor MCP para el Claude del panel (None si no se pudo abrir el puerto).
            let mcp = mcp::arrancar(app.handle().clone());
            app.manage(mcp);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::config,
            ajustes::ajustes_leer,
            ajustes::ajustes_guardar,
            pty::pty_abrir,
            pty::pty_escribir,
            pty::pty_redimensionar,
            pty::pty_carpeta,
            pty::pty_cerrar,
            pty::pty_cerrar_todas,
            archivos::archivo_resolver,
            archivos::archivo_leer,
            archivos::archivo_guardar,
            autocompletar::carpeta_listar,
            autocompletar::git_ramas,
            sistema::ram_uso,
            claude::claude_abrir,
            claude::claude_enviar,
            claude::claude_responder,
            claude::claude_parar,
            claude::claude_cerrar,
            claude::claude_cerrar_todas,
            mcp::mcp_responder,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar Kyu");
}
