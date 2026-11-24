// Acciones que tocan a la vez el estado y los registros (terminales, editores).
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { focoActual, useKyu } from "./estado";
import { destruir } from "./terminales";
import { destruirEditor } from "./editores";
import { guardarSesion } from "./restaurar";

/** Cierra una pestaña. Si es un archivo con cambios sin guardar, pregunta antes. */
export async function cerrarItem(item: string, preguntar = true) {
  const it = useKyu.getState().items[item];
  if (!it) return;
  if (it.tipo === "archivo" && it.sucio && preguntar) {
    const nombre = it.ruta.split(/[\\/]/).pop();
    const seguro = await ask(`${nombre} tiene cambios sin guardar. ¿Cerrarlo y perderlos?`, {
      title: "Kyu",
      kind: "warning",
      okLabel: "Cerrar sin guardar",
      cancelLabel: "Cancelar",
    });
    if (!seguro) return;
  }
  if (it.tipo === "terminal") destruir(item);
  else destruirEditor(item);
  useKyu.getState().quitarItem(item);
  // Sin espacios no queda nada que mostrar: se cierra la ventana, como cualquier terminal.
  // Sin nada abierto, la próxima vez se empieza de cero.
  if (useKyu.getState().espacios.length === 0) (guardarSesion(), void getCurrentWindow().close());
}

/** Cierra la pestaña activa del panel con el foco. */
export function cerrarActual() {
  const f = focoActual();
  if (f?.panel?.activo) void cerrarItem(f.panel.activo);
}

/** Pasa el foco al panel que está en esa dirección (según su posición en pantalla). */
export function moverFoco(dir: "izquierda" | "derecha" | "arriba" | "abajo") {
  const f = focoActual();
  if (!f?.panel) return;
  const actual = document.querySelector<HTMLElement>(`[data-panel="${f.panel.id}"]`);
  if (!actual) return;
  const a = actual.getBoundingClientRect();
  const cx = a.left + a.width / 2;
  const cy = a.top + a.height / 2;
  let mejor: { id: string; d: number } | null = null;
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => {
    if (el === actual) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const ok =
      (dir === "izquierda" && r.right <= a.left + 2) ||
      (dir === "derecha" && r.left >= a.right - 2) ||
      (dir === "arriba" && r.bottom <= a.top + 2) ||
      (dir === "abajo" && r.top >= a.bottom - 2);
    if (!ok) return;
    const d = Math.hypot(x - cx, y - cy);
    if (!mejor || d < mejor.d) mejor = { id: el.dataset.panel!, d };
  });
  if (mejor) useKyu.getState().enfocar((mejor as { id: string }).id);
}
