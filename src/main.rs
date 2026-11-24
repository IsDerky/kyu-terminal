#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude;
mod panel;
mod tema;
mod terminal;
mod vista;

use panel::Panel;
use tema::Config;
use terminal::Terminal;

struct Kyu {
    config: Config,
    terminal: Terminal,
    panel: Panel,
}

impl Kyu {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let config = Config::cargar();
        if let Some(bytes) = config.fuente_bytes() {
            let mut fuentes = egui::FontDefinitions::default();
            fuentes
                .font_data
                .insert("kyu".into(), egui::FontData::from_owned(bytes).into());
            // Primera en monoespaciada; las de egui quedan detrás para lo que no tenga.
            if let Some(mono) = fuentes.families.get_mut(&egui::FontFamily::Monospace) {
                mono.insert(0, "kyu".into());
            }
            cc.egui_ctx.set_fonts(fuentes);
        }
        cc.egui_ctx.set_visuals(visuales());
        let terminal = Terminal::nueva(cc.egui_ctx.clone(), &config.shell_elegida())
            .expect("no se pudo arrancar la shell");
        let panel = Panel::new(config.claude.clone());
        Self {
            config,
            terminal,
            panel,
        }
    }
}

impl eframe::App for Kyu {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.terminal.atender_eventos();
        self.panel.atender_eventos();
        if self.terminal.cerrada() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        if let Some(titulo) = self.terminal.titulo_nuevo() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(format!("{titulo} · Kyu")));
        }
        if ctx.input_mut(|i| {
            i.consume_key(egui::Modifiers::CTRL | egui::Modifiers::SHIFT, egui::Key::C)
        }) {
            self.panel.alternar(&ctx);
        }

        self.panel.barra_estado(ui);
        self.panel.mostrar(ui);
        egui::CentralPanel::default()
            .frame(
                egui::Frame::NONE
                    .fill(self.config.tema.fondo())
                    .inner_margin(8.0),
            )
            .show(ui, |ui| {
                vista::dibujar(ui, &mut self.terminal, &self.config.tema);
            });
        self.panel.avisos(&ctx);
    }
}

/// Colores de egui para lo que no es la rejilla (panel de Claude, botones, código).
fn visuales() -> egui::Visuals {
    use egui::Color32;
    let mut v = egui::Visuals::dark();
    v.code_bg_color = Color32::from_rgb(0x22, 0x1c, 0x35);
    v.extreme_bg_color = Color32::from_rgb(0x0f, 0x0d, 0x18);
    v.hyperlink_color = Color32::from_rgb(0xc4, 0x8b, 0xff);
    v.selection.bg_fill = Color32::from_rgb(0x3a, 0x2f, 0x5c);
    v.override_text_color = Some(Color32::from_rgb(0xd9, 0xd4, 0xea));
    v
}

fn main() -> eframe::Result<()> {
    let opciones = eframe::NativeOptions {
        renderer: eframe::Renderer::Wgpu,
        viewport: egui::ViewportBuilder::default()
            .with_title("Kyu Terminal")
            .with_inner_size([1100.0, 680.0])
            .with_min_inner_size([400.0, 240.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Kyu Terminal",
        opciones,
        Box::new(|cc| Ok(Box::new(Kyu::new(cc)))),
    )
}
