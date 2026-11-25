// Alt+K: lo seleccionado en el terminal o en el editor con el foco va a la caja de Claude como
// un recuadro (como en la extensión de VS Code), para preguntar sobre ello.
import { focoActual, useKyu } from "./estado";
import { sesion } from "./terminales";
import { editor } from "./editores";
import { adjuntarSeleccion, ID_ENTRADA, type Seleccion } from "./claude";

const MAX_CARACTERES = 40_000;

/** Lo seleccionado en el panel con el foco (null si no hay nada). */
export function seleccionActual(): Seleccion | null {
  const item = focoActual()?.item;
  if (item?.tipo === "terminal") {
    const s = sesion(item.id);
    const texto = s?.term.getSelection().replace(/\s+$/g, "") ?? "";
    if (!texto.trim()) return null;
    return recortar({ texto, ruta: null, desde: 0, hasta: 0 });
  }
  if (item?.tipo === "archivo") {
    const v = editor(item.id)?.vista;
    if (!v) return null;
    const r = v.state.selection.main;
    if (r.empty) return null;
    const texto = v.state.sliceDoc(r.from, r.to);
    if (!texto.trim()) return null;
    return recortar({
      texto,
      ruta: item.ruta,
      desde: v.state.doc.lineAt(r.from).number,
      hasta: v.state.doc.lineAt(r.to).number,
    });
  }
  return null;
}

function recortar(s: Omit<Seleccion, "lineas" | "recortada">): Seleccion {
  const lineas = s.texto.split("\n").length;
  const recortada = s.texto.length > MAX_CARACTERES;
  return { ...s, texto: recortada ? s.texto.slice(0, MAX_CARACTERES) : s.texto, lineas, recortada };
}

/** La selección a la caja de Claude del espacio activo y el foco a la caja. false si no había. */
export function preguntarPorSeleccion(): boolean {
  const sel = seleccionActual();
  if (!sel) return false;
  adjuntarSeleccion(useKyu.getState().activo, sel);
  requestAnimationFrame(() => (document.getElementById(ID_ENTRADA) as HTMLTextAreaElement | null)?.focus());
  return true;
}
