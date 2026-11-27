// Runbook paso a paso (F1): cuando una respuesta trae pasos con órdenes («Paso 1 · En WSL:»
// + bloque), una barra encima de la caja enseña el que toca, con su terminal. «Preparar» lo
// deja escrito sin Intro; «Hecho» adjunta su salida a la conversación y pasa al siguiente.
import { create } from "zustand";
import { buscarTerminal, destinoDe, esDeShell, usarCodigo, type Destino } from "./comandoClaude";
import { enfocarCaja, espacioDe, useClaude } from "./claude";
import { textoBloque, type TextoBloque } from "./bloques";
import { sesion } from "./terminales";

export interface Paso {
  titulo: string;
  codigo: string;
  destino: Destino;
}

/** Los bloques de shell de un mensaje, cada uno con su terminal y el texto que lo presenta. */
export function pasosDe(texto: string): Paso[] {
  const pasos: Paso[] = [];
  let anterior: Destino = { tipo: "powershell" };
  for (const m of texto.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)) {
    const lenguaje = m[1].toLowerCase();
    const codigo = m[2].replace(/\n+$/, "");
    if (!esDeShell(lenguaje) || !codigo.trim() || m.index === undefined) continue;
    const antes = texto.slice(0, m.index);
    // Sin pista encima, va donde el paso anterior.
    const destino: Destino = destinoDe(lenguaje, antes) ?? anterior;
    anterior = destino;
    const linea = antes.trimEnd().split("\n").filter((l) => l.trim()).pop() ?? "";
    const titulo = linea
      .replace(/[*_`#>]/g, "")
      .replace(/^\s*(?:\d+[.)]|-)\s*/, "")
      .replace(/:\s*$/, "")
      .trim();
    pasos.push({ titulo, codigo, destino });
  }
  return pasos;
}

/** Hay runbook si son dos pasos o más, o uno que se presenta como «Paso N». */
export const esRunbook = (texto: string, pasos: Paso[]) => pasos.length >= 2 || (pasos.length === 1 && /\bpaso\s*\d/i.test(texto));

interface Progreso {
  entrada: number;
  /** Índice del paso que toca (== total: acabado). */
  paso: number;
  /** Pasos cuya salida ya va en el adjunto. */
  conSalida: number;
}

export const useRunbook = create<{ porConv: Record<string, Progreso> }>(() => ({ porConv: {} }));

export function progresoDe(cid: string, entrada: number): Progreso {
  const p = useRunbook.getState().porConv[cid];
  return p?.entrada === entrada ? p : { entrada, paso: 0, conSalida: 0 };
}

const guardar = (cid: string, p: Progreso) => useRunbook.setState((s) => ({ porConv: { ...s.porConv, [cid]: p } }));

export const prepararPaso = (cid: string, entrada: number, paso: Paso) => usarCodigo(cid, entrada, paso.codigo, paso.destino, false);

/** Une la salida de este paso a la de los anteriores, para mandarlas juntas. */
function juntar(a: TextoBloque | undefined, b: TextoBloque): TextoBloque {
  if (!a) return b;
  return {
    orden: `${a.orden}\n${b.orden}`,
    salida: `${a.salida}\n\n$ ${b.orden}\n${b.salida}`,
    lineas: a.lineas + b.lineas,
    recortada: a.recortada || b.recortada,
    codigo: b.codigo || a.codigo,
    ruta: b.ruta ?? a.ruta,
  };
}

/**
 * «Hecho»: la salida del último bloque terminado en la terminal del paso va adjunta a lo
 * próximo que se le escriba; se pasa al siguiente. Devuelve false si no había salida que coger
 * (ssh sin marcas de la shell, o la orden aún corre).
 */
export function pasoHecho(cid: string, entrada: number, paso: Paso, total: number): boolean {
  const p = progresoDe(cid, entrada);
  const item = buscarTerminal(espacioDe(cid), paso.destino);
  const s = item ? sesion(item) : undefined;
  const b = s ? [...s.bloques.lista].reverse().find((x) => x.estado === "ok" || x.estado === "mal") : undefined;
  const t = s && b ? textoBloque(s.term, b) : null;
  if (t) {
    useClaude.setState((x) => ({ adjuntos: { ...x.adjuntos, [cid]: juntar(p.conSalida ? x.adjuntos[cid] : undefined, t) } }));
  }
  const siguiente = { entrada, paso: p.paso + 1, conSalida: p.conSalida + (t ? 1 : 0) };
  guardar(cid, siguiente);
  if (siguiente.paso >= total) enfocarCaja(cid);
  return !!t;
}

/** Saltar un paso sin adjuntar nada. */
export const saltarPaso = (cid: string, entrada: number) => {
  const p = progresoDe(cid, entrada);
  guardar(cid, { ...p, paso: p.paso + 1 });
};
