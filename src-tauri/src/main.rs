// Sin consola detrás de la ventana en las versiones de release de Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kyu_lib::run()
}
