// Volver a un mensaje (conversación y archivos) y limpiar al cerrar.
import { cerrarClaude, controlClaude } from "../nucleo";
import { type Entrada, type Conversacion, useClaude, espacioDe, conversacion, siguienteId, añadir, corto } from "./estado";
import { cerrarConversacion } from "./sitios";

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
        generacion: siguienteId(),
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
            ? [{ id: siguienteId(), tipo: "aviso", texto: que === "todo" ? "Vuelto aquí: conversación y archivos" : "Vuelto aquí: solo la conversación" } as Entrada]
            : []),
        ],
      },
    },
  }));
}

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
