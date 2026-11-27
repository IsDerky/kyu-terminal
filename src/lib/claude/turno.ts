// Un turno: arrancar o reanudar, enviar, responder permisos, parar y la cola.
import { abrirClaude, cerrarClaude, controlClaude, enviarClaude, historialClaude, pararClaude, responderClaude } from "../nucleo";
import { ajustesGuardados } from "../agentes";
import { ejecutarParaConversacion } from "../mcp";
import { type TextoBloque } from "../bloques";
import { type ImagenAdjunta } from "../imagenes";
import { type Catalogo } from "../claudeOpciones";
import { type Entrada, type Seleccion, type Respuesta, type EnCola, useClaude, espacioDe, vacia, conversacion, siguienteId, cambiar, añadir } from "./estado";
import { marcarUltima, carpetaDelEspacio } from "./sitios";
import { alEvento } from "./eventos";
import { quitarSeleccion, PREGUNTA_SELECCION, conSeleccion, quitarAdjunto, PREGUNTA_POR_DEFECTO, conAdjunto } from "./adjuntos";
import { ponerFlotante, apuntarMemoria, abrirMemoria, exportar, refrescarContexto } from "./comandos";
import { guardarCatalogoDe, cuentaValida } from "./ajustes";

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
        return [{ id: siguienteId(), tipo: "tu", texto: p.texto, uuid: p.uuid, previo: p.previo }];
      case "claude":
        return [{ id: siguienteId(), tipo: "claude", texto: p.texto, enCurso: false }];
      case "herramienta":
        return [
          {
            id: siguienteId(),
            tipo: "herramienta",
            idHerramienta: p.id,
            nombre: p.nombre,
            resumen: p.resumen,
            estado: p.error ? "error" : "ok",
          },
        ];
      case "aviso":
        return [{ id: siguienteId(), tipo: "aviso", texto: p.texto }];
    }
  });
  entradas.push({ id: siguienteId(), tipo: "aviso", texto: `Reanudada «${titulo}»: sigue donde lo dejaste` });
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
  const generacion = siguienteId();
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
      const generacion = siguienteId();
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

/** Conversaciones paradas a mano: al llegar su fin, la cola vuelve a la caja. */
export const parados = new Set<string>();

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
    id: siguienteId(),
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
export function alAcabarTurno(espacio: string) {
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
export function devolverCola(espacio: string) {
  const cola = colaDe(espacio);
  if (!cola.length) return;
  ponerCola(espacio, []);
  devolverAdjuntos(espacio, cola);
  const texto = cola.map((i) => i.texto).filter(Boolean).join("\n\n");
  if (texto) useClaude.setState((s) => ({ borradores: { ...s.borradores, [espacio]: texto } }));
}

/** Olvida la cola de una conversación que se cierra. */
export function olvidarCola(espacio: string) {
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
