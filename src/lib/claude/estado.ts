// Conversaciones de Claude: tipos, el almacén y las ayudas que usa todo lo demás.
import { create } from "zustand";
import { type OpcionAgente, type Tarea } from "../nucleo";
import { type TextoBloque } from "../bloques";
import { type ImagenAdjunta } from "../imagenes";
import { catalogoGuardado, prefsGuardadas, type Catalogo, type Comando, type Preferencias, type UsoContexto } from "../claudeOpciones";

export type Entrada =
  | {
      id: number;
      tipo: "tu";
      texto: string;
      adjunto?: TextoBloque;
      seleccion?: Seleccion;
      imagenes?: string[];
      /** Uuid del mensaje en Claude Code (punto de control) y la pieza anterior de la cadena
       *  (por donde se corta al volver aquí; null = era el primero). */
      uuid?: string | null;
      previo?: string | null;
      /** Enviado y esperando su eco con el uuid. */
      esperaEco?: boolean;
    }
  | { id: number; tipo: "claude"; texto: string; enCurso: boolean }
  /** Resumen de lo que pensó Claude antes de contestar. */
  | { id: number; tipo: "razonamiento"; texto: string; enCurso: boolean }
  | {
      id: number;
      tipo: "herramienta";
      idHerramienta: string;
      nombre: string;
      resumen: string;
      estado: "ejecutando" | "ok" | "error";
      /** Archivo que cambia (Write, Edit, MultiEdit): para «Ver cambios». */
      ruta?: string;
      /** Subagente (Task): cuántas herramientas lleva y la última. */
      pasos?: number;
      /** Lanzada en segundo plano: desde cuándo y, al acabar, cómo y dónde está su salida. */
      fondo?: { id: string; desde: number; estado?: string; salida?: string | null };
      ultimoPaso?: { nombre: string; resumen: string };
    }
  | {
      id: number;
      tipo: "permiso";
      idPeticion: string;
      herramienta: string;
      resumen: string;
      input: unknown;
      respuesta: Respuesta | null;
      /** Lo que se le dijo a Claude al denegar. */
      mensaje?: string;
      /** Lo elegido en un AskUserQuestion (pregunta → respuesta). */
      respuestas?: Record<string, string>;
    }
  | { id: number; tipo: "error"; texto: string }
  /** Al acabar un turno en el que Claude tocó archivos: cuáles y cuánto. */
  | { id: number; tipo: "cambios"; archivos: ArchivoCambiado[] }
  /** Línea tenue: «Conversación compactada», «Unknown command: /x»… */
  | { id: number; tipo: "aviso"; texto: string };

/** Texto seleccionado en un terminal (`ruta` null) o en un archivo, para preguntar sobre él (Alt+K). */
export interface Seleccion {
  texto: string;
  ruta: string | null;
  /** Líneas del archivo (1 = la primera); 0 en el terminal. */
  desde: number;
  hasta: number;
  /** Líneas que tenía (aunque se recorte). */
  lineas: number;
  recortada: boolean;
}

export type Respuesta = "permitir" | "siempre" | "denegar";

export interface ArchivoCambiado {
  ruta: string;
  /** Cómo estaba antes del turno (null = lo creó Claude). */
  antes: string | null;
  puestas: number;
  quitadas: number;
  /** Ya no está en disco (lo borró algo después). */
  borrado?: boolean;
}

type SinId<T> = T extends unknown ? Omit<T, "id"> : never;

/** parado = sin proceso todavía; cerrado = el proceso terminó. */
export type EstadoConv = "parado" | "arrancando" | "pensando" | "listo" | "cerrado";

export interface Conversacion {
  /** Otro agente por ACP en vez de Claude («antigravity»); null = Claude. */
  agente: string | null;
  /** Agente ACP: sus opciones tal como las tiene ahora (null = aún no ha arrancado). */
  opcionesAgente: OpcionAgente[] | null;
  /** Agente ACP: lo elegido en los menús (id de la opción → valor); se pone al arrancar. */
  ajustesAgente: Record<string, string>;
  /** Agente ACP: sus comandos con barra (null = los guardados de la última vez). */
  comandosAgente: Comando[] | null;
  /** Tamaño de la ventana de contexto si lo dice el agente (ACP). */
  ventana: number | null;
  /** Reanudando una conversación de ACP: el agente la está repitiendo. */
  cargando: boolean;
  /** Lista de tareas del agente (la última que escribió). */
  tareas: Tarea[];
  /** Título que le dio el agente o Claude Code (si no, el primer mensaje). */
  titulo: string | null;
  /** Plan o cuota de la cuenta del agente ACP. */
  planAgente: { nombre: string; enlace: string | null } | null;
  /** Lo que corre ahora en segundo plano, con desde cuándo. */
  fondo: { id: string; tipo: string; descripcion: string; desde: number }[];
  claudeId: number | null;
  /** Cambia con cada proceso: los eventos de uno ya cerrado se ignoran. */
  generacion: number;
  /** Carpeta donde arrancó Claude (o la de la conversación que se va a reanudar). */
  carpeta: string | null;
  /** Id de la sesión de Claude Code (del init). */
  sesion: string | null;
  /** Conversación guardada que se sigue al escribir (`--resume`). */
  reanudar: string | null;
  /** Con `reanudar`: seguirla solo hasta esta pieza (al volver a un punto). */
  reanudarEn: string | null;
  /** Última pieza de la cadena (respuesta o resultado): lo anterior al próximo mensaje. */
  ultimoUuid: string | null;
  /** Archivos que Claude está tocando en este turno → cómo estaban antes (null = no existían). */
  tocados: Record<string, string | null>;
  /** Lo mismo para todo lo que ha tocado en la conversación (lo de antes de su último turno). */
  antesDe: Record<string, string | null>;
  entradas: Entrada[];
  estado: EstadoConv;
  /** Cuándo empezó el turno en curso (para el contador). */
  desde: number;
  /** Modelo real que contesta (id completo, del init). */
  modelo: string;
  /** Lo elegido en el panel: alias del modelo, modo de permisos y esfuerzo. */
  eleccionModelo: string | null;
  modo: string;
  esfuerzo: string | null;
  /** Cuenta de Claude con la que arranca (null = la de siempre). */
  cuenta: string | null;
  /** Lo que Claude Code propone escribir ahora (Tab lo pone en la caja). */
  sugerencia: string | null;
  compactando: boolean;
  /** Desglose del contexto (get_context_usage), tras cada turno. */
  contexto: UsoContexto | null;
  tokens: number;
  coste: number;
  /** Duración del último turno, en ms. */
  duracion: number;
}

/** Aviso flotante de un turno terminado, cuando el panel no lo muestra. */
export interface AvisoFin {
  id: number;
  espacio: string;
  texto: string;
  error: boolean;
  duracion: number;
}

interface EstadoClaude {
  /**
   * Conversaciones por id («espacio~pN»); cada una vive en una pestaña de panel. Las
   * funciones de este módulo reciben ese id (el parámetro se llama `espacio` por historia).
   */
  conversaciones: Record<string, Conversacion>;
  /** La última conversación usada de cada espacio: a ella van Ctrl+Mayús+C, Alt+K y compañía. */
  ultimas: Record<string, string>;
  avisos: AvisoFin[];
  /** Orden del terminal adjunta a lo próximo que se escriba, por espacio. */
  adjuntos: Record<string, TextoBloque>;
  /** Texto seleccionado (Alt+K) para lo próximo que se escriba, por conversación. */
  selecciones: Record<string, Seleccion>;
  /** Imágenes pegadas o soltadas para lo próximo que se escriba, por espacio. */
  imagenes: Record<string, ImagenAdjunta[]>;
  /** Comandos y modelos de Claude Code (del último initialize). */
  catalogo: Catalogo | null;
  /** Lo elegido la última vez: lo hereda cada conversación nueva. */
  prefs: Preferencias;
  /** Conversación con el desglose del contexto abierto (null = ninguna). */
  verContexto: string | null;
  /** Texto que vuelve a la caja al volver a un punto, por espacio. */
  borradores: Record<string, string>;
  /** Mensajes escritos mientras Claude trabajaba, por conversación: salen al acabar el turno. */
  colas: Record<string, EnCola[]>;
  /** Cuentas de Claude de kyu.toml (vacío = solo la de siempre, sin selector). */
  cuentas: string[];
  /** Cuentas de Antigravity de kyu.toml (vacío = solo la de siempre, sin selector). */
  cuentasAntigravity: string[];
  /** Sugerencias de respuesta activas (kyu.toml). */
  sugerencias: boolean;
  quitarAviso: (id: number) => void;
}

/** Un mensaje en cola, con lo que llevaba adjunto al escribirlo. */
export interface EnCola {
  id: number;
  texto: string;
  adjunto?: TextoBloque;
  seleccion?: Seleccion;
  imagenes: ImagenAdjunta[];
}

/** Agentes por ACP que se pueden elegir en el panel (id → nombre). */
export const AGENTES: Record<string, string> = { antigravity: "Antigravity" };

/** Quién contesta en la conversación: «Claude» o el nombre del agente. */
export const nombreAgente = (c: Pick<Conversacion, "agente"> | undefined) =>
  c?.agente ? (AGENTES[c.agente] ?? c.agente) : "Claude";

export const vacia = (prefs: Preferencias = useClaude.getState().prefs): Conversacion => ({
  agente: null,
  opcionesAgente: null,
  ajustesAgente: {},
  comandosAgente: null,
  ventana: null,
  cargando: false,
  tareas: [],
  fondo: [],
  titulo: null,
  planAgente: null,
  claudeId: null,
  generacion: 0,
  carpeta: null,
  sesion: null,
  reanudar: null,
  reanudarEn: null,
  ultimoUuid: null,
  tocados: {},
  antesDe: {},
  entradas: [],
  estado: "parado",
  desde: 0,
  modelo: "",
  eleccionModelo: prefs.modelo,
  modo: prefs.modo,
  esfuerzo: prefs.esfuerzo,
  cuenta: prefs.cuenta,
  sugerencia: null,
  compactando: false,
  contexto: null,
  tokens: 0,
  coste: 0,
  duracion: 0,
});

export const useClaude = create<EstadoClaude>((set) => ({
  conversaciones: {},
  ultimas: {},
  avisos: [],
  adjuntos: {},
  selecciones: {},
  imagenes: {},
  catalogo: catalogoGuardado(),
  prefs: prefsGuardadas(),
  verContexto: null,
  borradores: {},
  colas: {},
  cuentas: [],
  cuentasAntigravity: [],
  sugerencias: true,
  quitarAviso: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),
}));

/** Espacio de una conversación («e3~2» → «e3»). */
export const espacioDe = (cid: string) => cid.split("~")[0];

/** Tipo de arrastre con una ruta (desde Archivos o una pestaña de archivo): en Claude, @ruta. */
export const ARRASTRE_RUTA = "text/kyu-ruta";

/** Título de una conversación para su pestaña: su primer mensaje. */
export function tituloDe(c: Conversacion | undefined): string {
  if (c?.titulo) return c.titulo.length > 32 ? c.titulo.slice(0, 32).trimEnd() + "…" : c.titulo;
  const primero = c?.entradas.find((e) => e.tipo === "tu");
  const t = primero?.tipo === "tu" ? primero.texto.replace(/\s+/g, " ").trim() : "";
  return t ? (t.length > 32 ? t.slice(0, 32).trimEnd() + "…" : t) : "Nueva";
}

/** El primer permiso sin contestar de la conversación. */
export const pendiente = (c: Conversacion | undefined) =>
  c?.entradas.find((e): e is Extract<Entrada, { tipo: "permiso" }> => e.tipo === "permiso" && !e.respuesta);

export const conversacion = (espacio: string) => useClaude.getState().conversaciones[espacio] ?? vacia();

let contador = 0;

export const siguienteId = () => ++contador;

export function cambiar(espacio: string, f: (c: Conversacion) => Partial<Conversacion>) {
  useClaude.setState((s) => {
    const c = s.conversaciones[espacio] ?? vacia();
    return { conversaciones: { ...s.conversaciones, [espacio]: { ...c, ...f(c) } } };
  });
}

/** El razonamiento en curso se da por terminado cuando llega otra cosa. */
export const cerrarRazonamiento = (entradas: Entrada[]) =>
  entradas.map((e) => (e.tipo === "razonamiento" && e.enCurso ? { ...e, enCurso: false } : e));

export const añadir = (espacio: string, e: SinId<Entrada>) =>
  cambiar(espacio, (c) => ({ entradas: [...cerrarRazonamiento(c.entradas), { ...e, id: siguienteId() } as Entrada] }));

/** Tamaño de la ventana de contexto: el que dijo Claude o, si aún no, según el modelo. */
export const limiteContexto = (c: Conversacion) =>
  c.ventana || c.contexto?.maxTokens || (/\[1m\]/i.test(c.modelo + (c.eleccionModelo ?? "")) ? 1_000_000 : 200_000);

export const miles = (n: number) => n.toLocaleString("es-ES");

export const corto = (t: string) => (t.length > 40 ? t.slice(0, 40).trimEnd() + "…" : t);
