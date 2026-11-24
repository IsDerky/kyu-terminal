//! Menos memoria en segundo plano: cuando Kyu lleva un rato sin el foco, se le pide a WebView2
//! el nivel de memoria «bajo» (suelta cachés y saca de RAM lo que puede); al volver el foco,
//! «normal». Solo en Windows (en Linux WebKitGTK no tiene nada parecido).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Lo que tiene que estar Kyu sin foco antes de bajar la memoria (cambiar de ventana un
/// momento no debe tirar las cachés).
const ESPERA: Duration = Duration::from_secs(30);

/// Cambia con cada pérdida o vuelta del foco: el temporizador de una pérdida vieja no hace nada.
static TURNO: AtomicU64 = AtomicU64::new(0);

/// Llamar con cada `WindowEvent::Focused`.
pub fn al_cambiar_foco(ventana: &tauri::WebviewWindow, con_foco: bool) {
    let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
    if con_foco {
        poner_nivel(ventana, false);
        return;
    }
    let ventana = ventana.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ESPERA);
        if TURNO.load(Ordering::SeqCst) == turno {
            poner_nivel(&ventana, true);
        }
    });
}

#[cfg(windows)]
fn poner_nivel(ventana: &tauri::WebviewWindow, bajo: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
    };
    use windows::core::Interface;
    let _ = ventana.with_webview(move |w| unsafe {
        let Ok(core) = w.controller().CoreWebView2() else { return };
        // ICoreWebView2_19 llega con WebView2 115; uno más viejo simplemente no lo hace.
        let Ok(c19) = core.cast::<ICoreWebView2_19>() else { return };
        let nivel = if bajo {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        let _ = c19.SetMemoryUsageTargetLevel(nivel);
    });
}

#[cfg(not(windows))]
fn poner_nivel(_ventana: &tauri::WebviewWindow, _bajo: bool) {}
