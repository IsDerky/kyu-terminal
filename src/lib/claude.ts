// Panel de Claude: una conversación por espacio de trabajo, cada una con su proceso de
// Claude Code (src-tauri/src/claude.rs). El proceso se arranca con el primer mensaje, en la
// carpeta del terminal con el foco.
import { create } from "zustand";
import {
  abrirClaude,
  cerrarClaude,
  enviarClaude,
  pararClaude,
  responderClaude,
  type EventoClaude,
} from "./nucleo";
import { paneles, useKyu } from "./estado";

export type Entrada =
  | { id: number; tipo: "tu"; texto: string }
  | { id: number; tipo: "claude"; texto: string; enCurso: boolean }
  | { id: number; tipo: "herramienta"; idHerramienta: string; nombre: string; resumen: string; estado: "ejecutando" | "ok" | "error" }
  | { id: number; tipo: "permiso"; idPeticion: string; herramienta: string; resumen: string; input: unknown; respuesta: Respuesta | null }
  | { id: number; tipo: "error"; texto: string };

export type Respuesta = "permitir" | "siempre" | "denegar";

type SinId<T> = T extends unknown ? Omit<T, "id"> : never;

/** parado = sin proceso todavía; cerrado = el proceso terminó. */
export type EstadoConv = "parado" | "arrancando" | "pensando" | "listo" | "cerrado";

export interface Conversacion {
  claudeId: number | null;
  /** Cambia con cada proceso: los eventos de uno ya cerrado se ignoran. */
  generacion: number;
  /** Carpeta donde arrancó Claude. */
  carpeta: string | null;
  entradas: Entrada[];
  estado: EstadoConv;
  /** Cuándo empezó el turno en curso (para el contador). */
  desde: number;
  modelo: string;
  tokens: number;
  coste: number;
  /** Duración del último turno, en ms. */
  duracion: number;
}

interface EstadoClaude {
  visible: boolean;
  conversaciones: Record<string, Conversacion>;
  mostrar: (visible: boolean) => void;
}

const vacia = (): Conversacion => ({
  claudeId: null,
  generacion: 0,
  carpeta: null,
  entradas: [],
  estado: "parado",
  desde: 0,
  modelo: "",
  tokens: 0,
  coste: 0,
  duracion: 0,
});

export const useClaude = create<EstadoClaude>((set) => ({
  visible: false,
  conversaciones: {},
  mostrar: (visible) => set({ visible }),
}));

export const conversacion = (espacio: string) => useClaude.getState().conversaciones[espacio] ?? vacia();

let contador = 0;

function cambiar(espacio: string, f: (c: Conversacion) => Partial<Conversacion>) {
  useClaude.setState((s) => {
    const c = s.conversaciones[espacio] ?? vacia();
    return { conversaciones: { ...s.conversaciones, [espacio]: { ...c, ...f(c) } } };
  });
}

const añadir = (espacio: string, e: SinId<Entrada>) =>
  cambiar(espacio, (c) => ({ entradas: [...c.entradas, { ...e, id: ++contador } as Entrada] }));

/** Carpeta del terminal con el foco del espacio o, si el foco está en un archivo, la del primer terminal. */
export function carpetaDelEspacio(espacio: string): string | null {
  const s = useKyu.getState();
  const esp = s.espacios.find((e) => e.id === espacio);
  if (!esp) return null;
  const lista = paneles(esp.raiz);
  const orden = [...lista.filter((p) => p.id === esp.foco), ...lista.filter((p) => p.id !== esp.foco)];
  for (const p of orden) {
    const ids = p.activo ? [p.activo, ...p.items.filter((i) => i !== p.activo)] : p.items;
    for (const id of ids) {
      const it = s.items[id];
      if (it?.tipo === "terminal" && it.carpeta) return it.carpeta;
    }
  }
  return null;
}

/** Tamaño de la ventana de contexto según el modelo. */
export const limiteContexto = (modelo: string) => (/\[1m\]/i.test(modelo) ? 1_000_000 : 200_000);

function alEvento(espacio: string, generacion: number, ev: EventoClaude) {
  if (useClaude.getState().conversaciones[espacio]?.generacion !== generacion) return;
  switch (ev.tipo) {
    case "iniciado":
      cambiar(espacio, () => ({ modelo: ev.modelo }));
      return;
    case "parcial":
      cambiar(espacio, (c) => {
        const ultima = c.entradas.at(-1);
        if (ultima?.tipo === "claude" && ultima.enCurso) {
          return { entradas: [...c.entradas.slice(0, -1), { ...ultima, texto: ultima.texto + ev.texto }] };
        }
        return { entradas: [...c.entradas, { id: ++contador, tipo: "claude", texto: ev.texto, enCurso: true }] };
      });
      return;
    case "texto":
      cambiar(espacio, (c) => {
        const ultima = c.entradas.at(-1);
        if (ultima?.tipo === "claude" && ultima.enCurso) {
          return { entradas: [...c.entradas.slice(0, -1), { ...ultima, texto: ev.texto, enCurso: false }] };
        }
        return { entradas: [...c.entradas, { id: ++contador, tipo: "claude", texto: ev.texto, enCurso: false }] };
      });
      return;
    case "herramienta":
      añadir(espacio, { tipo: "herramienta", idHerramienta: ev.id, nombre: ev.nombre, resumen: ev.resumen, estado: "ejecutando" });
      return;
    case "resultadoHerramienta":
      cambiar(espacio, (c) => ({
        entradas: c.entradas.map((e) =>
          e.tipo === "herramienta" && e.idHerramienta === ev.id ? { ...e, estado: ev.error ? "error" : "ok" } : e,
        ),
      }));
      return;
    case "permiso":
      añadir(espacio, {
        tipo: "permiso",
        idPeticion: ev.idPeticion,
        herramienta: ev.herramienta,
        resumen: ev.resumen,
        input: ev.input,
        respuesta: null,
      });
      return;
    case "contexto":
      cambiar(espacio, () => ({ tokens: ev.tokens }));
      return;
    case "fin":
      cambiar(espacio, (c) => ({
        estado: "listo",
        coste: ev.coste,
        duracion: ev.duracion,
        // Un texto que se quedara a medias (al parar) se da por terminado.
        entradas: c.entradas.map((e) => (e.tipo === "claude" && e.enCurso ? { ...e, enCurso: false } : e)),
      }));
      return;
    case "error":
      añadir(espacio, { tipo: "error", texto: ev.texto });
      return;
    case "cerrado":
      cambiar(espacio, () => ({ estado: "cerrado", claudeId: null }));
      return;
  }
}

export async function enviar(espacio: string, texto: string) {
  let c = conversacion(espacio);
  if (c.estado === "arrancando" || c.estado === "pensando") return;
  añadir(espacio, { tipo: "tu", texto });
  cambiar(espacio, () => ({ estado: "arrancando", desde: Date.now() }));
  try {
    if (c.claudeId === null) {
      const carpeta = carpetaDelEspacio(espacio);
      const generacion = ++contador;
      cambiar(espacio, () => ({ generacion }));
      const id = await abrirClaude(carpeta, (ev) => alEvento(espacio, generacion, ev));
      cambiar(espacio, () => ({ claudeId: id, carpeta }));
      c = conversacion(espacio);
    }
    await enviarClaude(c.claudeId!, texto);
    cambiar(espacio, (c) => (c.estado === "arrancando" ? { estado: "pensando" } : {}));
  } catch (e) {
    añadir(espacio, { tipo: "error", texto: String(e) });
    cambiar(espacio, (c) => ({ estado: c.claudeId === null ? "parado" : "listo" }));
  }
}

export async function responder(espacio: string, entrada: number, respuesta: Respuesta) {
  const c = conversacion(espacio);
  const e = c.entradas.find((x) => x.id === entrada);
  if (c.claudeId === null || e?.tipo !== "permiso" || e.respuesta) return;
  cambiar(espacio, (c) => ({
    entradas: c.entradas.map((x) => (x.id === entrada && x.tipo === "permiso" ? { ...x, respuesta } : x)),
  }));
  try {
    await responderClaude(c.claudeId, e.idPeticion, respuesta);
  } catch (err) {
    añadir(espacio, { tipo: "error", texto: String(err) });
  }
}

export function parar(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId !== null && (c.estado === "pensando" || c.estado === "arrancando")) void pararClaude(c.claudeId);
}

/** Cierra el proceso y empieza de cero (en la carpeta del terminal con el foco, al escribir). */
export function nueva(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId !== null) void cerrarClaude(c.claudeId);
  useClaude.setState((s) => ({ conversaciones: { ...s.conversaciones, [espacio]: vacia() } }));
}

/** Cierra las conversaciones de los espacios que ya no existen. */
export function limpiar(espacios: string[]) {
  for (const id of Object.keys(useClaude.getState().conversaciones)) {
    if (!espacios.includes(id)) {
      const c = conversacion(id);
      if (c.claudeId !== null) void cerrarClaude(c.claudeId);
      useClaude.setState((s) => {
        const { [id]: _, ...resto } = s.conversaciones;
        return { conversaciones: resto };
      });
    }
  }
}
