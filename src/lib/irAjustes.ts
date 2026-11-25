// Abrir Ajustes en una sección concreta sin cargar antes la pantalla (va en diferido).
import { useKyu } from "./estado";

export type Seccion = "general" | "perfiles" | "aspecto" | "claude" | "atajos" | "avisos";

let siguiente: Seccion | null = null;

export function abrirAjustesEn(seccion: Seccion) {
  siguiente = seccion;
  useKyu.getState().ponerAjustes(true);
}

/** La sección pedida (una sola vez), o null. */
export function tomarSeccion(): Seccion | null {
  const s = siguiente;
  siguiente = null;
  return s;
}
