//! Grabar la sesión a GIF: fotografía la ventana de Kyu unas 8 veces por segundo (con
//! `PrintWindow` y PW_RENDERFULLCONTENT, que sí ve el contenido de WebView2; solo en
//! Windows de momento), recorta el panel elegido y va
//! escribiendo el GIF mientras graba. Los fotogramas repetidos no se guardan: alargan
//! el anterior (un terminal casi siempre está quieto, así el GIF pesa poco).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::State;

const INTERVALO: Duration = Duration::from_millis(125);
const MAXIMO: Duration = Duration::from_secs(60);
/// El último fotograma se queda un rato antes de volver a empezar.
const PAUSA_FINAL_MS: u32 = 1500;

#[derive(Default)]
pub struct Grabadora {
    activa: Mutex<Option<Grabacion>>,
}

struct Grabacion {
    parar: Arc<AtomicBool>,
    hilo: JoinHandle<Result<PathBuf, String>>,
}

#[derive(serde::Deserialize, Clone, Copy)]
pub struct Recorte {
    x: f64,
    y: f64,
    ancho: f64,
    alto: f64,
    /// devicePixelRatio de la ventana.
    escala: f64,
}

/// Una foto de la zona de cliente de la ventana: (ancho, alto, RGBA).
type Foto = (u32, u32, Vec<u8>);

#[cfg(windows)]
fn fotografiar(hwnd: isize) -> Option<Foto> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
    };
    use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
    // SAFETY: llamadas GDI sobre la ventana propia; todo lo creado se libera antes de salir.
    unsafe {
        let hwnd = HWND(hwnd as *mut core::ffi::c_void);
        let mut r = RECT::default();
        GetClientRect(hwnd, &mut r).ok()?;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        let dc_ventana = GetDC(Some(hwnd));
        let dc = CreateCompatibleDC(Some(dc_ventana));
        let mapa = CreateCompatibleBitmap(dc_ventana, w, h);
        let anterior = SelectObject(dc, mapa.into());
        // 1 = solo la zona de cliente, 2 = PW_RENDERFULLCONTENT (WebView2 / DirectComposition)
        let hecho = PrintWindow(hwnd, dc, PRINT_WINDOW_FLAGS(3)).as_bool();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // de arriba abajo
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut datos = vec![0u8; (w * h * 4) as usize];
        let filas = GetDIBits(
            dc,
            mapa,
            0,
            h as u32,
            Some(datos.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(dc, anterior);
        let _ = DeleteObject(mapa.into());
        let _ = DeleteDC(dc);
        ReleaseDC(Some(hwnd), dc_ventana);
        if !hecho || filas == 0 {
            return None;
        }
        for p in datos.as_chunks_mut::<4>().0 {
            p.swap(0, 2); // BGRA → RGBA
            p[3] = 255;
        }
        Some((w as u32, h as u32, datos))
    }
}

#[cfg(not(windows))]
fn fotografiar(_hwnd: isize) -> Option<Foto> {
    None
}

#[cfg(windows)]
fn hwnd_de(ventana: &tauri::WebviewWindow) -> Result<isize, String> {
    Ok(ventana.hwnd().map_err(|e| e.to_string())?.0 as isize)
}

#[cfg(not(windows))]
fn hwnd_de(_ventana: &tauri::WebviewWindow) -> Result<isize, String> {
    Err("grabar a GIF solo funciona en Windows de momento".into())
}

/// Asíncrona a propósito: así no corre en el hilo de la ventana, que tiene que atender
/// el PrintWindow.
#[tauri::command(async)]
pub fn grabar_empezar(
    ventana: tauri::WebviewWindow,
    grabadora: State<'_, Grabadora>,
    recorte: Recorte,
    nombre: String,
) -> Result<String, String> {
    let mut activa = grabadora.activa.lock().map_err(|_| "estado roto")?;
    if activa.is_some() {
        return Err("ya se está grabando".into());
    }
    let hwnd = hwnd_de(&ventana)?;
    let carpeta = dirs::video_dir()
        .or_else(dirs::home_dir)
        .ok_or("no encuentro la carpeta de vídeos")?
        .join("Kyu");
    std::fs::create_dir_all(&carpeta).map_err(|e| e.to_string())?;
    let nombre: String = nombre
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let ruta = carpeta.join(format!(
        "{}.gif",
        if nombre.is_empty() { "kyu" } else { &nombre }
    ));

    // Primera foto ya aquí: si falla, se avisa enseguida en vez de grabar nada.
    let (ancho, alto, _) = fotografiar(hwnd).ok_or("no se pudo fotografiar la ventana de Kyu")?;
    let (x, y, w, h) = encajar(&recorte, ancho, alto)?;

    let parar = Arc::new(AtomicBool::new(false));
    let parar_hilo = parar.clone();
    let ruta_hilo = ruta.clone();
    let hilo = std::thread::spawn(move || grabar(hwnd, (x, y, w, h), ruta_hilo, parar_hilo));
    *activa = Some(Grabacion { parar, hilo });
    Ok(ruta.display().to_string())
}

/// Para la grabación y espera a que el GIF quede escrito; devuelve su ruta.
#[tauri::command(async)]
pub fn grabar_parar(grabadora: State<'_, Grabadora>) -> Result<String, String> {
    let g = grabadora
        .activa
        .lock()
        .map_err(|_| "estado roto")?
        .take()
        .ok_or("no se está grabando")?;
    g.parar.store(true, Ordering::Relaxed);
    let ruta = g.hilo.join().map_err(|_| "el grabador se ha caído")??;
    Ok(ruta.display().to_string())
}

/// El recorte en píxeles de la foto, dentro de sus límites (y par, que el GIF lo agradece).
fn encajar(r: &Recorte, ancho: u32, alto: u32) -> Result<(u32, u32, u32, u32), String> {
    let px = |v: f64| (v * r.escala).round().max(0.0) as u32;
    let x = px(r.x).min(ancho.saturating_sub(1));
    let y = px(r.y).min(alto.saturating_sub(1));
    let w = px(r.ancho).min(ancho - x).min(u16::MAX as u32) & !1;
    let h = px(r.alto).min(alto - y).min(u16::MAX as u32) & !1;
    if w < 16 || h < 16 {
        return Err("el panel es demasiado pequeño para grabarlo".into());
    }
    Ok((x, y, w, h))
}

fn recortar((ancho, alto, datos): &Foto, (x, y, w, h): (u32, u32, u32, u32)) -> Option<Vec<u8>> {
    if *ancho < x + w || *alto < y + h {
        return None; // la ventana ha cambiado de tamaño
    }
    let mut salida = Vec::with_capacity((w * h * 4) as usize);
    let fila = *ancho as usize * 4;
    for f in y..y + h {
        let ini = f as usize * fila + x as usize * 4;
        salida.extend_from_slice(&datos[ini..ini + w as usize * 4]);
    }
    Some(salida)
}

fn grabar(
    hwnd: isize,
    caja: (u32, u32, u32, u32),
    ruta: PathBuf,
    parar: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    let (_, _, w, h) = caja;
    // El GIF se codifica en otro hilo; si se atrasa, se saltan fotos (alarga la anterior).
    let (tx, rx): (SyncSender<(Vec<u8>, u32)>, _) = sync_channel(12);
    let ruta_enc = ruta.clone();
    let codificador = std::thread::spawn(move || -> Result<(), String> {
        let archivo = std::fs::File::create(&ruta_enc).map_err(|e| e.to_string())?;
        let mut enc = gif::Encoder::new(std::io::BufWriter::new(archivo), w as u16, h as u16, &[])
            .map_err(|e| e.to_string())?;
        enc.set_repeat(gif::Repeat::Infinite)
            .map_err(|e| e.to_string())?;
        for (mut rgba, ms) in rx {
            let mut f = gif::Frame::from_rgba_speed(w as u16, h as u16, &mut rgba, 20);
            f.delay = (ms / 10).clamp(2, u16::MAX as u32) as u16;
            enc.write_frame(&f).map_err(|e| e.to_string())?;
        }
        Ok(())
    });

    let inicio = Instant::now();
    let mut anterior: Option<(Vec<u8>, Instant)> = None;
    let enviar = |buf: Vec<u8>, ms: u32| {
        let _ = tx.send((buf, ms));
    };
    while !parar.load(Ordering::Relaxed) && inicio.elapsed() < MAXIMO {
        let vuelta = Instant::now();
        if let Some(img) = fotografiar(hwnd)
            && let Some(foto) = recortar(&img, caja)
        {
            match &anterior {
                Some((buf, _)) if *buf == foto => {} // igual que la anterior: se alarga
                _ => {
                    if let Some((buf, desde)) = anterior.take() {
                        enviar(buf, desde.elapsed().as_millis() as u32);
                    }
                    anterior = Some((foto, Instant::now()));
                }
            }
        }
        if let Some(resto) = INTERVALO.checked_sub(vuelta.elapsed()) {
            std::thread::sleep(resto);
        }
    }
    if let Some((buf, desde)) = anterior.take() {
        enviar(buf, desde.elapsed().as_millis() as u32 + PAUSA_FINAL_MS);
    }
    drop(tx);
    codificador
        .join()
        .map_err(|_| "el codificador se ha caído")??;
    Ok(ruta)
}
