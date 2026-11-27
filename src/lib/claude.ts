// Claude: conversaciones en pestañas de panel («espacio~pN»), cada una con su proceso de
// Claude Code (src-tauri/src/claude.rs). El proceso se arranca con el primer mensaje, en la
// carpeta del terminal con el foco.
import { create } from "zustand";
import {
  abrirClaude,
  guardarArchivo as archivoGuardar,
  cerrarClaude,
  exportarConversacion,
  controlClaude,
  type ConfigVista,
  enviarClaude,
  historialClaude,
  pararClaude,
  opcionAgente,
  responderClaude,
  type EventoClaude,
  type OpcionAgente,
  type Tarea,
} from "./nucleo";
import { ajustesGuardados, catalogoAgente, guardarAjustes, guardarCatalogoAgente, opcionesVistas, opcionPor } from "./agentes";
import { paneles, useKyu } from "./estado";
import { ejecutarParaConversacion } from "./mcp";
import { leerArchivo } from "./nucleo";
import { contar, diffLineas } from "./diff";
import { recargarRuta } from "./editores";
import { refrescarGasto } from "./gasto";
import { apuntarLimite, claveCuenta } from "./limites";
import type { TextoBloque } from "./bloques";
import type { ImagenAdjunta } from "./imagenes";
import {
  catalogoGuardado,
  esfuerzos,
  guardarCatalogo,
  guardarPrefs,
  modeloDe,
  modosDisponibles,
  prefsGuardadas,
  type Catalogo,
  type Comando,
  type Preferencias,
  type UsoContexto,
} from "./claudeOpciones";

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

/**
 * «@ruta» para la caja: relativa a `carpeta` si está dentro (con /, como en `claude`), si no
 * absoluta; entre comillas si lleva espacios; las carpetas acaban en /.
 */
export function mencionDe(ruta: string, carpeta: string | null): string {
  const esCarpeta = /[\\/]$/.test(ruta);
  const limpia = ruta.replace(/[\\/]+$/, "");
  const base = carpeta?.replace(/[\\/]+$/, "");
  let r = limpia;
  if (base && limpia.toLowerCase().startsWith(base.toLowerCase() + "\\")) r = limpia.slice(base.length + 1);
  else if (base && limpia.toLowerCase().startsWith(base.toLowerCase() + "/")) r = limpia.slice(base.length + 1);
  r = r.replace(/\\/g, "/") + (esCarpeta ? "/" : "");
  return `@${/\s/.test(r) ? `"${r}"` : r}`;
}

/** Mete texto en la caja de una conversación, donde esté el cursor (la caja lo escucha). */
export function insertarEnCaja(cid: string, texto: string) {
  document.querySelector(`textarea[data-cid="${cid}"]`)?.dispatchEvent(new CustomEvent("kyu-insertar", { detail: texto }));
}

/** Dónde está la pestaña de una conversación: su espacio, su panel y su pestaña. */
export function sitioDe(cid: string) {
  const k = useKyu.getState();
  for (const esp of k.espacios) {
    for (const p of paneles(esp.raiz)) {
      const item = p.items.find((i) => {
        const it = k.items[i];
        return it?.tipo === "claude" && it.cid === cid;
      });
      if (item) return { espacio: esp.id, panel: p.id, item };
    }
  }
  return null;
}

/** Conversaciones del espacio que tienen pestaña, en el orden de los paneles. */
export function conversacionesDe(espacio: string): string[] {
  const k = useKyu.getState();
  const esp = k.espacios.find((e) => e.id === espacio);
  if (!esp) return [];
  return paneles(esp.raiz).flatMap((p) =>
    p.items.flatMap((i) => {
      const it = k.items[i];
      return it?.tipo === "claude" ? [it.cid] : [];
    }),
  );
}

/** ¿Se está viendo ahora esta conversación (su pestaña es la activa de su panel)? */
export const panelMuestra = (cid: string) => {
  const k = useKyu.getState();
  const sitio = sitioDe(cid);
  if (!sitio || k.activo !== sitio.espacio || k.ajustes || k.uso) return false;
  const esp = k.espacios.find((e) => e.id === sitio.espacio);
  return !!esp && paneles(esp.raiz).some((p) => p.id === sitio.panel && p.activo === sitio.item);
};

/** La última conversación usada del espacio que siga abierta (o la primera que haya). */
export function ultimaDe(espacio: string): string | null {
  const u = useClaude.getState().ultimas[espacio];
  if (u && sitioDe(u)) return u;
  return conversacionesDe(espacio)[0] ?? null;
}

/**
 * Quién recibe lo que se manda a «la última conversación» del espacio (preguntar por un
 * bloque, mencionar, la selección): su agente, o null = Claude (también si no hay ninguna,
 * porque entonces se abre una de Claude).
 */
export function agenteDestino(espacio: string): string | null {
  const u = ultimaDe(espacio);
  return u ? (useClaude.getState().conversaciones[u]?.agente ?? null) : null;
}

/** Lo mismo, para pintarlo (se actualiza al cambiar de conversación). */
export const useAgenteDestino = (espacio: string) =>
  useClaude((s) => {
    const u = ultimaDe(espacio);
    return u ? (s.conversaciones[u]?.agente ?? null) : null;
  });

/** Apunta la conversación como la última usada de su espacio. */
export function marcarUltima(cid: string) {
  const espacio = espacioDe(cid);
  if (useClaude.getState().ultimas[espacio] === cid) return;
  useClaude.setState((s) => ({ ultimas: { ...s.ultimas, [espacio]: cid } }));
}

/** Pone el cursor en la caja de la conversación (reintenta mientras el panel se carga). */
export function enfocarCaja(cid: string) {
  let intentos = 0;
  const probar = () => {
    const caja = document.querySelector<HTMLTextAreaElement>(`textarea[data-cid="${cid}"]`);
    if (caja) caja.focus();
    else if (++intentos < 60) requestAnimationFrame(probar);
  };
  requestAnimationFrame(probar);
}

/**
 * Lleva a la conversación del espacio: la última usada, con su pestaña delante y el cursor en
 * la caja. Si no hay ninguna (y `crear`), abre una en un panel a la derecha. Devuelve su id.
 */
export function irAClaude(espacio: string, crear = true): string | null {
  const k = useKyu.getState();
  if (!k.espacios.some((e) => e.id === espacio)) return null;
  if (k.ajustes) k.ponerAjustes(false);
  if (k.uso) k.ponerUso(false);
  if (k.activo !== espacio) k.cambiarEspacio(espacio);
  let cid = ultimaDe(espacio);
  if (cid) {
    const sitio = sitioDe(cid)!;
    useKyu.getState().activar(sitio.panel, sitio.item);
  } else {
    if (!crear) return null;
    cid = conversacionEnPanel(espacio, { alLado: true });
  }
  marcarUltima(cid);
  enfocarCaja(cid);
  return cid;
}

/** Lleva a una conversación concreta (desde los avisos o el centro de actividad). */
export function irAConversacion(cid: string) {
  const sitio = sitioDe(cid);
  if (!sitio) return;
  const k = useKyu.getState();
  if (k.ajustes) k.ponerAjustes(false);
  if (k.uso) k.ponerUso(false);
  if (k.activo !== sitio.espacio) k.cambiarEspacio(sitio.espacio);
  useKyu.getState().activar(sitio.panel, sitio.item);
  marcarUltima(cid);
  enfocarCaja(cid);
}

let siguientePanel = 0;

/** Abre una conversación nueva como pestaña de un panel (con `alLado`, en un panel nuevo a la
 *  derecha que ocupa el 40 %). Devuelve su id. */
export function conversacionEnPanel(espacio: string, opciones: { panel?: string; alLado?: boolean } = {}): string {
  const cid = nuevaDePanel(espacio);
  useKyu.getState().ponerClaude(cid, opciones);
  marcarUltima(cid);
  enfocarCaja(cid);
  return cid;
}

/**
 * Ctrl+Mayús+K: conversación nueva donde ya están las de Claude (el panel con el foco si
 * enseña una, o el de la última usada); si no hay ninguna, en un panel nuevo a la derecha.
 */
export function nuevaConversacion(espacio: string, agente: string | null = null): string {
  const cid = nuevaConversacionClaude(espacio);
  if (agente) ponerAgente(cid, agente);
  return cid;
}

/** Cambia quién contesta en una conversación que aún no ha empezado. */
export function ponerAgente(cid: string, agente: string | null) {
  const c = useClaude.getState().conversaciones[cid];
  if (!c || c.claudeId !== null || c.entradas.length) return;
  cambiar(cid, () => ({ agente, ajustesAgente: agente ? ajustesGuardados(agente) : {}, opcionesAgente: null, comandosAgente: null }));
}

/** Opciones de un agente para los menús: las suyas si está en marcha, si no las guardadas con lo elegido encima. */
export function opcionesDe(c: Conversacion): OpcionAgente[] {
  if (!c.agente) return [];
  return opcionesVistas(c.opcionesAgente ?? catalogoAgente(c.agente).opciones, c.ajustesAgente);
}

/** Comandos con barra de la conversación: los del agente o los de Claude. */
export function comandosDe(c: Conversacion, deClaude: Comando[]): Comando[] {
  if (!c.agente) return deClaude;
  return c.comandosAgente ?? catalogoAgente(c.agente).comandos;
}

/** Cambia una opción del agente (modelo, razonamiento, modo): en vivo si está en marcha, si no al arrancar. */
export async function cambiarOpcionAgente(cid: string, clave: string, valor: string) {
  const c = conversacion(cid);
  if (!c.agente) return;
  const ajustesAgente = { ...c.ajustesAgente, [clave]: valor };
  guardarAjustes(c.agente, ajustesAgente);
  cambiar(cid, (x) => ({
    ajustesAgente,
    opcionesAgente: x.opcionesAgente?.map((o) => (o.id === clave ? { ...o, actual: valor } : o)) ?? null,
  }));
  if (c.claudeId === null) return;
  try {
    // La respuesta llega como opcionesAgente (con lo que de verdad ha quedado).
    await opcionAgente(c.claudeId, clave, valor);
  } catch (e) {
    cambiar(cid, () => ({ opcionesAgente: c.opcionesAgente }));
    añadir(cid, { tipo: "error", texto: `No se pudo cambiar: ${e}` });
  }
}

function nuevaConversacionClaude(espacio: string): string {
  const k = useKyu.getState();
  if (k.activo !== espacio) k.cambiarEspacio(espacio);
  const esp = useKyu.getState().espacios.find((e) => e.id === espacio);
  const foco = esp && paneles(esp.raiz).find((p) => p.id === esp.foco);
  if (foco?.activo && k.items[foco.activo]?.tipo === "claude") return conversacionEnPanel(espacio, { panel: foco.id });
  const ultima = ultimaDe(espacio);
  const sitio = ultima ? sitioDe(ultima) : null;
  return sitio ? conversacionEnPanel(espacio, { panel: sitio.panel }) : conversacionEnPanel(espacio, { alLado: true });
}

/** Crea (vacía) una conversación de pestaña de panel del espacio, sin colocarla. */
export function nuevaDePanel(espacio: string): string {
  let cid: string;
  do cid = `${espacio}~p${++siguientePanel}`;
  while (useClaude.getState().conversaciones[cid]);
  useClaude.setState((s) => ({ conversaciones: { ...s.conversaciones, [cid]: vacia() } }));
  return cid;
}

/** Cierra una conversación (para su Claude y la olvida). */
export function cerrarConversacion(cid: string) {
  const c = useClaude.getState().conversaciones[cid];
  if (c?.claudeId != null) void cerrarClaude(c.claudeId);
  olvidarCola(cid);
  useClaude.setState((s) => {
    const { [cid]: _, ...conversaciones } = s.conversaciones;
    const { [cid]: __, ...selecciones } = s.selecciones;
    const { [cid]: ___, ...adjuntos } = s.adjuntos;
    return { conversaciones, selecciones, adjuntos, verContexto: s.verContexto === cid ? null : s.verContexto };
  });
}

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

function cambiar(espacio: string, f: (c: Conversacion) => Partial<Conversacion>) {
  useClaude.setState((s) => {
    const c = s.conversaciones[espacio] ?? vacia();
    return { conversaciones: { ...s.conversaciones, [espacio]: { ...c, ...f(c) } } };
  });
}

/** El razonamiento en curso se da por terminado cuando llega otra cosa. */
const cerrarRazonamiento = (entradas: Entrada[]) =>
  entradas.map((e) => (e.tipo === "razonamiento" && e.enCurso ? { ...e, enCurso: false } : e));

const añadir = (espacio: string, e: SinId<Entrada>) =>
  cambiar(espacio, (c) => ({ entradas: [...cerrarRazonamiento(c.entradas), { ...e, id: ++contador } as Entrada] }));

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

/** Tamaño de la ventana de contexto: el que dijo Claude o, si aún no, según el modelo. */
export const limiteContexto = (c: Conversacion) =>
  c.ventana || c.contexto?.maxTokens || (/\[1m\]/i.test(c.modelo + (c.eleccionModelo ?? "")) ? 1_000_000 : 200_000);

function alEvento(espacio: string, generacion: number, ev: EventoClaude) {
  if (useClaude.getState().conversaciones[espacio]?.generacion !== generacion) return;
  switch (ev.tipo) {
    case "iniciado":
      // El modo de un agente vive en sus opciones; c.modo es el de Claude.
      cambiar(espacio, (c) => ({ modelo: ev.modelo, modo: c.agente ? c.modo : ev.modo || c.modo, sesion: ev.sesion || c.sesion }));
      return;
    case "opcionesAgente": {
      const agente = conversacion(espacio).agente;
      if (agente) guardarCatalogoAgente(agente, { opciones: ev.opciones });
      cambiar(espacio, () => ({ opcionesAgente: ev.opciones }));
      return;
    }
    case "comandos": {
      const agente = conversacion(espacio).agente;
      if (agente) guardarCatalogoAgente(agente, { comandos: ev.comandos });
      cambiar(espacio, () => ({ comandosAgente: ev.comandos }));
      return;
    }
    case "tareas":
      cambiar(espacio, () => ({ tareas: ev.tareas }));
      return;
    case "tareaNueva":
      cambiar(espacio, (c) => ({ tareas: [...c.tareas, { texto: ev.texto, activo: ev.activo, estado: "pending", herramienta: ev.herramienta }] }));
      return;
    case "tareaId":
      cambiar(espacio, (c) => ({ tareas: c.tareas.map((t) => (t.herramienta === ev.herramienta ? { ...t, id: ev.id } : t)) }));
      return;
    case "tareaCambio":
      cambiar(espacio, (c) => ({
        tareas:
          ev.estado === "deleted"
            ? c.tareas.filter((t) => t.id !== ev.id)
            : c.tareas.map((t) =>
                t.id === ev.id ? { ...t, estado: ev.estado ?? t.estado, texto: ev.texto ?? t.texto, activo: ev.activo ?? t.activo } : t,
              ),
      }));
      return;
    case "segundoPlano":
      cambiar(espacio, (c) => ({
        fondo: ev.tareas.map((t) => ({ ...t, desde: c.fondo.find((x) => x.id === t.id)?.desde ?? Date.now() })),
      }));
      return;
    case "tareaFondo":
    case "tareaFondoFin": {
      if (!ev.herramienta) return;
      const fin = ev.tipo === "tareaFondoFin" ? { estado: ev.estado, salida: ev.salida } : {};
      cambiar(espacio, (c) => ({
        entradas: c.entradas.map((e) =>
          e.tipo === "herramienta" && e.idHerramienta === ev.herramienta
            ? { ...e, fondo: { id: ev.id, desde: e.fondo?.desde ?? Date.now(), ...e.fondo, ...fin } }
            : e,
        ),
      }));
      return;
    }
    case "titulo":
      cambiar(espacio, () => ({ titulo: ev.texto }));
      return;
    case "planAgente":
      cambiar(espacio, () => ({ planAgente: { nombre: ev.nombre, enlace: ev.enlace } }));
      return;
    case "mensajeTuyo":
      añadir(espacio, { tipo: "tu", texto: ev.texto });
      return;
    case "cargada": {
      const c = conversacion(espacio);
      if (!c.cargando) return;
      cambiar(espacio, (x) => ({
        cargando: false,
        estado: "listo",
        entradas: [
          ...cerrarRazonamiento(x.entradas).map((e) => (e.tipo === "claude" && e.enCurso ? { ...e, enCurso: false } : e)),
          { id: ++contador, tipo: "aviso", texto: "Reanudada: sigue donde lo dejaste" },
        ],
      }));
      alAcabarTurno(espacio);
      return;
    }
    case "estado":
      cambiar(espacio, () => ({ compactando: ev.estado === "compacting" }));
      return;
    case "compactado":
      añadir(espacio, {
        tipo: "aviso",
        texto: `Conversación compactada: ${miles(ev.antes)} → ${miles(ev.despues)} tokens`,
      });
      return;
    case "parcial":
    case "parcialRazonamiento": {
      const tipo = ev.tipo === "parcial" ? "claude" : "razonamiento";
      cambiar(espacio, (c) => {
        const ultima = c.entradas.at(-1);
        if (ultima?.tipo === tipo && ultima.enCurso) {
          return { entradas: [...c.entradas.slice(0, -1), { ...ultima, texto: ultima.texto + ev.texto }] };
        }
        return { entradas: [...cerrarRazonamiento(c.entradas), { id: ++contador, tipo, texto: ev.texto, enCurso: true }] };
      });
      return;
    }
    case "texto":
    case "razonamiento": {
      const tipo = ev.tipo === "texto" ? "claude" : "razonamiento";
      cambiar(espacio, (c) => {
        const ultima = c.entradas.at(-1);
        if (ultima?.tipo === tipo && ultima.enCurso) {
          return { entradas: [...c.entradas.slice(0, -1), { ...ultima, texto: ev.texto, enCurso: false }] };
        }
        return { entradas: [...cerrarRazonamiento(c.entradas), { id: ++contador, tipo, texto: ev.texto, enCurso: false }] };
      });
      return;
    }
    case "subherramienta":
      cambiar(espacio, (c) => ({
        entradas: c.entradas.map((e) =>
          e.tipo === "herramienta" && e.idHerramienta === ev.padre
            ? { ...e, pasos: (e.pasos ?? 0) + 1, ultimoPaso: { nombre: ev.nombre, resumen: ev.resumen } }
            : e,
        ),
      }));
      return;
    case "eco":
      // El eco es del último mensaje enviado; los anteriores que no lo tuvieron se quedan sin él.
      cambiar(espacio, (c) => {
        let i = -1;
        c.entradas.forEach((e, k) => e.tipo === "tu" && e.esperaEco && (i = k));
        if (i < 0) return {};
        return {
          entradas: c.entradas.map((e, k) =>
            e.tipo !== "tu" || !e.esperaEco
              ? e
              : k === i
                ? { ...e, esperaEco: false, uuid: ev.uuid, previo: c.ultimoUuid }
                : { ...e, esperaEco: false },
          ),
          ultimoUuid: ev.uuid,
        };
      });
      return;
    case "cadena":
      cambiar(espacio, () => ({ ultimoUuid: ev.uuid }));
      return;
    case "herramienta":
      añadir(espacio, {
        tipo: "herramienta",
        idHerramienta: ev.id,
        nombre: ev.nombre,
        resumen: ev.resumen,
        estado: "ejecutando",
        ruta: ev.ruta ?? undefined,
      });
      // La primera vez que toca un archivo en el turno: cómo estaba.
      if (ev.ruta && (ev.antes !== null || ev.nuevo)) {
        const ruta = ev.ruta;
        cambiar(espacio, (c) => (ruta in c.tocados ? {} : { tocados: { ...c.tocados, [ruta]: ev.antes } }));
      }
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
      cambiar(espacio, (c) => ({ tokens: ev.tokens, ventana: ev.limite ?? c.ventana }));
      return;
    case "limite": {
      const s = useClaude.getState();
      apuntarLimite(claveCuenta(s.conversaciones[espacio]?.cuenta ?? null, s.cuentas), {
        estado: ev.estado,
        sesion: ev.sesion,
        semana: ev.semana,
      });
      return;
    }
    case "sugerencia":
      // Llega después del fin del turno; si ya se ha escrito otro mensaje, no sirve.
      cambiar(espacio, (c) => (c.estado === "listo" ? { sugerencia: ev.texto } : {}));
      return;
    case "fin":
      if (!panelMuestra(espacio)) {
        const c = conversacion(espacio);
        const ultimo = [...c.entradas].reverse().find((e) => e.tipo === "claude");
        const texto = (ultimo?.tipo === "claude" ? ultimo.texto : "").replace(/[#*`_>]/g, "").trim().split("\n")[0] ?? "";
        useClaude.setState((s) => ({
          avisos: [
            ...s.avisos.filter((a) => a.espacio !== espacio),
            { id: ++contador, espacio, texto: texto.slice(0, 140), error: ev.error, duracion: ev.duracion },
          ],
        }));
      }
      if (ev.resultado) {
        añadir(espacio, { tipo: "aviso", texto: ev.resultado.replace(/^Unknown command: /, "Ese comando no existe: ") });
      }
      cambiar(espacio, (c) => ({
        estado: "listo",
        compactando: false,
        coste: ev.coste,
        duracion: ev.duracion,
        // Un texto que se quedara a medias (al parar) se da por terminado.
        entradas: cerrarRazonamiento(c.entradas).map((e) => (e.tipo === "claude" && e.enCurso ? { ...e, enCurso: false } : e)),
      }));
      void refrescarContexto(espacio);
      void ponerTitulo(espacio);
      void resumirCambios(espacio);
      void refrescarGasto();
      alAcabarTurno(espacio);
      return;
    case "error":
      añadir(espacio, { tipo: "error", texto: ev.texto });
      return;
    case "cerrado":
      // Al volver a escribir se sigue la misma conversación (--resume), en la misma carpeta.
      // Con un agente ACP igual (session/load), sin que repita lo que ya se ve.
      // Lo que corría en segundo plano muere con el proceso.
      cambiar(espacio, (c) => ({ estado: "cerrado", claudeId: null, cargando: false, reanudar: c.sesion, fondo: [] }));
      // Cerrado a media respuesta: lo que esperaba en cola vuelve a la caja.
      parados.delete(espacio);
      devolverCola(espacio);
      return;
  }
}

/** Al acabar un turno: recuadro «Archivos cambiados» y los editores abiertos al día. */
async function resumirCambios(espacio: string) {
  const c = conversacion(espacio);
  const tocados = c.tocados;
  if (!Object.keys(tocados).length) return;
  cambiar(espacio, (x) => ({ tocados: {}, antesDe: { ...x.antesDe, ...tocados } }));
  const archivos: ArchivoCambiado[] = [];
  for (const [ruta, antes] of Object.entries(tocados)) {
    const ahora = await leerArchivo(ruta).catch(() => null);
    const { puestas, quitadas } = contar(diffLineas(antes ?? "", ahora ?? ""));
    if (!puestas && !quitadas && ahora !== null) continue;
    archivos.push({ ruta, antes, puestas, quitadas, borrado: ahora === null || undefined });
    recargarRuta(ruta);
  }
  if (archivos.length) añadir(espacio, { tipo: "cambios", archivos });
}

/**
 * Abre el archivo en Kyu con lo que cambió Claude marcado (desde antes de su último turno
 * que lo tocó). Salta al primer cambio.
 */
export async function verCambios(espacio: string, ruta: string) {
  const c = conversacion(espacio);
  const antes = ruta in c.tocados ? c.tocados[ruta] : c.antesDe[ruta];
  if (antes === undefined) return;
  const ahora = await leerArchivo(ruta).catch(() => "");
  const primera = diffLineas(antes ?? "", ahora).find((l) => l.tipo !== "igual");
  const linea = primera ? (primera.despues ?? primera.antes ?? 1) : 1;
  recargarRuta(ruta);
  useKyu.getState().abrirArchivo(ruta, linea, 1, { antes, agente: c.agente });
}

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

const PREGUNTA_SELECCION = "Explícame esto.";

/** El mensaje con la selección debajo, en un bloque de código. */
function conSeleccion(texto: string, s: Seleccion) {
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

const PREGUNTA_POR_DEFECTO = "Mira esta orden y su salida. Si ha fallado, dime por qué y cómo arreglarlo.";

/** El mensaje que recibe Claude: lo escrito y, debajo, la orden con su salida. */
function conAdjunto(texto: string, a: TextoBloque) {
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

const miles = (n: number) => n.toLocaleString("es-ES");

/** Tras el primer turno de Claude: un título corto para la pestaña y el historial (se guarda en la sesión). */
async function ponerTitulo(cid: string) {
  const c = conversacion(cid);
  const primero = c.entradas.find((e) => e.tipo === "tu");
  if (c.claudeId === null || c.agente || c.titulo || primero?.tipo !== "tu" || pidiendoTitulo.has(cid)) return;
  pidiendoTitulo.add(cid);
  try {
    const r = await controlClaude<{ title?: string }>(c.claudeId, {
      subtype: "generate_session_title",
      description: primero.texto.slice(0, 2000),
      persist: true,
    });
    if (r?.title) cambiar(cid, () => ({ titulo: r.title! }));
  } catch {
    // Sin título se queda el primer mensaje.
  } finally {
    pidiendoTitulo.delete(cid);
  }
}
const pidiendoTitulo = new Set<string>();

/** Para algo que Claude dejó en segundo plano (`stop_task`). */
export async function pararFondo(cid: string, tarea: string) {
  const c = conversacion(cid);
  if (c.claudeId === null || c.agente) return;
  try {
    await controlClaude(c.claudeId, { subtype: "stop_task", task_id: tarea });
  } catch (e) {
    añadir(cid, { tipo: "error", texto: `No se pudo parar: ${e}` });
  }
}

/** Estado de un servidor MCP de la conversación (`mcp_status`). */
export interface ServidorMcp {
  name: string;
  status: string;
  error?: string;
  scope?: string;
  serverInfo?: { name?: string; version?: string };
}
export async function servidoresMcp(cid: string): Promise<ServidorMcp[] | null> {
  const c = conversacion(cid);
  if (c.claudeId === null || c.agente) return null;
  const r = await controlClaude<{ mcpServers?: ServidorMcp[] }>(c.claudeId, { subtype: "mcp_status" });
  return r?.mcpServers ?? [];
}

/** Paneles flotantes de la conversación que abren /mcp y /permissions. */
export type Flotante = "mcp" | "permisos" | null;
export const useFlotante = create<{ por: Record<string, Flotante> }>(() => ({ por: {} }));
export const ponerFlotante = (cid: string, f: Flotante) => useFlotante.setState((s) => ({ por: { ...s.por, [cid]: f } }));

/** CLAUDE.md del proyecto de la conversación (su carpeta o la del terminal con el foco). */
function memoriaProyecto(cid: string): string | null {
  const c = conversacion(cid);
  const carpeta = c.carpeta ?? carpetaDelEspacio(espacioDe(cid));
  return carpeta ? `${carpeta.replace(/[\\/]+$/, "")}\\CLAUDE.md` : null;
}

/** «#nota»: la apunta al final del CLAUDE.md del proyecto (como el # de Claude Code). */
async function apuntarMemoria(cid: string, nota: string) {
  const ruta = memoriaProyecto(cid);
  if (!ruta) return añadir(cid, { tipo: "error", texto: "No hay carpeta de proyecto donde apuntarlo" });
  const antes = await leerArchivo(ruta).catch(() => "");
  const salto = antes && !antes.endsWith("\n") ? "\n" : "";
  try {
    await archivoGuardar(ruta, `${antes}${salto}- ${nota}\n`);
    recargarRuta(ruta);
    añadir(cid, { tipo: "aviso", texto: `Apuntado en el CLAUDE.md del proyecto: «${nota}»` });
  } catch (e) {
    añadir(cid, { tipo: "error", texto: `No se pudo apuntar: ${e}` });
  }
}

/** /memory: abre el CLAUDE.md del proyecto (lo crea vacío si no hay). */
export async function abrirMemoria(cid: string) {
  const ruta = memoriaProyecto(cid);
  if (!ruta) return;
  const hay = await leerArchivo(ruta).then(() => true, () => false);
  if (!hay) await archivoGuardar(ruta, "").catch(() => {});
  useKyu.getState().abrirArchivo(ruta, 1, 1);
}

/** La conversación en Markdown: tus mensajes, las respuestas y cada herramienta en una línea. */
function comoMarkdown(c: Conversacion): string {
  const quien = nombreAgente(c);
  const partes = [`# ${c.titulo ?? tituloDe(c)}`, "", [quien, c.modelo, c.carpeta].filter(Boolean).join(" · "), ""];
  for (const e of c.entradas) {
    if (e.tipo === "tu") partes.push("## Tú", "", e.texto, "");
    else if (e.tipo === "claude") partes.push(`## ${quien}`, "", e.texto, "");
    else if (e.tipo === "herramienta") partes.push(`> ${e.nombre} ${e.resumen}`.trimEnd(), "");
    else if (e.tipo === "aviso" || e.tipo === "error") partes.push(`*${e.texto}*`, "");
  }
  return partes.join("\n");
}

/** /export: guarda la conversación como .md en Documentos\\Kyu\\conversaciones y la abre. */
export async function exportar(cid: string) {
  const c = conversacion(cid);
  if (!c.entradas.length) return;
  // Hora local (toISOString va en UTC).
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}-${dos(d.getMinutes())}`;
  try {
    const ruta = await exportarConversacion(`${fecha} ${tituloDe(c).replace(/…$/, "")}`, comoMarkdown(c));
    añadir(cid, { tipo: "aviso", texto: `Exportada en ${ruta}` });
    useKyu.getState().abrirArchivo(ruta, 1, 1);
  } catch (e) {
    añadir(cid, { tipo: "error", texto: `No se pudo exportar: ${e}` });
  }
}

/** Pide a Claude el desglose del contexto y lo guarda en la conversación. */
export async function refrescarContexto(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId === null || c.agente) return;
  try {
    const u = await controlClaude<UsoContexto>(c.claudeId, { subtype: "get_context_usage" });
    cambiar(espacio, (x) => (x.claudeId === c.claudeId ? { contexto: u, tokens: u.totalTokens } : {}));
  } catch {
    // Sin desglose se queda la cifra de tokens del último mensaje.
  }
}

function guardarCatalogoDe(r: Catalogo) {
  if (!r?.models?.length) return;
  guardarCatalogo(r);
  useClaude.setState({ catalogo: catalogoGuardado() });
}

let probado = false;

/** Una vez por sesión de Kyu, arranca Claude un momento solo para pedirle comandos y modelos (no
 *  gasta tokens): el guardado puede ser de una versión anterior de Claude Code. */
export async function cargarCatalogo(carpeta: string | null) {
  if (probado) return;
  probado = true;
  let id: number | null = null;
  try {
    id = await abrirClaude(carpeta, {}, () => {});
    guardarCatalogoDe(await controlClaude<Catalogo>(id, { subtype: "initialize" }));
  } catch {
    // Sin catálogo los menús salen con lo mínimo.
  } finally {
    if (id !== null) void cerrarClaude(id);
  }
}

function recordar(p: Partial<Preferencias>) {
  const prefs = { ...useClaude.getState().prefs, ...p };
  guardarPrefs(prefs);
  useClaude.setState({ prefs });
}

/** Cambia el modo de permisos: en vivo si Claude ya está en marcha, si no al arrancar. */
export async function cambiarModo(espacio: string, modo: string) {
  const c = conversacion(espacio);
  cambiar(espacio, () => ({ modo }));
  recordar({ modo });
  if (c.claudeId === null) return;
  try {
    await controlClaude(c.claudeId, { subtype: "set_permission_mode", mode: modo });
  } catch (e) {
    cambiar(espacio, () => ({ modo: c.modo }));
    añadir(espacio, { tipo: "error", texto: `No se pudo cambiar el modo: ${e}` });
  }
}

/** Mayús+Tab: el siguiente modo. */
export function siguienteModo(espacio: string) {
  const c = conversacion(espacio);
  if (c.agente) {
    const o = opcionPor(opcionesDe(c), "mode");
    if (!o?.valores.length) return;
    const i = o.valores.findIndex((v) => v.valor === o.actual);
    void cambiarOpcionAgente(espacio, o.id, o.valores[(i + 1) % o.valores.length].valor);
    return;
  }
  const lista = modosDisponibles(modeloDe(useClaude.getState().catalogo, c.eleccionModelo));
  const i = lista.findIndex((m) => m.id === c.modo);
  void cambiarModo(espacio, lista[(i + 1) % lista.length].id);
}

export async function cambiarModelo(espacio: string, modelo: string | null) {
  const c = conversacion(espacio);
  // Si el modelo nuevo no admite el esfuerzo elegido, se vuelve al predeterminado.
  const niveles = esfuerzos(modeloDe(useClaude.getState().catalogo, modelo));
  const esfuerzo = c.esfuerzo && niveles.includes(c.esfuerzo) ? c.esfuerzo : null;
  cambiar(espacio, () => ({ eleccionModelo: modelo, esfuerzo }));
  recordar({ modelo, esfuerzo });
  if (c.claudeId === null) return;
  try {
    await controlClaude(c.claudeId, { subtype: "set_model", model: modelo ?? "default" });
    if (esfuerzo !== c.esfuerzo) await controlClaude(c.claudeId, { subtype: "apply_flag_settings", settings: { effortLevel: esfuerzo } });
    añadir(espacio, { tipo: "aviso", texto: "Modelo cambiado: se nota a partir del próximo mensaje" });
  } catch (e) {
    cambiar(espacio, () => ({ eleccionModelo: c.eleccionModelo, esfuerzo: c.esfuerzo }));
    añadir(espacio, { tipo: "error", texto: `No se pudo cambiar el modelo: ${e}` });
  }
}

/** «max» solo vale al arrancar (Claude Code no lo admite en caliente). */
export const esfuerzoEnCaliente = (nivel: string | null) => nivel !== "max";

export async function cambiarEsfuerzo(espacio: string, esfuerzo: string | null) {
  const c = conversacion(espacio);
  if (c.claudeId !== null && !esfuerzoEnCaliente(esfuerzo)) return;
  cambiar(espacio, () => ({ esfuerzo }));
  recordar({ esfuerzo });
  if (c.claudeId === null) return;
  try {
    await controlClaude(c.claudeId, { subtype: "apply_flag_settings", settings: { effortLevel: esfuerzo } });
  } catch (e) {
    cambiar(espacio, () => ({ esfuerzo: c.esfuerzo }));
    añadir(espacio, { tipo: "error", texto: `No se pudo cambiar el esfuerzo: ${e}` });
  }
}

export function añadirImagenes(espacio: string, nuevas: ImagenAdjunta[]) {
  if (!nuevas.length) return;
  useClaude.setState((s) => ({ imagenes: { ...s.imagenes, [espacio]: [...(s.imagenes[espacio] ?? []), ...nuevas].slice(0, 8) } }));
}

export function quitarImagen(espacio: string, id: number) {
  useClaude.setState((s) => ({ imagenes: { ...s.imagenes, [espacio]: (s.imagenes[espacio] ?? []).filter((i) => i.id !== id) } }));
}

/** Carga una conversación guardada en el panel; Claude la sigue (`--resume`) al escribir. */
export async function reanudar(espacio: string, carpeta: string, id: string, titulo: string, cuenta?: string | null) {
  const pasado = await historialClaude(carpeta, id);
  const antes = conversacion(espacio);
  if (antes.claudeId !== null) void cerrarClaude(antes.claudeId);
  let ultimoUuid: string | null = null;
  const entradas: Entrada[] = pasado.flatMap((p): Entrada[] => {
    switch (p.tipo) {
      case "cadena":
        ultimoUuid = p.uuid;
        return [];
      case "tu":
        return [{ id: ++contador, tipo: "tu", texto: p.texto, uuid: p.uuid, previo: p.previo }];
      case "claude":
        return [{ id: ++contador, tipo: "claude", texto: p.texto, enCurso: false }];
      case "herramienta":
        return [
          {
            id: ++contador,
            tipo: "herramienta",
            idHerramienta: p.id,
            nombre: p.nombre,
            resumen: p.resumen,
            estado: p.error ? "error" : "ok",
          },
        ];
      case "aviso":
        return [{ id: ++contador, tipo: "aviso", texto: p.texto }];
    }
  });
  entradas.push({ id: ++contador, tipo: "aviso", texto: `Reanudada «${titulo}»: sigue donde lo dejaste` });
  useClaude.setState((s) => ({
    verContexto: s.verContexto === espacio ? null : s.verContexto,
    conversaciones: {
      ...s.conversaciones,
      [espacio]: {
        ...vacia(),
        eleccionModelo: antes.eleccionModelo,
        modo: antes.modo,
        esfuerzo: antes.esfuerzo,
        cuenta: cuenta !== undefined ? cuentaValida(cuenta) : antes.cuenta,
        carpeta,
        reanudar: id,
        sesion: id,
        titulo: titulo || null,
        ultimoUuid,
        entradas,
      },
    },
  }));
}

/**
 * Vuelve a abrir una conversación con un agente ACP (al restaurar la sesión): el agente la
 * carga (`session/load`) y la repite, así sale en el panel tal como la tiene él.
 */
export async function reanudarAgente(cid: string, agente: string, carpeta: string, sesion: string) {
  const antes = conversacion(cid);
  if (antes.claudeId !== null) void cerrarClaude(antes.claudeId);
  const generacion = ++contador;
  useClaude.setState((s) => ({
    conversaciones: {
      ...s.conversaciones,
      [cid]: {
        ...vacia(),
        agente,
        ajustesAgente: ajustesGuardados(agente),
        carpeta,
        cuenta: antes.agente === agente ? antes.cuenta : null,
        sesion,
        reanudar: sesion,
        cargando: true,
        estado: "arrancando",
        desde: Date.now(),
        generacion,
      },
    },
  }));
  try {
    const id = await abrirClaude(carpeta, { agente, reanudar: sesion, ajustes: ajustesGuardados(agente), cuenta: antes.agente === agente ? antes.cuenta : null }, (ev) =>
      alEvento(cid, generacion, ev),
    );
    if (conversacion(cid).generacion !== generacion) return void cerrarClaude(id);
    cambiar(cid, () => ({ claudeId: id }));
  } catch (e) {
    cambiar(cid, () => ({ cargando: false, estado: "cerrado" }));
    añadir(cid, { tipo: "error", texto: String(e) });
  }
}

/**
 * Manda un mensaje con lo adjunto en ese momento (o, con `deCola`, lo que llevaba al ponerlo
 * en cola). Si Claude está trabajando, se queda en cola y sale al acabar el turno.
 */
export async function enviar(espacio: string, texto: string, deCola?: EnCola) {
  let c = conversacion(espacio);
  marcarUltima(espacio);
  if (c.estado === "arrancando" || c.estado === "pensando") return encolar(espacio, texto);
  // Comandos que resuelve Kyu sin Claude.
  const orden = texto.trim().toLowerCase();
  if (orden === "/clear" || orden === "/new") return nueva(espacio);
  if (orden === "/export") return void exportar(espacio);
  if (!c.agente && (orden === "/mcp" || orden === "/permissions")) return ponerFlotante(espacio, orden === "/mcp" ? "mcp" : "permisos");
  if (!c.agente && orden === "/memory") return void abrirMemoria(espacio);
  // «#nota» la apunta en la memoria del proyecto; «!orden» la ejecuta en el panel «Claude».
  if (!deCola && !c.agente && /^#\s*\S/.test(texto.trim())) return void apuntarMemoria(espacio, texto.trim().replace(/^#\s*/, ""));
  if (!deCola && /^!\s*\S/.test(texto.trim())) {
    const o = texto.trim().replace(/^!\s*/, "");
    añadir(espacio, { tipo: "aviso", texto: `Ejecutando en el panel «Claude»: ${o}` });
    void ejecutarParaConversacion(espacio, o).then((motivo) =>
      añadir(
        espacio,
        motivo
          ? { tipo: "error", texto: `No se pudo ejecutar: ${motivo}` }
          : { tipo: "aviso", texto: "Salida adjunta: escribe tu pregunta o Intro para que la revise" },
      ),
    );
    return;
  }
  if (orden === "/context" && c.claudeId !== null && !c.agente) {
    useClaude.setState({ verContexto: espacio });
    return void refrescarContexto(espacio);
  }
  let adjunto: TextoBloque | undefined;
  let seleccion: Seleccion | undefined;
  let imagenes: ImagenAdjunta[];
  if (deCola) {
    ({ adjunto, seleccion, imagenes } = deCola);
  } else {
    adjunto = useClaude.getState().adjuntos[espacio];
    if (adjunto) quitarAdjunto(espacio);
    imagenes = useClaude.getState().imagenes[espacio] ?? [];
    if (imagenes.length) useClaude.setState((s) => ({ imagenes: { ...s.imagenes, [espacio]: [] } }));
    seleccion = useClaude.getState().selecciones[espacio];
    if (seleccion) quitarSeleccion(espacio);
  }
  let mensaje = adjunto ? conAdjunto(texto, adjunto) : texto;
  if (seleccion) mensaje = conSeleccion(mensaje, seleccion);
  añadir(espacio, {
    tipo: "tu",
    texto: texto || (adjunto ? PREGUNTA_POR_DEFECTO : seleccion ? PREGUNTA_SELECCION : ""),
    adjunto,
    seleccion,
    imagenes: imagenes.length ? imagenes.map((i) => i.url) : undefined,
    esperaEco: true,
  });
  cambiar(espacio, () => ({ estado: "arrancando", desde: Date.now(), sugerencia: null }));
  try {
    if (c.claudeId === null) {
      // Al reanudar, en la carpeta de la conversación guardada; si no, la del terminal con el foco.
      const carpeta = c.reanudar ? c.carpeta : carpetaDelEspacio(espacioDe(espacio));
      const generacion = ++contador;
      cambiar(espacio, () => ({ generacion }));
      const id = await abrirClaude(
        carpeta,
        {
          modelo: c.eleccionModelo,
          modo: c.modo,
          esfuerzo: c.esfuerzo,
          reanudar: c.reanudar,
          reanudarEn: c.reanudarEn,
          cuenta: c.cuenta,
          agente: c.agente,
          ajustes: c.agente ? c.ajustesAgente : undefined,
          // La conversación ya está en el panel: que el agente no la repita.
          callado: !!(c.agente && c.reanudar),
        },
        (ev) => alEvento(espacio, generacion, ev),
      );
      // La copia cortada ya existe: si Claude se cierra, se sigue esa (su id llega en el init).
      cambiar(espacio, () => ({ claudeId: id, carpeta, reanudarEn: null }));
      c = conversacion(espacio);
      // Comandos de este proyecto y modelos: en segundo plano, sin esperar. Con sugerencias no:
      // un `initialize` del anfitrión las apaga (Claude Code 2.1.331). Entonces la lista es la
      // del proceso de prueba de `cargarCatalogo`.
      if (!c.agente && !useClaude.getState().sugerencias) {
        void controlClaude<Catalogo>(id, { subtype: "initialize" })
          .then(guardarCatalogoDe)
          .then(() => refrescarContexto(espacio))
          .catch(() => {});
      }
    }
    await enviarClaude(
      c.claudeId!,
      mensaje,
      imagenes.map((i) => ({ tipo: i.tipo, datos: i.datos })),
    );
    cambiar(espacio, (c) => (c.estado === "arrancando" ? { estado: "pensando" } : {}));
  } catch (e) {
    añadir(espacio, { tipo: "error", texto: String(e) });
    cambiar(espacio, (c) => ({ estado: c.claudeId === null ? "parado" : "listo" }));
  }
}

/** Al denegar, `mensaje` le dice a Claude qué hacer en su lugar. Al permitir, `modo` cambia
 *  también el modo de permisos (aprobar un plan). */
export async function responder(espacio: string, entrada: number, respuesta: Respuesta, mensaje?: string, modo?: string) {
  const c = conversacion(espacio);
  const e = c.entradas.find((x) => x.id === entrada);
  if (c.claudeId === null || e?.tipo !== "permiso" || e.respuesta) return;
  const nota = respuesta === "denegar" ? mensaje?.trim() || undefined : undefined;
  cambiar(espacio, (c) => ({
    entradas: c.entradas.map((x) => (x.id === entrada && x.tipo === "permiso" ? { ...x, respuesta, mensaje: nota } : x)),
  }));
  try {
    await responderClaude(c.claudeId, e.idPeticion, respuesta, nota, respuesta === "permitir" ? modo : undefined);
    if (respuesta === "permitir" && modo) cambiar(espacio, () => ({ modo }));
  } catch (err) {
    añadir(espacio, { tipo: "error", texto: String(err) });
  }
}

/** Preguntas de Claude (AskUserQuestion): se permite la herramienta con lo elegido dentro. */
export async function contestarPreguntas(espacio: string, entrada: number, respuestas: Record<string, string>) {
  const c = conversacion(espacio);
  const e = c.entradas.find((x) => x.id === entrada);
  if (c.claudeId === null || e?.tipo !== "permiso" || e.respuesta) return;
  cambiar(espacio, (c) => ({
    entradas: c.entradas.map((x) => (x.id === entrada && x.tipo === "permiso" ? { ...x, respuesta: "permitir", respuestas } : x)),
  }));
  try {
    await responderClaude(c.claudeId, e.idPeticion, "permitir", undefined, undefined, respuestas);
  } catch (err) {
    añadir(espacio, { tipo: "error", texto: String(err) });
  }
}

export function parar(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId !== null && (c.estado === "pensando" || c.estado === "arrancando")) {
    // Al parar, la cola no sale sola: vuelve a la caja (como en Claude Code).
    parados.add(espacio);
    void pararClaude(c.claudeId);
  }
}

// ---------- Cola ----------

/** Conversaciones paradas a mano: al llegar su fin, la cola vuelve a la caja. */
const parados = new Set<string>();

const colaDe = (espacio: string) => useClaude.getState().colas[espacio] ?? [];

function ponerCola(espacio: string, cola: EnCola[]) {
  useClaude.setState((s) => {
    const { [espacio]: _, ...resto } = s.colas;
    return { colas: cola.length ? { ...resto, [espacio]: cola } : resto };
  });
}

/** Deja el mensaje en cola, con lo que haya adjunto ahora (eso se quita de la caja). */
export function encolar(espacio: string, texto: string) {
  const s = useClaude.getState();
  const item: EnCola = {
    id: ++contador,
    texto,
    adjunto: s.adjuntos[espacio],
    seleccion: s.selecciones[espacio],
    imagenes: s.imagenes[espacio] ?? [],
  };
  if (item.adjunto) quitarAdjunto(espacio);
  if (item.seleccion) quitarSeleccion(espacio);
  if (item.imagenes.length) useClaude.setState((x) => ({ imagenes: { ...x.imagenes, [espacio]: [] } }));
  ponerCola(espacio, [...colaDe(espacio), item]);
}

/** Devuelve lo adjunto de esos mensajes a la caja (la selección y la orden, la última). */
function devolverAdjuntos(espacio: string, items: EnCola[]) {
  useClaude.setState((s) => {
    const adjunto = [...items].reverse().find((i) => i.adjunto)?.adjunto;
    const seleccion = [...items].reverse().find((i) => i.seleccion)?.seleccion;
    const imagenes = [...(s.imagenes[espacio] ?? []), ...items.flatMap((i) => i.imagenes)].slice(0, 8);
    return {
      adjuntos: adjunto ? { ...s.adjuntos, [espacio]: adjunto } : s.adjuntos,
      selecciones: seleccion ? { ...s.selecciones, [espacio]: seleccion } : s.selecciones,
      imagenes: { ...s.imagenes, [espacio]: imagenes },
    };
  });
}

/** Saca un mensaje de la cola para editarlo: devuelve su texto y sus adjuntos vuelven a la caja. */
export function sacarDeCola(espacio: string, id: number): string {
  const item = colaDe(espacio).find((i) => i.id === id);
  if (!item) return "";
  ponerCola(espacio, colaDe(espacio).filter((i) => i.id !== id));
  devolverAdjuntos(espacio, [item]);
  return item.texto;
}

export function quitarDeCola(espacio: string, id: number) {
  ponerCola(espacio, colaDe(espacio).filter((i) => i.id !== id));
}

/** Al acabar un turno: sale el siguiente de la cola o, si se paró a mano, vuelve todo a la caja. */
function alAcabarTurno(espacio: string) {
  if (parados.delete(espacio)) return devolverCola(espacio);
  const [primero, ...resto] = colaDe(espacio);
  if (!primero) return;
  ponerCola(espacio, resto);
  // Un comando que resuelve Kyu (/clear, /context) no abre turno: se sigue con la cola.
  const orden = primero.texto.trim().toLowerCase();
  const cv = conversacion(espacio);
  const local = orden === "/clear" || orden === "/new" || (orden === "/context" && cv.claudeId !== null && !cv.agente);
  void enviar(espacio, primero.texto, primero);
  if (local) alAcabarTurno(espacio);
}

/** Toda la cola vuelve a la caja (al parar, o si Claude se cierra a media respuesta). */
function devolverCola(espacio: string) {
  const cola = colaDe(espacio);
  if (!cola.length) return;
  ponerCola(espacio, []);
  devolverAdjuntos(espacio, cola);
  const texto = cola.map((i) => i.texto).filter(Boolean).join("\n\n");
  if (texto) useClaude.setState((s) => ({ borradores: { ...s.borradores, [espacio]: texto } }));
}

/** Olvida la cola de una conversación que se cierra. */
function olvidarCola(espacio: string) {
  parados.delete(espacio);
  ponerCola(espacio, []);
}

/** Cierra el proceso y empieza de cero (en la carpeta del terminal con el foco, al escribir). */
export function nueva(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId !== null) void cerrarClaude(c.claudeId);
  // Si estaba trabajando, lo que esperaba en cola vuelve a la caja (no se manda a la nueva).
  if (c.estado === "arrancando" || c.estado === "pensando") {
    parados.delete(espacio);
    devolverCola(espacio);
  }
  // Se queda con lo elegido en la conversación que se cierra.
  useClaude.setState((s) => ({
    verContexto: s.verContexto === espacio ? null : s.verContexto,
    conversaciones: {
      ...s.conversaciones,
      [espacio]: {
        ...vacia(),
        agente: c.agente,
        ajustesAgente: c.ajustesAgente,
        eleccionModelo: c.eleccionModelo,
        modo: c.modo,
        esfuerzo: c.esfuerzo,
        cuenta: c.cuenta,
      },
    },
  }));
}

// ---------- Cuentas ----------

/**
 * Al leer kyu.toml: qué cuentas hay y si hay sugerencias. Las conversaciones con una cuenta que
 * ya no existe vuelven a la de siempre.
 */
export function configurarClaude({
  cuentas_claude: cuentas,
  cuentas_antigravity: cuentasAntigravity,
  sugerencias_claude: sugerencias,
}: ConfigVista) {
  useClaude.setState((s) => {
    const vale = (x: string | null, lista: string[]) => (x && lista.includes(x) ? x : null);
    const prefs = { ...s.prefs, cuenta: vale(s.prefs.cuenta, cuentas) };
    guardarPrefs(prefs);
    const conversaciones = Object.fromEntries(
      Object.entries(s.conversaciones).map(([id, c]) => [
        id,
        {
          ...c,
          cuenta: c.agente === "antigravity" ? vale(c.cuenta, cuentasAntigravity) : c.agente ? null : vale(c.cuenta, cuentas),
        },
      ]),
    );
    return { cuentas, cuentasAntigravity, sugerencias, prefs, conversaciones };
  });
}

const cuentaValida = (x: string | null) => (x && useClaude.getState().cuentas.includes(x) ? x : null);

/**
 * Cambia la cuenta de la conversación. Si Claude está en marcha (y sin hacer nada), se cierra
 * y con el próximo mensaje sigue la misma conversación con la otra cuenta (`--resume`).
 */
export function cambiarCuenta(espacio: string, cuenta: string | null) {
  const c = conversacion(espacio);
  if (c.estado === "arrancando" || c.estado === "pensando" || cuenta === c.cuenta) return;
  if (!c.agente) recordar({ cuenta });
  if (c.claudeId === null) {
    cambiar(espacio, () => ({ cuenta }));
    return;
  }
  void cerrarClaude(c.claudeId);
  cambiar(espacio, (x) => ({
    cuenta,
    claudeId: null,
    generacion: ++contador,
    estado: "cerrado",
    reanudar: x.sesion,
    sugerencia: null,
  }));
  añadir(espacio, { tipo: "aviso", texto: `Cuenta: ${cuenta ?? "la de siempre"} · la conversación sigue con el próximo mensaje` });
}

// ---------- Puntos de control ----------

/** Qué deshacer al volver a un mensaje tuyo. */
export type Vuelta = "todo" | "conversacion" | "archivos";

/** Lo que cambiaría en los archivos al volver a ese mensaje (null si no se puede saber). */
export interface CambiosVuelta {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

const mensajeTuyo = (c: Conversacion, entrada: number) => {
  const e = c.entradas.find((x) => x.id === entrada);
  return e?.tipo === "tu" ? e : null;
};

/** Pregunta a Claude (sin tocar nada) qué archivos devolvería a como estaban. */
export async function cambiosAlVolver(espacio: string, entrada: number): Promise<CambiosVuelta | null> {
  const c = conversacion(espacio);
  const e = mensajeTuyo(c, entrada);
  if (c.claudeId === null || !e?.uuid) return null;
  try {
    return await controlClaude<CambiosVuelta>(c.claudeId, { subtype: "rewind_files", user_message_id: e.uuid, dry_run: true });
  } catch (err) {
    return { canRewind: false, error: String(err) };
  }
}

/**
 * Vuelve a antes de un mensaje tuyo. «archivos»: los archivos que tocó Claude desde entonces
 * quedan como estaban (hace falta Claude en marcha). «conversacion»: se corta la conversación
 * ahí (Claude sigue una copia hasta ese punto) y el mensaje vuelve a la caja para cambiarlo.
 */
export async function volver(espacio: string, entrada: number, que: Vuelta) {
  const c = conversacion(espacio);
  const e = mensajeTuyo(c, entrada);
  if (!e || c.estado === "arrancando" || c.estado === "pensando") return;
  if (que !== "conversacion") {
    if (c.claudeId === null || !e.uuid) return;
    try {
      const r = await controlClaude<CambiosVuelta>(c.claudeId, { subtype: "rewind_files", user_message_id: e.uuid });
      if (!r.canRewind) throw new Error(r.error || "Claude no tiene copia de esos archivos");
    } catch (err) {
      añadir(espacio, { tipo: "error", texto: `No se pudieron devolver los archivos: ${err}` });
      return;
    }
    if (que === "archivos") {
      añadir(espacio, { tipo: "aviso", texto: `Archivos como estaban antes de «${corto(e.texto)}»` });
      return;
    }
  }
  if (c.claudeId !== null) void cerrarClaude(c.claudeId);
  const i = c.entradas.indexOf(e);
  // Sin pieza anterior era el primer mensaje: se empieza de cero.
  const seguir = e.previo && c.sesion ? c.sesion : null;
  useClaude.setState((s) => ({
    verContexto: s.verContexto === espacio ? null : s.verContexto,
    borradores: { ...s.borradores, [espacio]: e.texto },
    conversaciones: {
      ...s.conversaciones,
      [espacio]: {
        ...c,
        claudeId: null,
        generacion: ++contador,
        estado: seguir ? "cerrado" : "parado",
        reanudar: seguir,
        reanudarEn: seguir ? (e.previo ?? null) : null,
        sesion: seguir,
        sugerencia: null,
        ultimoUuid: seguir ? (e.previo ?? null) : null,
        carpeta: seguir ? c.carpeta : null,
        contexto: null,
        tokens: 0,
        entradas: [
          ...c.entradas.slice(0, i),
          ...(i > 0
            ? [{ id: ++contador, tipo: "aviso", texto: que === "todo" ? "Vuelto aquí: conversación y archivos" : "Vuelto aquí: solo la conversación" } as Entrada]
            : []),
        ],
      },
    },
  }));
}

const corto = (t: string) => (t.length > 40 ? t.slice(0, 40).trimEnd() + "…" : t);

/** El texto que tiene que volver a la caja (y se olvida). */
export function tomarBorrador(espacio: string) {
  const t = useClaude.getState().borradores[espacio];
  if (t === undefined) return null;
  useClaude.setState((s) => {
    const { [espacio]: _, ...resto } = s.borradores;
    return { borradores: resto };
  });
  return t;
}

/** Cierra las conversaciones de los espacios que ya no existen. */
export function limpiar(espacios: string[]) {
  for (const id of Object.keys(useClaude.getState().conversaciones)) {
    if (!espacios.includes(espacioDe(id))) {
      cerrarConversacion(id);
      useClaude.setState((s) => {
        const { [espacioDe(id)]: _, ...ultimas } = s.ultimas;
        return { ultimas };
      });
    }
  }
}
