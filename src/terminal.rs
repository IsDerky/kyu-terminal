//! Una shell de verdad: PTY (ConPTY en Windows) + intérprete de secuencias de alacritty.

use std::borrow::Cow;
use std::sync::{Arc, mpsc};

use alacritty_terminal::event::{Event, EventListener, Notify, OnResize, WindowSize};
use alacritty_terminal::event_loop::{EventLoop, Notifier};
use alacritty_terminal::grid::Scroll;
use alacritty_terminal::index::{Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::sync::FairMutex;
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{self, Term, TermMode};
use alacritty_terminal::tty;

/// Recibe los eventos del hilo del PTY y despierta a egui para que repinte.
#[derive(Clone)]
pub struct Aviso {
    tx: mpsc::Sender<Event>,
    ctx: egui::Context,
}

impl EventListener for Aviso {
    fn send_event(&self, evento: Event) {
        let _ = self.tx.send(evento);
        self.ctx.request_repaint();
    }
}

pub struct Terminal {
    pub term: Arc<FairMutex<Term<Aviso>>>,
    notificador: Notifier,
    eventos: mpsc::Receiver<Event>,
    columnas: u16,
    lineas: u16,
    cerrada: bool,
    titulo: Option<String>,
    /// Dónde se pulsó el botón izquierdo, mientras se arrastra para seleccionar.
    pub arrastrando: Option<egui::Pos2>,
}

impl Terminal {
    pub fn nueva(ctx: egui::Context, (shell, argumentos): &(String, Vec<String>)) -> std::io::Result<Self> {
        let (columnas, lineas) = (80u16, 24u16);
        let opciones = tty::Options {
            shell: Some(tty::Shell::new(shell.clone(), argumentos.clone())),
            working_directory: dirs::home_dir(),
            env: [("KYU_TERMINAL".to_string(), env!("CARGO_PKG_VERSION").to_string())].into(),
            #[cfg(windows)]
            escape_args: true,
            ..Default::default()
        };
        let tamano = WindowSize { num_lines: lineas, num_cols: columnas, cell_width: 1, cell_height: 1 };
        let pty = tty::new(&opciones, tamano, 0)?;

        let (tx, eventos) = mpsc::channel();
        let aviso = Aviso { tx, ctx };
        let term = Term::new(
            term::Config::default(),
            &TermSize::new(columnas as usize, lineas as usize),
            aviso.clone(),
        );
        let term = Arc::new(FairMutex::new(term));

        let bucle = EventLoop::new(term.clone(), aviso, pty, false, false)?;
        let notificador = Notifier(bucle.channel());
        bucle.spawn();

        Ok(Self { term, notificador, eventos, columnas, lineas, cerrada: false, titulo: None, arrastrando: None })
    }

    /// Vacía los eventos pendientes del PTY.
    pub fn atender_eventos(&mut self) {
        while let Ok(evento) = self.eventos.try_recv() {
            match evento {
                // Respuestas que pide el programa (posición del cursor, colores…).
                Event::PtyWrite(texto) => self.escribir(texto.into_bytes()),
                Event::Title(t) => self.titulo = Some(t),
                Event::ResetTitle => self.titulo = Some(String::new()),
                Event::Exit | Event::ChildExit(_) => self.cerrada = true,
                _ => {}
            }
        }
    }

    pub fn cerrada(&self) -> bool {
        self.cerrada
    }

    pub fn titulo_nuevo(&mut self) -> Option<String> {
        self.titulo.take().filter(|t| !t.is_empty())
    }

    pub fn escribir(&self, bytes: impl Into<Cow<'static, [u8]>>) {
        self.notificador.notify(bytes);
    }

    /// Lo que escribe el usuario: baja al final del historial antes de mandarlo.
    pub fn teclear(&self, bytes: impl Into<Cow<'static, [u8]>>) {
        self.term.lock().scroll_display(Scroll::Bottom);
        self.escribir(bytes);
    }

    pub fn pegar(&self, texto: &str) {
        let texto = texto.replace("\r\n", "\r").replace('\n', "\r");
        if self.modo().contains(TermMode::BRACKETED_PASTE) {
            self.teclear(format!("\x1b[200~{texto}\x1b[201~").into_bytes());
        } else {
            self.teclear(texto.into_bytes());
        }
    }

    pub fn seleccionar_desde(&self, tipo: SelectionType, punto: Point, lado: Side) {
        self.term.lock().selection = Some(Selection::new(tipo, punto, lado));
    }

    pub fn seleccionar_hasta(&self, punto: Point, lado: Side) {
        if let Some(seleccion) = self.term.lock().selection.as_mut() {
            seleccion.update(punto, lado);
        }
    }

    pub fn seleccion_vacia(&self) -> bool {
        self.term.lock().selection.is_none()
    }

    pub fn limpiar_seleccion(&self) {
        self.term.lock().selection = None;
    }

    /// Texto seleccionado, si hay algo que no sea vacío.
    pub fn seleccion(&self) -> Option<String> {
        self.term.lock().selection_to_string().filter(|s| !s.is_empty())
    }

    pub fn desplazar(&self, lineas: i32) {
        self.term.lock().scroll_display(Scroll::Delta(lineas));
    }

    pub fn modo(&self) -> TermMode {
        *self.term.lock().mode()
    }

    pub fn redimensionar(&mut self, columnas: u16, lineas: u16, ancho_celda: u16, alto_celda: u16) {
        if (columnas, lineas) == (self.columnas, self.lineas) || columnas < 2 || lineas < 1 {
            return;
        }
        self.columnas = columnas;
        self.lineas = lineas;
        self.term.lock().resize(TermSize::new(columnas as usize, lineas as usize));
        self.notificador.on_resize(WindowSize {
            num_lines: lineas,
            num_cols: columnas,
            cell_width: ancho_celda,
            cell_height: alto_celda,
        });
    }
}
