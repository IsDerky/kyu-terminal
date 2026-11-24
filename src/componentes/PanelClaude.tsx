import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, FolderOpen, Loader2, Square, SquarePen, X } from "lucide-react";
import {
  carpetaDelEspacio,
  enviar,
  limiteContexto,
  nueva,
  parar,
  pendiente,
  responder,
  useClaude,
  type Conversacion,
  type Entrada,
} from "../lib/claude";
import { useKyu } from "../lib/estado";
import { herramienta, relativa } from "../lib/herramientas";
import Markdown from "./Markdown";
import Permiso from "./Permiso";
import { Mascota } from "./iconos";

export const ID_ENTRADA = "entrada-claude";

const nombreCarpeta = (ruta: string | null) => (ruta ? ruta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ruta : "~");

const dolares = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }) + " $";

const segundos = (ms: number) => (ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: ms < 10_000 ? 1 : 0 }) + " s";

/** Panel de Claude a la derecha: conversación del espacio activo con Claude Code. */
export default function PanelClaude({ espacio }: { espacio: string }) {
  const conv = useClaude((s) => s.conversaciones[espacio]);
  // Antes de arrancar, la carpeta que se usará (sigue al terminal con el foco).
  const carpetaFoco = useKyu(() => carpetaDelEspacio(espacio));
  const c: Conversacion = conv ?? {
    claudeId: null, generacion: 0, carpeta: null, entradas: [], estado: "parado", desde: 0, modelo: "", tokens: 0, coste: 0, duracion: 0,
  };
  const carpeta = c.claudeId !== null || c.estado === "cerrado" ? c.carpeta : carpetaFoco;
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  const porcentaje = Math.min(100, Math.round((c.tokens / limiteContexto(c.modelo)) * 100));
  const permiso = pendiente(conv);

  // Con un permiso pendiente y el foco en el panel: Intro permite, Esc deniega. La caja
  // de texto lo resuelve antes (con texto, Intro deniega y se lo dice a Claude).
  const teclas = (e: React.KeyboardEvent) => {
    if (!permiso || e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.target instanceof HTMLButtonElement && e.key === "Enter") return;
    if (e.key === "Escape") {
      e.preventDefault();
      void responder(espacio, permiso.id, "denegar");
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void responder(espacio, permiso.id, "permitir");
    }
  };

  return (
    <aside
      onKeyDown={teclas}
      className="group/claude m-2 ml-0 flex w-[380px] flex-none flex-col overflow-hidden rounded-[10px] border border-claude/40 bg-panel shadow-[0_0_0_3px_#d977570a,0_20px_50px_-25px_#d9775733]">
      <header className="flex h-11 flex-none items-center gap-2 border-b border-borde pl-3.5 pr-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Mascota alto={15} />
          Claude
        </span>
        <span
          title={carpeta ?? "Carpeta personal"}
          className="flex min-w-0 items-center gap-1.5 rounded-md border border-borde bg-tarjeta px-2 py-0.5 text-[11.5px] text-tenue"
        >
          <FolderOpen size={12} strokeWidth={1.8} className="flex-none" />
          <span className="truncate">{nombreCarpeta(carpeta)}</span>
        </span>
        <span
          title={`Contexto: ${c.tokens.toLocaleString("es-ES")} de ${limiteContexto(c.modelo).toLocaleString("es-ES")} tokens`}
          className="ml-auto flex flex-none items-center gap-1.5 text-[11px] text-tenue"
        >
          <span className="h-[5px] w-12 overflow-hidden rounded-full bg-hover">
            <span className="block h-full rounded-full bg-claude" style={{ width: `${porcentaje}%` }} />
          </span>
          {porcentaje} %
        </span>
        <BotonCabecera titulo="Nueva conversación" onClick={() => nueva(espacio)}>
          <SquarePen size={14} strokeWidth={1.8} />
        </BotonCabecera>
        <BotonCabecera titulo="Ocultar (Ctrl+Mayús+C)" onClick={() => useClaude.getState().mostrar(false)}>
          <X size={15} strokeWidth={1.8} />
        </BotonCabecera>
      </header>

      <ListaEntradas espacio={espacio} c={c} carpeta={carpeta} />

      <CajaEntrada espacio={espacio} ocupado={ocupado} permiso={permiso?.id ?? null} />

      <footer className="flex h-7 flex-none items-center gap-2 border-t border-borde px-3.5 text-[11px] text-muy">
        <EstadoTurno c={c} />
        <span className="ml-auto truncate">{c.modelo.replace(/^claude-/, "")}</span>
        {c.coste > 0 && <span title="Coste de la conversación">{dolares(c.coste)}</span>}
      </footer>
    </aside>
  );
}

function BotonCabecera({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      className="grid size-7 flex-none place-items-center rounded-md text-muy hover:bg-hover hover:text-texto"
    >
      {children}
    </button>
  );
}

function ListaEntradas({ espacio, c, carpeta }: { espacio: string; c: Conversacion; carpeta: string | null }) {
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

  if (vacia) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <Mascota alto={34} />
        <p className="text-[14px] font-medium">¿En qué te ayudo?</p>
        <p className="text-[12px] leading-relaxed text-tenue">
          Claude trabajará en <span className="font-mono text-[11.5px] text-texto">{nombreCarpeta(carpeta)}</span>, la
          carpeta del terminal con el foco.
        </p>
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
      <div ref={contenido} className="flex flex-col gap-3 px-3.5 py-3.5">
        {c.entradas.map((e) => (
          <VistaEntrada key={e.id} entrada={e} espacio={espacio} carpeta={c.carpeta} />
        ))}
        {c.estado === "cerrado" && (
          <p className="text-center text-[11.5px] text-muy">
            Claude se ha cerrado. Al escribir empieza una conversación nueva.
          </p>
        )}
      </div>
    </div>
  );
}

function VistaEntrada({ entrada: e, espacio, carpeta }: { entrada: Entrada; espacio: string; carpeta: string | null }) {
  switch (e.tipo) {
    case "tu":
      return (
        <div className="max-w-[88%] select-text self-end whitespace-pre-wrap break-words rounded-[12px_12px_4px_12px] border border-borde bg-tarjeta px-[11px] py-2">
          {e.texto}
        </div>
      );
    case "claude":
      return (
        <div className={e.enCurso ? "cursor-claude" : undefined}>
          <Markdown texto={e.texto} />
        </div>
      );
    case "herramienta": {
      const [nombre, Icono] = herramienta(e.nombre);
      return (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-borde px-[9px] py-[5px] text-[12px] text-tenue">
          <Icono size={13} strokeWidth={1.8} className="flex-none" />
          <b className="flex-none font-semibold text-texto">{nombre}</b>
          <span title={e.resumen} className="min-w-0 truncate font-mono text-[11.5px]">
            {relativa(e.resumen, carpeta)}
          </span>
          <span className="ml-auto flex-none">
            {e.estado === "ejecutando" ? (
              <Loader2 size={13} className="animate-spin text-muy" />
            ) : e.estado === "ok" ? (
              <Check size={13} className="text-ok" />
            ) : (
              <X size={13} className="text-mal" />
            )}
          </span>
        </div>
      );
    }
    case "permiso":
      return <Permiso e={e} espacio={espacio} carpeta={carpeta} />;
    case "error":
      return (
        <p className="select-text whitespace-pre-wrap break-words rounded-lg border border-mal/25 bg-mal/[0.04] px-[9px] py-1.5 font-mono text-[11.5px] text-mal">
          {e.texto}
        </p>
      );
  }
}

function CajaEntrada({ espacio, ocupado, permiso }: { espacio: string; ocupado: boolean; permiso: number | null }) {
  const [texto, setTexto] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  // Crece con el texto hasta unas 8 líneas.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 170)}px`;
  }, [texto]);

  const mandar = () => {
    const t = texto.trim();
    if (!t || ocupado) return;
    setTexto("");
    void enviar(espacio, t);
  };

  return (
    <div className="flex-none border-t border-borde px-3 pb-3 pt-2.5">
      <div className="relative rounded-[10px] border border-borde2 bg-fondo focus-within:border-[#3a3a42]">
        <textarea
          id={ID_ENTRADA}
          ref={area}
          rows={2}
          value={texto}
          spellCheck={false}
          placeholder={permiso !== null ? "Intro permite · Esc deniega · o escribe qué hacer en su lugar" : "Escribe a Claude"}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (permiso !== null) {
              // Con texto, Intro deniega y le dice a Claude qué hacer en su lugar; sin texto
              // (y con Esc) lo resuelve el panel.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && texto.trim()) {
                e.preventDefault();
                const t = texto.trim();
                setTexto("");
                void responder(espacio, permiso, "denegar", t);
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              mandar();
            } else if (e.key === "Escape" && ocupado) {
              e.preventDefault();
              parar(espacio);
            }
          }}
          className="block min-h-[58px] w-full resize-none bg-transparent py-[9px] pl-2.5 pr-11 text-[13px] text-texto outline-none placeholder:text-muy"
        />
        {ocupado ? (
          <button
            type="button"
            title="Parar (Esc)"
            onClick={() => parar(espacio)}
            className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-lg bg-hover text-texto hover:bg-borde2"
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            title="Enviar (Intro)"
            onClick={mandar}
            disabled={!texto.trim()}
            className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-lg bg-texto text-fondo disabled:bg-hover disabled:text-muy"
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  );
}

function EstadoTurno({ c }: { c: Conversacion }) {
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  const [, tic] = useState(0);
  useEffect(() => {
    if (!ocupado) return;
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ocupado]);

  if (ocupado) {
    return (
      <span className="flex items-center gap-1.5 text-claude2">
        <Loader2 size={11} className="animate-spin" />
        {c.estado === "arrancando" ? "Arrancando" : "Pensando"} · {segundos(Date.now() - c.desde)}
      </span>
    );
  }
  if (c.estado === "listo") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-ok" />
        Listo{c.duracion > 0 && ` · ${segundos(c.duracion)}`}
      </span>
    );
  }
  if (c.estado === "cerrado") return <span>Cerrado</span>;
  return <span>Intro para enviar · Mayús+Intro, nueva línea</span>;
}
