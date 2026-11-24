#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tema;
mod terminal;
mod vista;

use tema::Config;
use terminal::Terminal;

struct Kyu {
    config: Config,
    terminal: Terminal,
}

impl Kyu {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let config = Config::cargar();
        if let Some(bytes) = config.fuente_bytes() {
            let mut fuentes = egui::FontDefinitions::default();
            fuentes.font_data.insert("kyu".into(), egui::FontData::from_owned(bytes).into());
            // Primera en monoespaciada; las de egui quedan detrás para lo que no tenga.
            if let Some(mono) = fuentes.families.get_mut(&egui::FontFamily::Monospace) {
                mono.insert(0, "kyu".into());
            }
            cc.egui_ctx.set_fonts(fuentes);
        }
        let terminal = Terminal::nueva(cc.egui_ctx.clone(), &config.shell_elegida())
            .expect("no se pudo arrancar la shell");
        Self { config, terminal }
    }
}

impl eframe::App for Kyu {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.terminal.atender_eventos();
        if self.terminal.cerrada() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        if let Some(titulo) = self.terminal.titulo_nuevo() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(format!("{titulo} · Kyu")));
        }

        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(self.config.tema.fondo()).inner_margin(8.0))
            .show(ui, |ui| {
                vista::dibujar(ui, &mut self.terminal, &self.config.tema);
            });
    }
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
    eframe::run_native("Kyu Terminal", opciones, Box::new(|cc| Ok(Box::new(Kyu::new(cc)))))
}
