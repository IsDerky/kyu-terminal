// Lo que llega de Claude Code o del agente (texto, herramientas, permisos, fin de turno).
import { controlClaude, type EventoClaude, leerArchivo } from "../nucleo";
import { guardarCatalogoAgente } from "../agentes";
import { useKyu } from "../estado";
import { contar, diffLineas } from "../diff";
import { recargarRuta } from "../editores";
import { refrescarGasto } from "../gasto";
import { apuntarLimite, claveCuenta } from "../limites";
import { type ArchivoCambiado, useClaude, conversacion, siguienteId, cambiar, cerrarRazonamiento, añadir, miles } from "./estado";
import { panelMuestra } from "./sitios";
import { refrescarContexto } from "./comandos";
import { parados, alAcabarTurno, devolverCola } from "./turno";

export function alEvento(espacio: string, generacion: number, ev: EventoClaude) {
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
          { id: siguienteId(), tipo: "aviso", texto: "Reanudada: sigue donde lo dejaste" },
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
        return { entradas: [...cerrarRazonamiento(c.entradas), { id: siguienteId(), tipo, texto: ev.texto, enCurso: true }] };
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
        return { entradas: [...cerrarRazonamiento(c.entradas), { id: siguienteId(), tipo, texto: ev.texto, enCurso: false }] };
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
            { id: siguienteId(), espacio, texto: texto.slice(0, 140), error: ev.error, duracion: ev.duracion },
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
