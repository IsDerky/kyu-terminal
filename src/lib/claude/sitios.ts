// Dónde está cada conversación (pestañas, espacios) y cómo se abre, se elige o se cierra.
import { cerrarClaude, opcionAgente, type OpcionAgente } from "../nucleo";
import { ajustesGuardados, catalogoAgente, guardarAjustes, opcionesVistas } from "../agentes";
import { paneles, useKyu } from "../estado";
import { type Comando } from "../claudeOpciones";
import { type Conversacion, vacia, useClaude, espacioDe, conversacion, cambiar, añadir } from "./estado";
import { olvidarCola } from "./turno";

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
