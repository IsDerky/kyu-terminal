//! Panel de Claude a la derecha, barra de estado y avisos flotantes.

use egui::{
    Align, Color32, CornerRadius, FontId, Frame, Id, Key, Layout, Margin, RichText, Stroke,
};
use egui_commonmark::{CommonMarkCache, CommonMarkViewer};

use crate::claude::{Claude, Evento, Permiso, Respuesta, buscar_programa};

const PANEL: Color32 = Color32::from_rgb(0x14, 0x11, 0x1f);
const BORDE: Color32 = Color32::from_rgb(0x2a, 0x23, 0x40);
const BORDE2: Color32 = Color32::from_rgb(0x3a, 0x2f, 0x5c);
const TEXTO: Color32 = Color32::from_rgb(0xd9, 0xd4, 0xea);
const TENUE: Color32 = Color32::from_rgb(0x8a, 0x83, 0xa3);
const MORADO2: Color32 = Color32::from_rgb(0xc4, 0x8b, 0xff);
const VERDE: Color32 = Color32::from_rgb(0x5c, 0xff, 0x2e);
const ROJO: Color32 = Color32::from_rgb(0xff, 0x4d, 0x6d);

const ID_ENTRADA: &str = "kyu_entrada_claude";

enum Mensaje {
    Yo(String),
    Claude(String),
    Herramienta {
        id: String,
        nombre: String,
        resumen: String,
        error: Option<bool>,
    },
    Aviso(String),
}

#[derive(PartialEq)]
enum Estado {
    SinArrancar,
    Listo,
    Pensando,
    EsperandoPermiso,
    Cerrado,
}

pub struct Panel {
    pub visible: bool,
    claude: Option<Claude>,
    programa: Option<String>,
    mensajes: Vec<Mensaje>,
    parcial: String,
    entrada: String,
    permiso: Option<Permiso>,
    estado: Estado,
    herramienta: Option<String>,
    modelo: String,
    contexto: u64,
    coste: f64,
    carpeta: Option<std::path::PathBuf>,
    /// Aviso «Claude ha terminado» mientras el panel está oculto.
    aviso_fin: bool,
    cache: CommonMarkCache,
}

impl Panel {
    pub fn new(programa: Option<String>) -> Self {
        Self {
            visible: false,
            claude: None,
            programa,
            mensajes: Vec::new(),
            parcial: String::new(),
            entrada: String::new(),
            permiso: None,
            estado: Estado::SinArrancar,
            herramienta: None,
            modelo: String::new(),
            contexto: 0,
            coste: 0.0,
            carpeta: None,
            aviso_fin: false,
            cache: CommonMarkCache::default(),
        }
    }

    /// Ctrl+Mayús+C: abre o cierra el panel y pone el foco en la caja de texto.
    pub fn alternar(&mut self, ctx: &egui::Context) {
        self.visible = !self.visible;
        if self.visible {
            self.aviso_fin = false;
            ctx.memory_mut(|m| m.request_focus(Id::unique(ID_ENTRADA)));
        } else {
            ctx.memory_mut(|m| m.surrender_focus(Id::unique(ID_ENTRADA)));
        }
    }

    pub fn atender_eventos(&mut self) {
        let Some(claude) = &self.claude else { return };
        let eventos: Vec<Evento> = claude.eventos.try_iter().collect();
        for ev in eventos {
            match ev {
                Evento::Iniciado { modelo } => self.modelo = modelo,
                Evento::Parcial(t) => self.parcial.push_str(&t),
                Evento::Texto(t) => {
                    self.parcial.clear();
                    if !t.trim().is_empty() {
                        self.mensajes.push(Mensaje::Claude(t));
                    }
                }
                Evento::Herramienta {
                    id,
                    nombre,
                    resumen,
                } => {
                    self.parcial.clear();
                    self.herramienta = Some(format!("{nombre} {resumen}"));
                    self.mensajes.push(Mensaje::Herramienta {
                        id,
                        nombre,
                        resumen,
                        error: None,
                    });
                }
                Evento::ResultadoHerramienta { id, error } => {
                    self.herramienta = None;
                    for m in self.mensajes.iter_mut().rev() {
                        if let Mensaje::Herramienta {
                            id: i, error: e, ..
                        } = m
                            && *i == id
                        {
                            *e = Some(error);
                            break;
                        }
                    }
                }
                Evento::Permiso(p) => {
                    self.estado = Estado::EsperandoPermiso;
                    self.permiso = Some(p);
                }
                Evento::Contexto(c) => self.contexto = c,
                Evento::Fin { coste, error } => {
                    self.coste = coste;
                    self.estado = Estado::Listo;
                    self.herramienta = None;
                    if !self.parcial.is_empty() {
                        self.mensajes
                            .push(Mensaje::Claude(std::mem::take(&mut self.parcial)));
                    }
                    if error {
                        self.mensajes
                            .push(Mensaje::Aviso("Claude terminó con error".into()));
                    }
                    if !self.visible {
                        self.aviso_fin = true;
                    }
                }
                Evento::Error(linea) => self.mensajes.push(Mensaje::Aviso(linea)),
                Evento::Cerrado => {
                    self.estado = Estado::Cerrado;
                    self.mensajes.push(Mensaje::Aviso(
                        "Claude Code se ha cerrado. Escribe otra vez para empezar una sesión nueva.".into(),
                    ));
                }
            }
        }
        if self.estado == Estado::Cerrado {
            self.claude = None;
        }
    }

    fn enviar(&mut self, ctx: &egui::Context) {
        let texto = self.entrada.trim().to_string();
        if texto.is_empty()
            || self.estado == Estado::Pensando
            || self.estado == Estado::EsperandoPermiso
        {
            return;
        }
        if self.claude.is_none() {
            let Some(programa) = buscar_programa(self.programa.as_deref()) else {
                self.mensajes.push(Mensaje::Aviso(
                    "No encuentro Claude Code. Instálalo o pon `claude = \"ruta\"` en kyu.toml."
                        .into(),
                ));
                return;
            };
            let carpeta = crate::terminal::carpeta_actual()
                .or_else(dirs::home_dir)
                .unwrap_or_else(|| ".".into());
            match Claude::arrancar(&programa, &carpeta, ctx.clone()) {
                Ok(c) => {
                    self.claude = Some(c);
                    self.carpeta = Some(carpeta);
                }
                Err(e) => {
                    self.mensajes.push(Mensaje::Aviso(format!(
                        "No se pudo arrancar Claude Code: {e}"
                    )));
                    return;
                }
            }
        }
        if let Some(c) = &self.claude {
            c.enviar(&texto);
            self.mensajes.push(Mensaje::Yo(texto));
            self.entrada.clear();
            self.estado = Estado::Pensando;
        }
    }

    fn responder(&mut self, respuesta: Respuesta) {
        if let (Some(c), Some(p)) = (&self.claude, self.permiso.take()) {
            let texto = match respuesta {
                Respuesta::Permitir => "Permitido",
                Respuesta::Siempre => "Permitido siempre",
                Respuesta::Denegar => "Denegado",
            };
            c.responder(&p, respuesta);
            self.mensajes.push(Mensaje::Aviso(format!(
                "{texto}: {} {}",
                p.herramienta, p.resumen
            )));
            self.estado = Estado::Pensando;
        }
    }

    /// El panel lateral. Va antes del terminal para que este ocupe lo que sobra.
    pub fn mostrar(&mut self, ui: &mut egui::Ui) {
        if !self.visible {
            return;
        }
        egui::Panel::right("kyu_panel_claude")
            .resizable(true)
            .default_size(420.0)
            .min_size(300.0)
            .frame(Frame::NONE.fill(PANEL).stroke(Stroke::new(1.0, BORDE)))
            .show(ui, |ui| {
                // Cabecera
                Frame::NONE
                    .inner_margin(Margin::symmetric(12, 9))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            chispa(ui);
                            ui.label(RichText::new("Claude").strong().color(TEXTO));
                            let donde = self
                                .carpeta
                                .as_ref()
                                .and_then(|c| c.file_name())
                                .map(|n| format!("· {}", n.to_string_lossy()))
                                .unwrap_or_else(|| "· sin sesión".into());
                            ui.label(RichText::new(donde).color(TENUE));
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                ui.label(RichText::new("Ctrl+Mayús+C").color(TENUE).small());
                            });
                        });
                    });
                ui.add(egui::Separator::default().spacing(0.0));

                // Caja de texto abajo; los mensajes ocupan lo que queda.
                egui::Panel::bottom("kyu_entrada_panel")
                    .frame(Frame::NONE.inner_margin(Margin::same(12)).fill(PANEL))
                    .show(ui, |ui| self.caja_texto(ui));

                egui::CentralPanel::default()
                    .frame(
                        Frame::NONE
                            .inner_margin(Margin::symmetric(12, 8))
                            .fill(PANEL),
                    )
                    .show(ui, |ui| {
                        egui::ScrollArea::vertical()
                            .stick_to_bottom(true)
                            .auto_shrink([false, false])
                            .show(ui, |ui| self.conversacion(ui));
                    });
            });
    }

    fn caja_texto(&mut self, ui: &mut egui::Ui) {
        let id = Id::unique(ID_ENTRADA);
        let enviar = ui.ctx().memory(|m| m.has_focus(id))
            && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Enter));
        let ocupado = matches!(self.estado, Estado::Pensando | Estado::EsperandoPermiso);
        let pista = if ocupado {
            "Claude está trabajando…"
        } else {
            "Escribe a Claude…  (Enter envía, Mayús+Enter salto)"
        };
        Frame::NONE
            .fill(Color32::from_rgb(0x0f, 0x0d, 0x18))
            .stroke(Stroke::new(1.0, BORDE2))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(Margin::same(8))
            .show(ui, |ui| {
                ui.add(
                    egui::TextEdit::multiline(&mut self.entrada)
                        .id(id)
                        .hint_text(pista)
                        .desired_rows(2)
                        .desired_width(f32::INFINITY)
                        .frame(egui::Frame::NONE),
                );
            });
        if enviar {
            self.enviar(ui.ctx());
        }
    }

    fn conversacion(&mut self, ui: &mut egui::Ui) {
        ui.spacing_mut().item_spacing.y = 10.0;
        if self.mensajes.is_empty() && self.parcial.is_empty() {
            ui.label(
                RichText::new(
                    "Pregunta lo que quieras. Claude arranca en la carpeta de la terminal.",
                )
                .color(TENUE),
            );
        }
        for m in &self.mensajes {
            match m {
                Mensaje::Yo(t) => {
                    ui.with_layout(Layout::top_down(Align::Max), |ui| {
                        Frame::NONE
                            .fill(Color32::from_rgb(0x1f, 0x1a, 0x30))
                            .stroke(Stroke::new(1.0, BORDE2))
                            .corner_radius(CornerRadius::same(8))
                            .inner_margin(Margin::symmetric(10, 8))
                            .show(ui, |ui| {
                                ui.label(RichText::new(t).color(TEXTO));
                            });
                    });
                }
                Mensaje::Claude(t) => {
                    CommonMarkViewer::new().show(ui, &mut self.cache, t);
                }
                Mensaje::Herramienta {
                    nombre,
                    resumen,
                    error,
                    ..
                } => {
                    let (marca, color) = match error {
                        None => ("◌", TENUE),
                        Some(false) => ("✓", VERDE),
                        Some(true) => ("✕", ROJO),
                    };
                    // Un solo texto con dos colores para que las rutas largas partan bien.
                    let mut linea = egui::text::LayoutJob::default();
                    let formato = |c| egui::TextFormat::simple(FontId::monospace(12.0), c);
                    linea.append(&format!("{marca} "), 0.0, formato(color));
                    linea.append(&format!("{nombre}  {resumen}"), 0.0, formato(TENUE));
                    linea.wrap.max_width = ui.available_width();
                    ui.label(linea);
                }
                Mensaje::Aviso(t) => {
                    ui.label(RichText::new(t).color(TENUE).italics().small());
                }
            }
        }
        if !self.parcial.is_empty() {
            CommonMarkViewer::new().show(ui, &mut self.cache, &self.parcial.clone());
        }
        if let Some(p) = self.permiso.clone()
            && let Some(r) = tarjeta_permiso(ui, &p, true)
        {
            self.responder(r);
        }
    }

    /// Barra de abajo con el estado de la sesión de Claude.
    pub fn barra_estado(&self, ui: &mut egui::Ui) {
        egui::Panel::bottom("kyu_barra_estado")
            .exact_size(24.0)
            .frame(
                Frame::NONE
                    .fill(Color32::from_rgb(0x0a, 0x09, 0x11))
                    .inner_margin(Margin::symmetric(10, 3)),
            )
            .show(ui, |ui| {
                ui.horizontal_centered(|ui| {
                    let peq = |t: String, c: Color32| {
                        RichText::new(t).color(c).font(FontId::monospace(11.5))
                    };
                    if let Some(c) = &self.carpeta {
                        ui.label(peq(c.display().to_string(), TENUE));
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if self.coste > 0.0 {
                            ui.label(peq(format!("{:.2} $", self.coste), TENUE));
                        }
                        if self.contexto > 0 {
                            ui.label(peq(format!("contexto {} k", self.contexto / 1000), TENUE));
                        }
                        if !self.modelo.is_empty() {
                            ui.label(peq(self.modelo.clone(), TENUE));
                        }
                        let (texto, color) = match self.estado {
                            Estado::SinArrancar => ("sin sesión".to_string(), TENUE),
                            Estado::Listo => ("listo".to_string(), VERDE),
                            Estado::Pensando => (
                                self.herramienta
                                    .clone()
                                    .map(|h| corto(&h, 50))
                                    .unwrap_or_else(|| "pensando…".into()),
                                MORADO2,
                            ),
                            Estado::EsperandoPermiso => (
                                "esperando permiso".to_string(),
                                Color32::from_rgb(0xff, 0xb5, 0x47),
                            ),
                            Estado::Cerrado => ("cerrado".to_string(), ROJO),
                        };
                        ui.label(peq(texto, color));
                        ui.label(peq(
                            "● Claude".into(),
                            if self.estado == Estado::SinArrancar {
                                TENUE
                            } else {
                                VERDE
                            },
                        ));
                    });
                });
            });
    }

    /// Con el panel oculto, el permiso pendiente o el «he terminado» flotan abajo a la derecha.
    pub fn avisos(&mut self, ctx: &egui::Context) {
        if self.visible {
            return;
        }
        let permiso = self.permiso.clone();
        if permiso.is_none() && !self.aviso_fin {
            return;
        }
        let mut abrir = false;
        egui::Area::new(Id::unique("kyu_aviso"))
            .anchor(egui::Align2::RIGHT_BOTTOM, [-18.0, -36.0])
            .show(ctx, |ui| {
                ui.set_max_width(380.0);
                if let Some(p) = &permiso {
                    if let Some(r) = tarjeta_permiso(ui, p, false) {
                        self.responder(r);
                    }
                } else {
                    tarjeta(ui).show(ui, |ui| {
                        ui.horizontal(|ui| {
                            chispa(ui);
                            ui.label(RichText::new("Claude ha terminado").color(MORADO2));
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if ui.button("Cerrar").clicked() {
                                    self.aviso_fin = false;
                                }
                                if ui.button("Ver").clicked() {
                                    abrir = true;
                                }
                            });
                        });
                    });
                }
            });
        if abrir {
            self.alternar(ctx);
        }
    }
}

fn tarjeta(_ui: &egui::Ui) -> Frame {
    Frame::NONE
        .fill(Color32::from_rgb(0x1a, 0x11, 0x30))
        .stroke(Stroke::new(1.0, Color32::from_rgb(0x6b, 0x34, 0xc4)))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::same(10))
        .shadow(egui::epaint::Shadow {
            offset: [0, 8],
            blur: 24,
            spread: 0,
            color: Color32::from_black_alpha(160),
        })
}

/// Recuadro «Claude quiere usar…» con los tres botones. Devuelve lo que se pulse.
fn tarjeta_permiso(ui: &mut egui::Ui, p: &Permiso, en_panel: bool) -> Option<Respuesta> {
    let mut r = None;
    tarjeta(ui).show(ui, |ui| {
        ui.horizontal(|ui| {
            chispa(ui);
            ui.label(RichText::new(format!("Claude quiere usar {}", p.herramienta)).color(MORADO2));
        });
        ui.add_space(4.0);
        Frame::NONE
            .fill(Color32::from_rgb(0x0b, 0x09, 0x12))
            .stroke(Stroke::new(1.0, BORDE))
            .corner_radius(CornerRadius::same(5))
            .inner_margin(Margin::symmetric(8, 6))
            .show(ui, |ui| {
                ui.add(
                    egui::Label::new(
                        RichText::new(corto(&p.resumen, 400))
                            .color(TEXTO)
                            .font(FontId::monospace(12.0)),
                    )
                    .wrap(),
                );
            });
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            let permitir = egui::Button::new(RichText::new("✓ Permitir").color(VERDE))
                .fill(Color32::from_rgb(0x10, 0x24, 0x0a))
                .stroke(Stroke::new(1.0, Color32::from_rgb(0x2f, 0x7a, 0x1a)));
            if ui.add(permitir).clicked() {
                r = Some(Respuesta::Permitir);
            }
            if ui.button("Denegar").clicked() {
                r = Some(Respuesta::Denegar);
            }
            let hay_sugerencia = p.sugerencias.as_array().is_some_and(|a| !a.is_empty());
            if hay_sugerencia && ui.button("Siempre").clicked() {
                r = Some(Respuesta::Siempre);
            }
            if !en_panel {
                ui.label(
                    RichText::new("Ctrl+Mayús+C para ver el panel")
                        .color(TENUE)
                        .small(),
                );
            }
        });
    });
    r
}

/// Estrella de cuatro puntas dibujada (las fuentes de egui no traen ✦).
fn chispa(ui: &mut egui::Ui) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(12.0, 12.0), egui::Sense::hover());
    let c = rect.center();
    let (r, k) = (6.0, 1.6);
    let puntos = vec![
        c + egui::vec2(0.0, -r),
        c + egui::vec2(k, -k),
        c + egui::vec2(r, 0.0),
        c + egui::vec2(k, k),
        c + egui::vec2(0.0, r),
        c + egui::vec2(-k, k),
        c + egui::vec2(-r, 0.0),
        c + egui::vec2(-k, -k),
    ];
    ui.painter()
        .add(egui::Shape::convex_polygon(puntos, MORADO2, Stroke::NONE));
}

fn corto(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}
