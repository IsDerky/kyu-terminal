//! Dibuja la rejilla del terminal con egui y traduce el teclado a bytes.

use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::TermMode;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::vte::ansi::{Color, NamedColor};
use egui::{Align2, Color32, FontId, Key, Pos2, Rect, Sense, Vec2};

use crate::tema::Tema;
use crate::terminal::Terminal;

pub fn dibujar(ui: &mut egui::Ui, terminal: &mut Terminal, tema: &Tema) {
    let fuente = FontId::monospace(tema.fuente_tamano);
    let celda = tamano_celda(ui, &fuente);

    let (respuesta, pintor) = ui.allocate_painter(ui.available_size(), Sense::click());
    let zona = respuesta.rect;

    let columnas = (zona.width() / celda.x).floor().max(2.0) as u16;
    let lineas = (zona.height() / celda.y).floor().max(1.0) as u16;
    terminal.redimensionar(columnas, lineas, celda.x as u16, celda.y as u16);

    teclado(ui, terminal);

    let term = terminal.term.lock();
    let contenido = term.renderable_content();
    let desplazamiento = contenido.display_offset as i32;
    let texto_def = tema.texto();

    for celda_t in contenido.display_iter {
        let linea = celda_t.point.line.0 + desplazamiento;
        let columna = celda_t.point.column.0;
        if linea < 0 || linea >= term.screen_lines() as i32 {
            continue;
        }
        let flags = celda_t.flags;
        if flags.contains(Flags::WIDE_CHAR_SPACER) {
            continue;
        }

        let mut fg = color(celda_t.fg, tema, true);
        let mut bg = color(celda_t.bg, tema, false);
        if flags.contains(Flags::INVERSE) {
            std::mem::swap(&mut fg, &mut bg);
        }
        if flags.contains(Flags::DIM) {
            fg = fg.gamma_multiply(0.66);
        }

        let origen = Pos2::new(zona.left() + columna as f32 * celda.x, zona.top() + linea as f32 * celda.y);
        let ancho = if flags.contains(Flags::WIDE_CHAR) { 2.0 } else { 1.0 };
        if bg != tema.fondo() {
            pintor.rect_filled(Rect::from_min_size(origen, Vec2::new(celda.x * ancho, celda.y)), 0.0, bg);
        }
        let c = celda_t.c;
        if c != ' ' && c != '\t' && !flags.contains(Flags::HIDDEN) {
            pintor.text(origen, Align2::LEFT_TOP, c, fuente.clone(), if fg == Color32::TRANSPARENT { texto_def } else { fg });
        }
        if flags.intersects(Flags::UNDERLINE | Flags::DOUBLE_UNDERLINE) {
            let y = origen.y + celda.y - 1.5;
            pintor.line_segment([Pos2::new(origen.x, y), Pos2::new(origen.x + celda.x * ancho, y)], (1.0, fg));
        }
    }

    // Cursor: bloque verde, solo si el programa lo muestra y estamos abajo del todo.
    if term.mode().contains(TermMode::SHOW_CURSOR) {
        let p = contenido.cursor.point;
        let linea = p.line.0 + desplazamiento;
        if linea >= 0 && linea < term.screen_lines() as i32 {
            let origen = Pos2::new(zona.left() + p.column.0 as f32 * celda.x, zona.top() + linea as f32 * celda.y);
            let rect = Rect::from_min_size(origen, celda);
            if ui.ctx().input(|i| i.focused) {
                pintor.rect_filled(rect, 1.0, tema.cursor().gamma_multiply(0.85));
            } else {
                pintor.rect_stroke(rect, 1.0, (1.0, tema.cursor()), egui::StrokeKind::Inside);
            }
        }
    }
}

fn tamano_celda(ui: &egui::Ui, fuente: &FontId) -> Vec2 {
    let galley = ui.painter().layout_no_wrap("M".into(), fuente.clone(), Color32::WHITE);
    Vec2::new(galley.size().x, galley.size().y).round()
}

fn color(c: Color, tema: &Tema, es_texto: bool) -> Color32 {
    match c {
        Color::Spec(rgb) => Color32::from_rgb(rgb.r, rgb.g, rgb.b),
        Color::Indexed(i) => indexado(i, tema),
        Color::Named(n) => match n {
            NamedColor::Foreground | NamedColor::BrightForeground => tema.texto(),
            NamedColor::DimForeground => tema.texto().gamma_multiply(0.66),
            NamedColor::Background => tema.fondo(),
            NamedColor::Cursor => tema.cursor(),
            otro => {
                let i = otro as usize;
                if i < 16 {
                    tema.ansi(i)
                } else if (NamedColor::DimBlack as usize..=NamedColor::DimWhite as usize).contains(&i) {
                    tema.ansi(i - NamedColor::DimBlack as usize).gamma_multiply(0.66)
                } else if es_texto {
                    tema.texto()
                } else {
                    tema.fondo()
                }
            }
        },
    }
}

/// Paleta de 256: 16 del tema, cubo 6×6×6 y 24 grises.
fn indexado(i: u8, tema: &Tema) -> Color32 {
    match i {
        0..=15 => tema.ansi(i as usize),
        16..=231 => {
            let i = i - 16;
            let nivel = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
            Color32::from_rgb(nivel(i / 36), nivel((i / 6) % 6), nivel(i % 6))
        }
        _ => {
            let g = 8 + (i - 232) * 10;
            Color32::from_rgb(g, g, g)
        }
    }
}

fn teclado(ui: &egui::Ui, terminal: &Terminal) {
    let modo = terminal.modo();
    let app_cursor = modo.contains(TermMode::APP_CURSOR);
    let eventos = ui.input(|i| i.events.clone());

    for evento in eventos {
        match evento {
            egui::Event::MouseWheel { unit, delta, .. } if !modo.contains(TermMode::ALT_SCREEN) => {
                let lineas = match unit {
                    egui::MouseWheelUnit::Point => delta.y / 20.0,
                    egui::MouseWheelUnit::Line => delta.y * 3.0,
                    egui::MouseWheelUnit::Page => delta.y * 20.0,
                };
                terminal.desplazar(lineas.round() as i32);
            }
            egui::Event::Text(t) => terminal.teclear(t.into_bytes()),
            egui::Event::Paste(t) => terminal.pegar(&t),
            // egui convierte Ctrl+C / Ctrl+X en Copy / Cut: en un terminal son señales.
            egui::Event::Copy => terminal.teclear(&b"\x03"[..]),
            egui::Event::Cut => terminal.teclear(&b"\x18"[..]),
            egui::Event::Key { key, pressed: true, modifiers, .. } => {
                if let Some(bytes) = tecla(key, modifiers, app_cursor) {
                    terminal.teclear(bytes);
                }
            }
            _ => {}
        }
    }
}

fn tecla(key: Key, m: egui::Modifiers, app_cursor: bool) -> Option<Vec<u8>> {
    let flecha = |c: char| {
        if app_cursor { format!("\x1bO{c}") } else { format!("\x1b[{c}") }.into_bytes()
    };
    let b = |s: &str| Some(s.as_bytes().to_vec());

    if m.ctrl && !m.alt {
        let nombre = key.name();
        if nombre.len() == 1 {
            let c = nombre.chars().next()?.to_ascii_lowercase();
            if c.is_ascii_lowercase() {
                return Some(vec![c as u8 - b'a' + 1]);
            }
        }
    }

    match key {
        Key::Enter => b("\r"),
        Key::Backspace => if m.ctrl { b("\x17") } else { b("\x7f") },
        Key::Tab => if m.shift { b("\x1b[Z") } else { b("\t") },
        Key::Escape => b("\x1b"),
        Key::ArrowUp => Some(flecha('A')),
        Key::ArrowDown => Some(flecha('B')),
        Key::ArrowRight => if m.ctrl { b("\x1b[1;5C") } else { Some(flecha('C')) },
        Key::ArrowLeft => if m.ctrl { b("\x1b[1;5D") } else { Some(flecha('D')) },
        Key::Home => b("\x1b[H"),
        Key::End => b("\x1b[F"),
        Key::Delete => b("\x1b[3~"),
        Key::Insert => b("\x1b[2~"),
        Key::PageUp => b("\x1b[5~"),
        Key::PageDown => b("\x1b[6~"),
        Key::F1 => b("\x1bOP"),
        Key::F2 => b("\x1bOQ"),
        Key::F3 => b("\x1bOR"),
        Key::F4 => b("\x1bOS"),
        _ => None,
    }
}
