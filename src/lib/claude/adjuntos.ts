// Lo que se adjunta al próximo mensaje: orden del terminal, selección e imágenes.
import { type TextoBloque } from "../bloques";
import { type ImagenAdjunta } from "../imagenes";
import { type Seleccion, useClaude } from "./estado";
import { irAClaude } from "./sitios";

/** Adjunta una orden del terminal a lo próximo que se le escriba a Claude. */
export function adjuntar(espacio: string, bloque: TextoBloque) {
  // Se llama con el espacio (desde un bloque del terminal): va a la última conversación usada
  // (o a una nueva a la derecha), que se pone delante con el cursor en la caja.
  const cid = irAClaude(espacio);
  if (cid) useClaude.setState((s) => ({ adjuntos: { ...s.adjuntos, [cid]: bloque } }));
}

/** Adjunta texto seleccionado a lo próximo que se escriba en la última conversación usada. */
export function adjuntarSeleccion(espacio: string, s: Seleccion) {
  const cid = irAClaude(espacio);
  if (cid) useClaude.setState((x) => ({ selecciones: { ...x.selecciones, [cid]: s } }));
}

export function quitarSeleccion(cid: string) {
  useClaude.setState((x) => {
    const { [cid]: _, ...resto } = x.selecciones;
    return { selecciones: resto };
  });
}

/** «src/main.rs:10-24», «Terminal · 12 líneas». */
export function nombreSeleccion(s: Seleccion) {
  if (!s.ruta) return `Terminal · ${s.lineas} ${s.lineas === 1 ? "línea" : "líneas"}`;
  const nombre = s.ruta.split(/[\\/]/).pop() ?? s.ruta;
  return s.desde === s.hasta ? `${nombre}:${s.desde}` : `${nombre}:${s.desde}-${s.hasta}`;
}

export const PREGUNTA_SELECCION = "Explícame esto.";

/** El mensaje con la selección debajo, en un bloque de código. */
export function conSeleccion(texto: string, s: Seleccion) {
  const valla = "`".repeat(Math.max(3, ...[...s.texto.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const lenguaje = s.ruta ? (s.ruta.match(/\.([a-z0-9]+)$/i)?.[1] ?? "") : "";
  const de = s.ruta
    ? `Selección de ${s.ruta}, ${s.desde === s.hasta ? `línea ${s.desde}` : `líneas ${s.desde}-${s.hasta}`}`
    : "Selección del terminal";
  const aviso = s.recortada ? ` (recortada: eran ${s.lineas} líneas)` : "";
  return `${texto || PREGUNTA_SELECCION}

${de}${aviso}:
${valla}${lenguaje}
${s.texto}
${valla}`;
}

export function quitarAdjunto(espacio: string) {
  useClaude.setState((s) => {
    const { [espacio]: _, ...resto } = s.adjuntos;
    return { adjuntos: resto };
  });
}

export const PREGUNTA_POR_DEFECTO = "Mira esta orden y su salida. Si ha fallado, dime por qué y cómo arreglarlo.";

/** El mensaje que recibe Claude: lo escrito y, debajo, la orden con su salida. */
export function conAdjunto(texto: string, a: TextoBloque) {
  const valla = "`".repeat(Math.max(3, ...[...a.salida.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const datos = [a.ruta && `carpeta ${a.ruta}`, `código de salida ${a.codigo}`].filter(Boolean).join(", ");
  const aviso = a.recortada ? ` (solo el final: eran ${a.lineas} líneas)` : "";
  return `${texto || PREGUNTA_POR_DEFECTO}

Orden ejecutada en el terminal (${datos}):
${valla}
> ${a.orden}
${valla}
Salida${aviso}:
${valla}
${a.salida || "(sin salida)"}
${valla}`;
}

export function añadirImagenes(espacio: string, nuevas: ImagenAdjunta[]) {
  if (!nuevas.length) return;
  useClaude.setState((s) => ({ imagenes: { ...s.imagenes, [espacio]: [...(s.imagenes[espacio] ?? []), ...nuevas].slice(0, 8) } }));
}

export function quitarImagen(espacio: string, id: number) {
  useClaude.setState((s) => ({ imagenes: { ...s.imagenes, [espacio]: (s.imagenes[espacio] ?? []).filter((i) => i.id !== id) } }));
}
