import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, FolderOpen, Info, Loader2, Square, SquarePen, SquareTerminal, X } from "lucide-react";
import {
  cargarCatalogo,
  carpetaDelEspacio,
  enviar,
  limiteContexto,
  nueva,
  parar,
  pendiente,
  quitarAdjunto,
  refrescarContexto,
  responder,
  siguienteModo,
  useClaude,
  vacia,
  type Conversacion,
  type Entrada,
} from "../lib/claude";
import type { Comando } from "../lib/claudeOpciones";
import { BarraOpciones, DesgloseContexto, filtrarComandos, MenuComandos } from "./ControlesClaude";
import type { TextoBloque } from "../lib/bloques";
import { useKyu } from "../lib/estado";
import { herramienta, relativa } from "../lib/herramientas";
import Markdown from "./Markdown";
import Permiso from "./Permiso";
import { Mascota } from "./iconos";

export const ID_ENTRADA = "entrada-claude";

const SIN_COMANDOS: Comando[] = [];

const nombreCarpeta = (ruta: string | null) => (ruta ? ruta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ruta : "~");

const dolares = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }) + " $";

const segundos = (ms: number) => (ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: ms < 10_000 ? 1 : 0 }) + " s";

/** Panel de Claude a la derecha: conversación del espacio activo con Claude Code. */
export default function PanelClaude({ espacio }: { espacio: string }) {
  const conv = useClaude((s) => s.conversaciones[espacio]);
  const prefs = useClaude((s) => s.prefs);
  const verContexto = useClaude((s) => s.verContexto);
  // Antes de arrancar, la carpeta que se usará (sigue al terminal con el foco).
  const carpetaFoco = useKyu(() => carpetaDelEspacio(espacio));
  const c: Conversacion = conv ?? vacia(prefs);
  const carpeta = c.claudeId !== null || c.estado === "cerrado" ? c.carpeta : carpetaFoco;
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  const limite = limiteContexto(c);
  const porcentaje = Math.min(100, Math.round((c.tokens / limite) * 100));
  const permiso = pendiente(conv);

  // La primera vez que se abre el panel, comandos y modelos para los menús.
  useEffect(() => {
    void cargarCatalogo(carpetaFoco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mayús+Tab cambia de modo (como en `claude` y en VS Code). Con un permiso pendiente y el
  // foco en el panel: Intro permite, Esc deniega. La caja de texto lo resuelve antes (con
  // texto, Intro deniega y se lo dice a Claude).
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented) {
      e.preventDefault();
      siguienteModo(espacio);
      return;
    }
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
      className="group/claude relative m-2 ml-0 flex w-[380px] flex-none flex-col overflow-hidden rounded-[10px] border border-claude/40 bg-panel shadow-[0_0_0_3px_#d977570a,0_20px_50px_-25px_#d9775733]">
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
        <button
          type="button"
          data-boton-contexto
          title={`Contexto: ${c.tokens.toLocaleString("es-ES")} de ${limite.toLocaleString("es-ES")} tokens · clic para el desglose`}
          onClick={() => {
            const ver = !useClaude.getState().verContexto;
            useClaude.setState({ verContexto: ver });
            if (ver) void refrescarContexto(espacio);
          }}
          className={`ml-auto flex h-7 flex-none items-center gap-1.5 rounded-md px-1.5 text-[11px] text-tenue hover:bg-hover ${verContexto ? "bg-hover" : ""}`}
        >
          <span className="h-[5px] w-12 overflow-hidden rounded-full bg-hover">
            <span className="block h-full rounded-full bg-claude" style={{ width: `${porcentaje}%` }} />
          </span>
          {porcentaje} %
        </button>
        <BotonCabecera titulo="Nueva conversación" onClick={() => nueva(espacio)}>
          <SquarePen size={14} strokeWidth={1.8} />
        </BotonCabecera>
        <BotonCabecera titulo="Ocultar (Ctrl+Mayús+C)" onClick={() => useClaude.getState().mostrar(false)}>
          <X size={15} strokeWidth={1.8} />
        </BotonCabecera>
      </header>

      {verContexto && <DesgloseContexto espacio={espacio} c={c} alCerrar={() => useClaude.setState({ verContexto: false })} />}

      <ListaEntradas espacio={espacio} c={c} carpeta={carpeta} />

      <CajaEntrada espacio={espacio} c={c} ocupado={ocupado} permiso={permiso?.id ?? null} />

      <footer className="flex h-7 flex-none items-center gap-2 border-t border-borde px-3.5 text-[11px] text-muy">
        <EstadoTurno c={c} />
        <span className="ml-auto truncate" title="Modelo que contesta">{c.modelo.replace(/^claude-/, "")}</span>
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
        <div className="flex max-w-[88%] flex-col items-end gap-1.5 self-end">
          {e.adjunto && <RecuadroOrden a={e.adjunto} />}
          <div className="select-text whitespace-pre-wrap break-words rounded-[12px_12px_4px_12px] border border-borde bg-tarjeta px-[11px] py-2">
            {e.texto}
          </div>
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
function RecuadroOrden({ a, onQuitar }: { a: TextoBloque; onQuitar?: () => void }) {
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

function CajaEntrada({
  espacio,
  c,
  ocupado,
  permiso,
}: {
  espacio: string;
  c: Conversacion;
  ocupado: boolean;
  permiso: number | null;
}) {
  const [texto, setTexto] = useState("");
  const adjunto = useClaude((s) => s.adjuntos[espacio]);
  const lista = useClaude((s) => s.catalogo?.commands ?? SIN_COMANDOS);
  const area = useRef<HTMLTextAreaElement>(null);
  const [elegido, setElegido] = useState(0);
  const [sinMenu, setSinMenu] = useState(false);
  const comandos = permiso === null && !sinMenu ? filtrarComandos(lista, texto) : null;
  const sel = comandos ? Math.min(elegido, Math.max(0, comandos.length - 1)) : 0;

  const completar = (cmd: Comando) => {
    setTexto(`/${cmd.name} `);
    setElegido(0);
    area.current?.focus();
  };

  // Crece con el texto hasta unas 8 líneas.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 170)}px`;
  }, [texto]);

  const mandar = () => {
    const t = texto.trim();
    if ((!t && !adjunto) || ocupado) return;
    setTexto("");
    void enviar(espacio, t);
  };

  return (
    <div className="flex-none border-t border-borde px-3 pb-3 pt-2.5">
      <div className="relative rounded-[10px] border border-borde2 bg-fondo focus-within:border-[#3a3a42]">
        {comandos && <MenuComandos comandos={comandos} elegido={sel} alElegir={completar} alPasar={setElegido} />}
        {adjunto && (
          <div className="flex px-2 pt-2">
            <RecuadroOrden a={adjunto} onQuitar={() => quitarAdjunto(espacio)} />
          </div>
        )}
        <textarea
          id={ID_ENTRADA}
          ref={area}
          rows={2}
          value={texto}
          spellCheck={false}
          placeholder={
            permiso !== null
              ? "Intro permite · Esc deniega · o escribe qué hacer en su lugar"
              : adjunto
                ? "Pregunta sobre esta orden, o Intro para que la revise"
                : "Escribe a Claude"
          }
          onChange={(e) => {
            setTexto(e.target.value);
            setElegido(0);
            setSinMenu(false);
          }}
          onKeyDown={(e) => {
            // Menú de comandos abierto: flechas, Tab/Intro y Esc son suyos.
            if (comandos && comandos.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setElegido((sel + d + comandos.length) % comandos.length);
                return;
              }
              if ((e.key === "Tab" && !e.shiftKey) || (e.key === "Enter" && !e.shiftKey)) {
                const cmd = comandos[sel];
                // Intro sobre un comando ya escrito entero lo manda.
                if (!(e.key === "Enter" && texto.trim() === `/${cmd.name}`)) {
                  e.preventDefault();
                  completar(cmd);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSinMenu(true);
                return;
              }
            }
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
          className="block min-h-[44px] w-full resize-none bg-transparent pb-1 pl-2.5 pr-2.5 pt-[9px] text-[13px] text-texto outline-none placeholder:text-muy"
        />
        <BarraOpciones
          espacio={espacio}
          c={c}
          alBarra={() => {
            setTexto("/");
            setSinMenu(false);
            area.current?.focus();
          }}
        />
        {ocupado ? (
          <button
            type="button"
            title="Parar (Esc)"
            onClick={() => parar(espacio)}
            className="absolute bottom-1 right-1.5 grid size-6 place-items-center rounded-lg bg-hover text-texto hover:bg-borde2"
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            title="Enviar (Intro)"
            onClick={mandar}
            disabled={!texto.trim() && !adjunto}
            className="absolute bottom-1 right-1.5 grid size-6 place-items-center rounded-lg bg-texto text-fondo disabled:bg-hover disabled:text-muy"
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
        {c.compactando ? "Compactando" : c.estado === "arrancando" ? "Arrancando" : "Pensando"} · {segundos(Date.now() - c.desde)}
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
  return <span>Intro envía · Mayús+Intro, nueva línea · / comandos</span>;
}
