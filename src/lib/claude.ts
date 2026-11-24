// Panel de Claude: una conversación por espacio de trabajo, cada una con su proceso de
// Claude Code (src-tauri/src/claude.rs). El proceso se arranca con el primer mensaje, en la
// carpeta del terminal con el foco.
import { create } from "zustand";
import {
  abrirClaude,
  cerrarClaude,
  controlClaude,
  enviarClaude,
  historialClaude,
  pararClaude,
  responderClaude,
  type EventoClaude,
} from "./nucleo";
import { paneles, useKyu } from "./estado";
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
  type Preferencias,
  type UsoContexto,
} from "./claudeOpciones";

export type Entrada =
  | {
      id: number;
      tipo: "tu";
      texto: string;
      adjunto?: TextoBloque;
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
      /** Subagente (Task): cuántas herramientas lleva y la última. */
      pasos?: number;
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
    }
  | { id: number; tipo: "error"; texto: string }
  /** Línea tenue: «Conversación compactada», «Unknown command: /x»… */
  | { id: number; tipo: "aviso"; texto: string };

export type Respuesta = "permitir" | "siempre" | "denegar";

type SinId<T> = T extends unknown ? Omit<T, "id"> : never;

/** parado = sin proceso todavía; cerrado = el proceso terminó. */
export type EstadoConv = "parado" | "arrancando" | "pensando" | "listo" | "cerrado";

export interface Conversacion {
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
  visible: boolean;
  conversaciones: Record<string, Conversacion>;
  avisos: AvisoFin[];
  /** Orden del terminal adjunta a lo próximo que se escriba, por espacio. */
  adjuntos: Record<string, TextoBloque>;
  /** Imágenes pegadas o soltadas para lo próximo que se escriba, por espacio. */
  imagenes: Record<string, ImagenAdjunta[]>;
  /** Comandos y modelos de Claude Code (del último initialize). */
  catalogo: Catalogo | null;
  /** Lo elegido la última vez: lo hereda cada conversación nueva. */
  prefs: Preferencias;
  /** Desglose del contexto abierto. */
  verContexto: boolean;
  /** Texto que vuelve a la caja al volver a un punto, por espacio. */
  borradores: Record<string, string>;
  mostrar: (visible: boolean) => void;
  quitarAviso: (id: number) => void;
}

export const vacia = (prefs: Preferencias = useClaude.getState().prefs): Conversacion => ({
  claudeId: null,
  generacion: 0,
  carpeta: null,
  sesion: null,
  reanudar: null,
  reanudarEn: null,
  ultimoUuid: null,
  entradas: [],
  estado: "parado",
  desde: 0,
  modelo: "",
  eleccionModelo: prefs.modelo,
  modo: prefs.modo,
  esfuerzo: prefs.esfuerzo,
  compactando: false,
  contexto: null,
  tokens: 0,
  coste: 0,
  duracion: 0,
});

export const useClaude = create<EstadoClaude>((set) => ({
  visible: false,
  conversaciones: {},
  avisos: [],
  adjuntos: {},
  imagenes: {},
  catalogo: catalogoGuardado(),
  prefs: prefsGuardadas(),
  verContexto: false,
  borradores: {},
  mostrar: (visible) => set({ visible }),
  quitarAviso: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),
}));

/** ¿El panel está enseñando ahora la conversación de este espacio? */
export const panelMuestra = (espacio: string) => useClaude.getState().visible && useKyu.getState().activo === espacio;

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
  c.contexto?.maxTokens || (/\[1m\]/i.test(c.modelo + (c.eleccionModelo ?? "")) ? 1_000_000 : 200_000);

function alEvento(espacio: string, generacion: number, ev: EventoClaude) {
  if (useClaude.getState().conversaciones[espacio]?.generacion !== generacion) return;
  switch (ev.tipo) {
    case "iniciado":
      cambiar(espacio, (c) => ({ modelo: ev.modelo, modo: ev.modo || c.modo, sesion: ev.sesion || c.sesion }));
      return;
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
      return;
    case "error":
      añadir(espacio, { tipo: "error", texto: ev.texto });
      return;
    case "cerrado":
      // Al volver a escribir se sigue la misma conversación (--resume), en la misma carpeta.
      cambiar(espacio, (c) => ({ estado: "cerrado", claudeId: null, reanudar: c.sesion }));
      return;
  }
}

/** Adjunta una orden del terminal a lo próximo que se le escriba a Claude. */
export function adjuntar(espacio: string, bloque: TextoBloque) {
  useClaude.setState((s) => ({ adjuntos: { ...s.adjuntos, [espacio]: bloque }, visible: true }));
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

/** Pide a Claude el desglose del contexto y lo guarda en la conversación. */
export async function refrescarContexto(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId === null) return;
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
export async function reanudar(espacio: string, carpeta: string, id: string, titulo: string) {
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
    verContexto: false,
    conversaciones: {
      ...s.conversaciones,
      [espacio]: {
        ...vacia(),
        eleccionModelo: antes.eleccionModelo,
        modo: antes.modo,
        esfuerzo: antes.esfuerzo,
        carpeta,
        reanudar: id,
        sesion: id,
        ultimoUuid,
        entradas,
      },
    },
  }));
}

export async function enviar(espacio: string, texto: string) {
  let c = conversacion(espacio);
  if (c.estado === "arrancando" || c.estado === "pensando") return;
  // Comandos que resuelve Kyu sin Claude.
  const orden = texto.trim().toLowerCase();
  if (orden === "/clear" || orden === "/new") return nueva(espacio);
  if (orden === "/context" && c.claudeId !== null) {
    useClaude.setState({ verContexto: true });
    return void refrescarContexto(espacio);
  }
  const adjunto = useClaude.getState().adjuntos[espacio];
  if (adjunto) quitarAdjunto(espacio);
  const imagenes = useClaude.getState().imagenes[espacio] ?? [];
  if (imagenes.length) useClaude.setState((s) => ({ imagenes: { ...s.imagenes, [espacio]: [] } }));
  const mensaje = adjunto ? conAdjunto(texto, adjunto) : texto;
  añadir(espacio, {
    tipo: "tu",
    texto: texto || (adjunto ? PREGUNTA_POR_DEFECTO : ""),
    adjunto,
    imagenes: imagenes.length ? imagenes.map((i) => i.url) : undefined,
    esperaEco: true,
  });
  cambiar(espacio, () => ({ estado: "arrancando", desde: Date.now() }));
  try {
    if (c.claudeId === null) {
      // Al reanudar, en la carpeta de la conversación guardada; si no, la del terminal con el foco.
      const carpeta = c.reanudar ? c.carpeta : carpetaDelEspacio(espacio);
      const generacion = ++contador;
      cambiar(espacio, () => ({ generacion }));
      const id = await abrirClaude(
        carpeta,
        { modelo: c.eleccionModelo, modo: c.modo, esfuerzo: c.esfuerzo, reanudar: c.reanudar, reanudarEn: c.reanudarEn },
        (ev) => alEvento(espacio, generacion, ev),
      );
      // La copia cortada ya existe: si Claude se cierra, se sigue esa (su id llega en el init).
      cambiar(espacio, () => ({ claudeId: id, carpeta, reanudarEn: null }));
      c = conversacion(espacio);
      // Comandos de este proyecto y modelos: en segundo plano, sin esperar.
      void controlClaude<Catalogo>(id, { subtype: "initialize" })
        .then(guardarCatalogoDe)
        .then(() => refrescarContexto(espacio))
        .catch(() => {});
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

export function parar(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId !== null && (c.estado === "pensando" || c.estado === "arrancando")) void pararClaude(c.claudeId);
}

/** Cierra el proceso y empieza de cero (en la carpeta del terminal con el foco, al escribir). */
export function nueva(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId !== null) void cerrarClaude(c.claudeId);
  // Se queda con lo elegido en la conversación que se cierra.
  useClaude.setState((s) => ({
    verContexto: false,
    conversaciones: {
      ...s.conversaciones,
      [espacio]: { ...vacia(), eleccionModelo: c.eleccionModelo, modo: c.modo, esfuerzo: c.esfuerzo },
    },
  }));
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
    verContexto: false,
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
