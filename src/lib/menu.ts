// Menú de clic derecho de Kyu (en vez del de Edge). Cada zona arma el suyo y lo abre
// aquí; el componente MenuContextual lo pinta en el punto del clic.
import type { LucideIcon } from "lucide-react";
import { create } from "zustand";

export type Elemento =
  | {
      tipo: "opcion";
      icono: LucideIcon;
      texto: string;
      atajo?: string;
      /** «claude» en su color; «peligro» en rojo (borrar, cerrar…). */
      estilo?: "claude" | "peligro";
      desactivada?: boolean;
      hacer: () => void;
    }
  | { tipo: "separador" }
  | { tipo: "cabecera"; texto: string };

/** Botón grande de la fila de arriba (menú de la terminal). */
export interface Rapida {
  icono: LucideIcon;
  texto: string;
  desactivada?: boolean;
  hacer: () => void;
}

/** Línea que dice sobre qué se ha pulsado: «› pnpm build ✓ 12 s». */
export interface Contexto {
  icono: LucideIcon;
  texto: string;
  detalle?: string;
  color?: "ok" | "mal";
}

export interface Menu {
  x: number;
  y: number;
  rapidas?: Rapida[];
  contexto?: Contexto;
  elementos: Elemento[];
  /** Elemento que tenía el foco: se le devuelve al cerrar (cajas de texto). */
  foco?: HTMLElement | null;
}

interface Tienda {
  menu: Menu | null;
  abrir: (m: Menu) => void;
  cerrar: () => void;
}

export const useMenu = create<Tienda>((set) => ({
  menu: null,
  abrir: (menu) => set({ menu }),
  cerrar: () => set({ menu: null }),
}));

export const opcion = (
  icono: LucideIcon,
  texto: string,
  hacer: () => void,
  extra: { atajo?: string; estilo?: "claude" | "peligro"; desactivada?: boolean } = {},
): Elemento => ({ tipo: "opcion", icono, texto, hacer, ...extra });

export const separador: Elemento = { tipo: "separador" };
export const cabecera = (texto: string): Elemento => ({ tipo: "cabecera", texto });

/** Quita separadores al principio, al final y repetidos (las listas se arman por trozos). */
export function limpiarSeparadores(lista: Elemento[]): Elemento[] {
  const out: Elemento[] = [];
  for (const e of lista) {
    if (e.tipo === "separador" && (!out.length || out[out.length - 1].tipo === "separador")) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1].tipo === "separador") out.pop();
  return out;
}
