// Mensajes de una conversación: la lista, cada entrada (tuyas, de Claude, herramientas, avisos) y los recuadros de orden y selección.
import Markdown from "./Markdown";
import Permiso from "./Permiso";
import AvisoContexto from "./AvisoContexto";
import { useLayoutEffect, useRef } from "react";
import { abrirMenuMensaje } from "../lib/menus";
import { Check, Info, Loader2, SquareTerminal, TextQuote, X } from "lucide-react";
import { nombreAgente, nombreSeleccion, type Conversacion, type Entrada, type Seleccion } from "../lib/claude";
import { EtiquetaFondo } from "./Tareas";
import { Recientes } from "./AdjuntosClaude";
import { type TextoBloque } from "../lib/bloques";
import { abrirYPreparar, nombreDestino, usePreparados } from "../lib/comandoClaude";
import { herramienta, relativa } from "../lib/herramientas";
import { BotonVerCambios, PasosSubagente, Plan, Preguntas, preguntasDe, Razonamiento, ResumenCambios, VolverAqui } from "./TandaClaude";
import { IconoAgente } from "./iconos";
import { nombreCarpeta } from "./PanelClaude";

export function ListaEntradas({ espacio, c, carpeta, grande }: { espacio: string; c: Conversacion; carpeta: string | null; grande: boolean }) {
  const caja = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const pegado = useRef(true);
  const vacia = c.entradas.length === 0;

  // Se queda abajo mientras Claude escribe, salvo que hayas subido a leer. Se mira el
  // tamaño real: el código coloreado y los recuadros crecen después de pintarse.
  useLayoutEffect(() => {
    const el = caja.current;
    const dentro = contenido.current;
    if (!el || !dentro) return;
    const bajar = () => {
      if (pegado.current) el.scrollTop = el.scrollHeight;
    };
    bajar();
    const obs = new ResizeObserver(bajar);
    obs.observe(dentro);
    obs.observe(el);
    return () => obs.disconnect();
  }, [vacia]);

  // Al mandar un mensaje se vuelve abajo aunque hubieras subido a leer.
  const ultimoTuyo = [...c.entradas].reverse().find((e) => e.tipo === "tu")?.id;
  useLayoutEffect(() => {
    pegado.current = true;
    const el = caja.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ultimoTuyo]);

  if (vacia) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <IconoAgente agente={c.agente} alto={34} />
        <p className="text-[14px] font-medium">¿En qué te ayudo?</p>
        <p className="text-[12px] leading-relaxed text-tenue">
          {nombreAgente(c)} trabajará en <span className="font-mono text-[11.5px] text-texto">{nombreCarpeta(carpeta)}</span>, la
          carpeta del terminal con el foco.
        </p>
        <Recientes espacio={espacio} carpeta={carpeta} agente={c.agente} />
      </div>
    );
  }

  return (
    <div
      ref={caja}
      onScroll={(e) => {
        const el = e.currentTarget;
        pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div ref={contenido} className={`flex flex-col gap-3 px-3.5 py-3.5 ${grande ? "mx-auto w-full max-w-[780px] py-6" : ""}`}>
        {c.entradas.map((e) => (
          <VistaEntrada key={e.id} entrada={e} espacio={espacio} carpeta={c.carpeta} />
        ))}
        {(c.estado === "arrancando" || c.estado === "pensando") && c.entradas[c.entradas.length - 1]?.tipo === "tu" && (
          <Esperando arrancando={c.claudeId === null} quien={nombreAgente(c)} />
        )}
        <ComandoPreparado cid={espacio} />
        <AvisoContexto cid={espacio} c={c} />
        {c.estado === "cerrado" && (
          <p className="text-center text-[11.5px] text-muy">
            {nombreAgente(c)} se ha cerrado. Al escribir, sigue esta misma conversación.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Aviso de que el último comando de la respuesta va en una terminal que no está abierta,
 * con el botón para abrirla. Con la terminal abierta no sale nada: el comando ya se ve
 * en gris en ella.
 */
function ComandoPreparado({ cid }: { cid: string }) {
  const p = usePreparados((s) => s.porConv[cid]);
  if (!p || p.item) return null;
  const destino = nombreDestino(p.destino);
  return (
    // El botón baja a su propia línea si el panel es estrecho.
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 rounded-lg border border-claude/25 bg-claude/[0.05] px-2.5 py-1.5 text-[12px] text-tenue">
      <span className="flex min-w-[150px] flex-1 items-start gap-2">
        <SquareTerminal size={13} strokeWidth={1.8} className="mt-[2px] flex-none text-claude2" />
        <span>
          Va en <b className="font-medium text-texto">{destino}</b> y no hay ninguna abierta
        </span>
      </span>
      <button
        type="button"
        onClick={() => void abrirYPreparar(cid)}
        className="flex h-6 max-w-full flex-none items-center truncate rounded-md border border-claude bg-claude px-2 text-[11.5px] font-medium text-white hover:brightness-110"
      >
        Abrir {destino}
      </button>
    </div>
  );
}

// Entre mandar el mensaje y lo primero de Claude pasan uno o dos segundos (ganchos de
// UserPromptSubmit, la API): sin esto la conversación parece parada.
function Esperando({ arrancando, quien }: { arrancando: boolean; quien: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-tenue" aria-live="polite">
      <span className="flex gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 animate-pulse rounded-full bg-claude" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      {arrancando ? `Arrancando ${quien}…` : "Pensando…"}
    </div>
  );
}

function VistaEntrada({ entrada: e, espacio, carpeta }: { entrada: Entrada; espacio: string; carpeta: string | null }) {
  switch (e.tipo) {
    case "tu":
      return (
        <div className="group/tu flex max-w-[88%] items-start gap-1 self-end">
          {e.uuid && <VolverAqui espacio={espacio} entrada={e.id} tieneUuid />}
          <div className="flex min-w-0 flex-col items-end gap-1.5">
            {e.adjunto && <RecuadroOrden a={e.adjunto} />}
            {e.seleccion && <RecuadroSeleccion s={e.seleccion} />}
            {e.imagenes && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {e.imagenes.map((u, i) => (
                  <img key={i} src={u} alt="" className="max-h-28 max-w-[160px] rounded-md border border-borde object-cover" />
                ))}
              </div>
            )}
            <div className="select-text whitespace-pre-wrap break-words rounded-[12px_12px_4px_12px] border border-borde bg-tarjeta px-[11px] py-2">
              {e.texto}
            </div>
          </div>
        </div>
      );
    case "razonamiento":
      return <Razonamiento e={e} />;
    case "cambios":
      return <ResumenCambios espacio={espacio} archivos={e.archivos} carpeta={carpeta} />;
    case "claude":
      return (
        <div
          className={e.enCurso ? "cursor-claude" : undefined}
          onContextMenu={(ev) => {
            ev.preventDefault();
            abrirMenuMensaje(espacio, e.id, ev.target as HTMLElement, ev.currentTarget, ev.clientX, ev.clientY);
          }}
        >
          <Markdown texto={e.texto} />
        </div>
      );
    case "herramienta": {
      // El plan ya sale entero en su recuadro.
      if (e.nombre === "ExitPlanMode" || e.nombre === "AskUserQuestion") return null;
      const [nombre, Icono] = herramienta(e.nombre);
      return (
        <div className="flex flex-col gap-1 rounded-lg border border-borde px-[9px] py-[5px]">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-tenue">
            <Icono size={13} strokeWidth={1.8} className="flex-none" />
            <b className="flex-none font-semibold text-texto">{nombre}</b>
            <span title={e.resumen} className="min-w-0 truncate font-mono text-[11.5px]">
              {relativa(e.resumen, carpeta)}
            </span>
            {e.fondo && <EtiquetaFondo cid={espacio} fondo={e.fondo} />}
            <span className={e.fondo ? "flex-none" : "ml-auto flex-none"}>
              {e.fondo && !e.fondo.estado ? (
                <Loader2 size={13} className="animate-spin text-claude2" />
              ) : e.estado === "ejecutando" ? (
                <Loader2 size={13} className="animate-spin text-muy" />
              ) : e.estado === "ok" ? (
                <Check size={13} className="text-ok" />
              ) : (
                <X size={13} className="text-mal" />
              )}
            </span>
            {e.ruta && e.estado === "ok" && <BotonVerCambios espacio={espacio} ruta={e.ruta} />}
          </div>
          {e.pasos ? <PasosSubagente pasos={e.pasos} ultimo={e.estado === "ejecutando" ? e.ultimoPaso : undefined} carpeta={carpeta} /> : null}
        </div>
      );
    }
    case "permiso":
      if (e.herramienta === "ExitPlanMode") return <Plan e={e} espacio={espacio} />;
      if (e.herramienta === "AskUserQuestion" && preguntasDe(e.input)) return <Preguntas e={e} espacio={espacio} />;
      return <Permiso e={e} espacio={espacio} carpeta={carpeta} />;
    case "aviso":
      return (
        <p className="flex items-start gap-1.5 self-center text-[11.5px] text-muy">
          <Info size={12} strokeWidth={1.8} className="mt-[2px] flex-none" />
          <span className="select-text whitespace-pre-wrap break-words">{e.texto}</span>
        </p>
      );
    case "error":
      return (
        <p className="select-text whitespace-pre-wrap break-words rounded-lg border border-mal/25 bg-mal/[0.04] px-[9px] py-1.5 font-mono text-[11.5px] text-mal">
          {e.texto}
        </p>
      );
  }
}

/** La orden del terminal adjunta: «› npm run build · código 1 · 42 líneas». */
export function RecuadroOrden({ a, onQuitar }: { a: TextoBloque; onQuitar?: () => void }) {
  const mal = a.codigo !== 0;
  return (
    <div
      title={a.salida ? a.salida.split("\n").slice(-12).join("\n") : undefined}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-borde bg-tarjeta py-1 pl-2 pr-1 text-[11.5px] text-tenue"
    >
      <SquareTerminal size={13} strokeWidth={1.8} className={`flex-none ${mal ? "text-mal" : "text-ok"}`} />
      <span className="min-w-0 truncate font-mono text-texto">{a.orden || "(orden vacía)"}</span>
      <span className="flex-none text-muy">
        · {mal ? `código ${a.codigo}` : "bien"} · {a.lineas} {a.lineas === 1 ? "línea" : "líneas"}
      </span>
      {onQuitar ? (
        <button
          type="button"
          title="Quitar"
          onClick={onQuitar}
          className="grid size-5 flex-none place-items-center rounded text-muy hover:bg-hover hover:text-texto"
        >
          <X size={12} />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </div>
  );
}

export function RecuadroSeleccion({ s, onQuitar }: { s: Seleccion; onQuitar?: () => void }) {
  return (
    <div
      title={(s.ruta ? `${s.ruta}\n\n` : "") + s.texto.split("\n").slice(0, 14).join("\n")}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-borde bg-tarjeta py-1 pl-2 pr-1 text-[11.5px] text-tenue"
    >
      <TextQuote size={13} strokeWidth={1.8} className="flex-none text-acento" />
      <span className="min-w-0 truncate font-mono text-texto">{nombreSeleccion(s)}</span>
      {s.ruta && <span className="flex-none text-muy">· {s.lineas} {s.lineas === 1 ? "línea" : "líneas"}</span>}
      {onQuitar ? (
        <button
          type="button"
          title="Quitar"
          onClick={onQuitar}
          className="grid size-5 flex-none place-items-center rounded text-muy hover:bg-hover hover:text-texto"
        >
          <X size={12} />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </div>
  );
}
