//! Núcleo de Kyu: lo que la ventana (React) no puede hacer sola.
//! Abre las shells en un PTY, lee `kyu.toml`, abre y guarda archivos y da datos
//! del equipo (RAM) y habla con Claude Code.

mod acp;
mod activas;
mod ajustes;
mod arbol;
mod archivos;
mod autocompletar;
mod claude;
mod config;
mod cuentas;
mod entorno;
mod git;
mod grabar;
mod mcp;
mod memoria;
mod permisos;
mod pty;
mod puertos;
mod sesiones;
mod sistema;
mod uso;

pub fn run() {
    // Portable: WebView2 guarda sesión, historial y caché en datos\webview, no en
    // %LOCALAPPDATA%. La variable manda sobre la carpeta que le pasa Tauri.
    if let Some(datos) = config::carpeta_portable() {
        // SAFETY: aún no hay más hilos; nadie lee el entorno a la vez.
        unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", datos.join("webview")) };
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pty::Ptys::default())
        .manage(sistema::Sistema::default())
        .manage(claude::Claudes::default())
        .manage(grabar::Grabadora::default())
        .setup(|app| {
            use tauri::Manager;
            // Servidor MCP para el Claude del panel (None si no se pudo abrir el puerto).
            let mcp = mcp::arrancar(app.handle().clone());
            app.manage(mcp);
            // Si arranca sin foco (abierto desde otro programa, detrás de otra ventana) no
            // llega ningún «ha perdido el foco»: se cuenta desde ya.
            if let Some(w) = app.get_webview_window("main") {
                memoria::al_cambiar_foco(&w, w.is_focused().unwrap_or(true));
            }
            Ok(())
        })
        .on_window_event(|ventana, evento| {
            if let tauri::WindowEvent::Focused(con_foco) = evento {
                use tauri::Manager;
                if let Some(w) = ventana.app_handle().get_webview_window(ventana.label()) {
                    memoria::al_cambiar_foco(&w, *con_foco);
                }
            }
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
            archivos::archivo_borrar,
            entorno::entorno_leer,
            puertos::puerto_quien,
            puertos::proceso_matar,
            arbol::arbol_listar,
            arbol::git_estado,
            git::git_resumen,
            git::git_cambios,
            git::git_diff,
            git::git_commit,
            git::git_subir,
            git::gh_runs,
            git::gh_issues,
            git::git_worktree_nuevo,
            git::git_worktree_quitar,
            git::git_es_commit,
            git::claude_mensaje_commit,
            autocompletar::carpeta_listar,
            autocompletar::git_ramas,
            sistema::ram_uso,
            claude::claude_abrir,
            claude::claude_enviar,
            claude::claude_control,
            sesiones::claude_sesiones,
            sesiones::claude_historial,
            sesiones::archivos_buscar,
            claude::claude_responder,
            claude::claude_parar,
            claude::claude_opcion,
            activas::claude_activas,
            acp::acp_sesiones,
            acp::acp_entrar,
            permisos::permisos_leer,
            permisos::permisos_quitar,
            archivos::conversacion_exportar,
            claude::claude_cerrar,
            claude::claude_cerrar_todas,
            cuentas::claude_cuentas,
            cuentas::claude_cuenta_entrar,
            cuentas::claude_cuenta_anadir,
            cuentas::claude_cuenta_quitar,
            mcp::mcp_responder,
            grabar::grabar_empezar,
            grabar::grabar_parar,
            uso::uso_leer,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar Kyu");
}
