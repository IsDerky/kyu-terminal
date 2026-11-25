import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, FolderOpen, History, ImageIcon, Info, Loader2, Maximize2, Minimize2, Plus, Square, SquarePen, SquareSplitHorizontal, SquareTerminal, TextQuote, X } from "lucide-react";
import {
  activarPestana,
  añadirImagenes,
  conversacionEnPanel,
  sacarAPanel,
  cargarCatalogo,
  cerrarPestana,
  nuevaPestana,
  pestanasDe,
  tituloDe,
  carpetaDelEspacio,
  enviar,
  limiteContexto,
  parar,
  pendiente,
  nombreSeleccion,
  quitarAdjunto,
  quitarImagen,
  quitarSeleccion,
  refrescarContexto,
  responder,
  siguienteModo,
  tomarBorrador,
  useClaude,
  vacia,
  ID_ENTRADA,
  type Conversacion,
  type Entrada,
  type Seleccion,
} from "../lib/claude";
import type { Comando } from "../lib/claudeOpciones";
import {
  AvisoLimite,
  BarraOpciones,
  DesgloseContexto,
  filtrarComandos,
  LimiteCuenta,
  MenuComandos,
  SelectorCuenta,
} from "./ControlesClaude";
import { ListaSesiones, mencionEnCursor, MenuArchivos, Miniaturas, Recientes } from "./AdjuntosClaude";
import { imagenesDe, type ImagenAdjunta } from "../lib/imagenes";
import { buscarArchivos } from "../lib/nucleo";
import type { TextoBloque } from "../lib/bloques";
import { useKyu } from "../lib/estado";
import { herramienta, relativa } from "../lib/herramientas";
import Markdown from "./Markdown";
import Permiso from "./Permiso";
import { BotonVerCambios, PasosSubagente, Plan, Razonamiento, ResumenCambios, VolverAqui } from "./TandaClaude";
import { Mascota } from "./iconos";
import { corto, useGasto } from "../lib/gasto";


const SIN_COMANDOS: Comando[] = [];
const SIN_IMAGENES: ImagenAdjunta[] = [];

const nombreCarpeta = (ruta: string | null) => (ruta ? ruta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ruta : "~");

const dolares = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }) + " $";

const segundos = (ms: number) => (ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: ms < 10_000 ? 1 : 0 }) + " s";

/**
 * Panel de Claude: la conversación que se ve del espacio activo (puede tener varias, en
 * pestañas). A la derecha o, en modo expandido, delante y los terminales en una columna.
 */
export default function PanelClaude({
  espacio: espacioReal,
  conversacion: fija,
  conFoco = false,
}: {
  espacio: string;
  /** Conversación de una pestaña de panel: se enseña esa, sin el marco del panel lateral. */
  conversacion?: string;
  /** En una pestaña: su panel tiene el foco (entonces el cursor va a la caja). */
  conFoco?: boolean;
}) {
  // Desde aquí, `espacio` es el id de la conversación que se ve (las funciones de Claude
  // trabajan con él); `espacioReal` es el espacio de trabajo.
  const enPanel = fija !== undefined;
  const lateral = useClaude((s) => s.activas[espacioReal] ?? espacioReal);
  const espacio = fija ?? lateral;
  const expandido = useClaude((s) => s.expandido);
  const grande = enPanel || expandido;
  const conv = useClaude((s) => s.conversaciones[espacio]);
  const prefs = useClaude((s) => s.prefs);
  const verContextoLateral = useClaude((s) => s.verContexto);
  const [verContextoPropio, setVerContextoPropio] = useState(false);
  const verContexto = enPanel ? verContextoPropio : verContextoLateral;
  const ponerVerContexto = (v: boolean) => (enPanel ? setVerContextoPropio(v) : useClaude.setState({ verContexto: v }));
  // Antes de arrancar, la carpeta que se usará (sigue al terminal con el foco).
  const carpetaFoco = useKyu(() => carpetaDelEspacio(espacioReal));
  const c: Conversacion = conv ?? vacia(prefs);
  const carpeta = c.claudeId !== null || c.estado === "cerrado" || c.reanudar ? c.carpeta : carpetaFoco;
  const [verSesiones, setVerSesiones] = useState(false);
  const [soltando, setSoltando] = useState(false);
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
      void responder(espacio, permiso.id, "permitir", undefined, permiso.herramienta === "ExitPlanMode" ? "acceptEdits" : undefined);
    }
  };

  return (
    <aside
      onKeyDown={teclas}
      // Soltar imágenes en cualquier parte del panel.
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setSoltando(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setSoltando(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setSoltando(false);
        void imagenesDe(e.dataTransfer.files).then((l) => añadirImagenes(espacio, l));
      }}
      className={
        enPanel
          ? "group/claude relative flex h-full w-full flex-col overflow-hidden bg-panel"
          : `group/claude relative m-2 flex flex-col overflow-hidden rounded-[10px] border border-claude/40 bg-panel shadow-[0_0_0_3px_#d977570a,0_20px_50px_-25px_#d9775733] ${
              grande ? "order-first min-w-0 flex-1" : "ml-0 w-[380px] flex-none"
            }`
      }>
      <header className="flex h-11 flex-none items-center gap-2 border-b border-borde pl-3.5 pr-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Mascota alto={15} />
          {/* En el panel estrecho, solo la mascota: el sitio es para la carpeta. */}
          {grande && !enPanel && "Claude"}
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
            ponerVerContexto(!verContexto);
            if (!verContexto) void refrescarContexto(espacio);
          }}
          className={`ml-auto flex h-7 flex-none items-center gap-1.5 rounded-md px-1.5 text-[11px] text-tenue hover:bg-hover ${verContexto ? "bg-hover" : ""}`}
        >
          <span className="h-[5px] w-9 overflow-hidden rounded-full bg-hover">
            <span className="block h-full rounded-full bg-claude" style={{ width: `${porcentaje}%` }} />
          </span>
          {porcentaje} %
        </button>
        <span data-boton-sesiones>
          <BotonCabecera titulo="Conversaciones anteriores" onClick={() => setVerSesiones((v) => !v)}>
            <History size={14} strokeWidth={1.8} />
          </BotonCabecera>
        </span>
        {enPanel ? (
          <BotonCabecera titulo="Otra conversación en una pestaña de este panel (Ctrl+Mayús+K)" onClick={() => conversacionEnPanel(espacioReal)}>
            <SquarePen size={14} strokeWidth={1.8} />
          </BotonCabecera>
        ) : (
          <>
            <BotonCabecera titulo="Nueva conversación, en otra pestaña" onClick={() => nuevaPestana(espacioReal)}>
              <SquarePen size={14} strokeWidth={1.8} />
            </BotonCabecera>
            <BotonCabecera
              titulo={ocupado ? "Espera a que Claude acabe para moverla" : "Abrir esta conversación en un panel, al lado de los terminales"}
              onClick={() => !ocupado && void sacarAPanel(espacioReal)}
            >
              <SquareSplitHorizontal size={14} strokeWidth={1.8} className={ocupado ? "opacity-40" : ""} />
            </BotonCabecera>
            <BotonCabecera
              titulo={grande ? "Volver al panel lateral (Ctrl+Mayús+X)" : "Expandir: Claude delante (Ctrl+Mayús+X)"}
              onClick={() => useClaude.setState({ expandido: !grande })}
            >
              {grande ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
            </BotonCabecera>
            <BotonCabecera titulo="Ocultar (Ctrl+Mayús+C)" onClick={() => useClaude.getState().mostrar(false)}>
              <X size={15} strokeWidth={1.8} />
            </BotonCabecera>
          </>
        )}
      </header>

      {!enPanel && <PestanasConversacion espacio={espacioReal} actual={espacio} />}

      {verSesiones && (
        <ListaSesiones espacio={espacio} carpeta={carpeta} actual={c.sesion} alCerrar={() => setVerSesiones(false)} />
      )}
      {soltando && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-[10px] border-2 border-dashed border-claude/60 bg-panel/80">
          <span className="flex items-center gap-2 text-[13px] text-texto">
            <ImageIcon size={15} strokeWidth={1.8} /> Suelta las imágenes para Claude
          </span>
        </div>
      )}

      {verContexto && <DesgloseContexto espacio={espacio} c={c} alCerrar={() => ponerVerContexto(false)} />}

      <ListaEntradas espacio={espacio} c={c} carpeta={carpeta} grande={grande} />

      <AvisoLimite espacio={espacio} c={c} />

      <CajaEntrada principal={!enPanel} enfocar={enPanel && conFoco} grande={grande} espacio={espacio} c={c} carpeta={carpeta} ocupado={ocupado} permiso={permiso?.id ?? null} esPlan={permiso?.herramienta === "ExitPlanMode"} />

      <footer className="relative flex h-7 flex-none items-center gap-2 border-t border-borde px-3.5 text-[11px] text-muy">
        <EstadoTurno c={c} />
        <span className="ml-auto" />
        <SelectorCuenta espacio={espacio} c={c} />
        <LimiteCuenta c={c} />
        <BarraGasto />
        {c.coste > 0 && <span title="Coste de la conversación">{dolares(c.coste)}</span>}
      </footer>
    </aside>
  );
}

/** Pestañas de las conversaciones del espacio (solo si hay más de una). */
function PestanasConversacion({ espacio, actual }: { espacio: string; actual: string }) {
  const lista = useClaude((s) => s.pestanas[espacio]);
  const conversaciones = useClaude((s) => s.conversaciones);
  const ids = lista ?? pestanasDe(espacio);
  if (ids.length < 2) return null;
  return (
    <div className="flex h-8 flex-none items-center gap-0.5 overflow-x-auto border-b border-borde px-1.5 text-[12px]">
      {ids.map((cid) => {
        const conv = conversaciones[cid];
        const espera = pendiente(conv);
        const trabaja = conv?.estado === "pensando" || conv?.estado === "arrancando";
        const on = cid === actual;
        return (
          <div
            key={cid}
            onClick={() => activarPestana(cid)}
            onAuxClick={(e) => e.button === 1 && cerrarPestana(cid)}
            title={tituloDe(conv)}
            className={`group flex h-6 max-w-40 flex-none cursor-default items-center gap-1.5 rounded-md pl-2 pr-1 ${on ? "bg-hover text-texto" : "text-tenue hover:text-texto"}`}
          >
            {espera ? (
              <span title="Espera un permiso tuyo" className="size-1.5 flex-none rounded-full bg-aviso" />
            ) : trabaja ? (
              <Loader2 size={11} className="flex-none animate-spin text-claude2" />
            ) : null}
            <span className="truncate">{tituloDe(conv)}</span>
            <button
              type="button"
              title="Cerrar conversación"
              onClick={(e) => {
                e.stopPropagation();
                cerrarPestana(cid);
              }}
              className={`grid size-4 flex-none place-items-center rounded text-muy hover:bg-borde2 hover:text-texto ${on ? "" : "invisible group-hover:visible"}`}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        title="Nueva conversación"
        onClick={() => nuevaPestana(espacio)}
        className="grid size-6 flex-none place-items-center rounded-md text-muy hover:bg-hover hover:text-texto"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

/** Lo de hoy frente al límite diario (si hay límite): ámbar desde el 80 %, rojo al pasarlo. */
function BarraGasto() {
  const limite = useGasto((s) => s.limite);
  const hoy = useGasto((s) => s.hoy);
  if (!limite) return null;
  const p = hoy / limite;
  const color = p >= 1 ? "var(--color-mal)" : p >= 0.8 ? "var(--color-aviso)" : "var(--color-claude2)";
  return (
    <span
      className="flex flex-none items-center gap-1.5"
      title={`Hoy ${hoy.toLocaleString("es-ES")} tokens de salida de ${limite.toLocaleString("es-ES")} (límite diario, en Ajustes)`}
    >
      <span style={{ color: p >= 0.8 ? color : undefined }}>
        Hoy {corto(hoy)} / {corto(limite)}
      </span>
      <span className="h-[5px] w-12 overflow-hidden rounded-full bg-hover">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, p * 100)}%`, background: color }} />
      </span>
    </span>
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

function ListaEntradas({ espacio, c, carpeta, grande }: { espacio: string; c: Conversacion; carpeta: string | null; grande: boolean }) {
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
        <Mascota alto={34} />
        <p className="text-[14px] font-medium">¿En qué te ayudo?</p>
        <p className="text-[12px] leading-relaxed text-tenue">
          Claude trabajará en <span className="font-mono text-[11.5px] text-texto">{nombreCarpeta(carpeta)}</span>, la
          carpeta del terminal con el foco.
        </p>
        <Recientes espacio={espacio} carpeta={carpeta} />
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
        {c.estado === "cerrado" && (
          <p className="text-center text-[11.5px] text-muy">
            Claude se ha cerrado. Al escribir, sigue esta misma conversación.
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
        <div className={e.enCurso ? "cursor-claude" : undefined}>
          <Markdown texto={e.texto} />
        </div>
      );
    case "herramienta": {
      // El plan ya sale entero en su recuadro.
      if (e.nombre === "ExitPlanMode") return null;
      const [nombre, Icono] = herramienta(e.nombre);
      return (
        <div className="flex flex-col gap-1 rounded-lg border border-borde px-[9px] py-[5px]">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-tenue">
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
            {e.ruta && e.estado === "ok" && <BotonVerCambios espacio={espacio} ruta={e.ruta} />}
          </div>
          {e.pasos ? <PasosSubagente pasos={e.pasos} ultimo={e.estado === "ejecutando" ? e.ultimoPaso : undefined} carpeta={carpeta} /> : null}
        </div>
      );
    }
    case "permiso":
      return e.herramienta === "ExitPlanMode" ? <Plan e={e} espacio={espacio} /> : <Permiso e={e} espacio={espacio} carpeta={carpeta} />;
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

function RecuadroSeleccion({ s, onQuitar }: { s: Seleccion; onQuitar?: () => void }) {
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

function CajaEntrada({
  principal,
  enfocar = false,
  grande,
  espacio,
  c,
  carpeta,
  ocupado,
  permiso,
  esPlan,
}: {
  /** La del panel lateral: lleva el id al que los atajos dan el foco. */
  principal: boolean;
  /** Al pasar a true (su panel gana el foco), el cursor va a la caja. */
  enfocar?: boolean;
  espacio: string;
  c: Conversacion;
  carpeta: string | null;
  ocupado: boolean;
  permiso: number | null;
  /** El permiso pendiente es un plan (ExitPlanMode). */
  esPlan: boolean;
  grande: boolean;
}) {
  const [texto, setTexto] = useState("");
  const borrador = useClaude((s) => s.borradores[espacio]);
  useEffect(() => {
    if (borrador === undefined) return;
    const t = tomarBorrador(espacio) ?? "";
    setTexto(t);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(t.length, t.length);
    });
  }, [borrador, espacio]);
  useEffect(() => {
    // Sin robarle el foco a lo que ya esté dentro de este panel (texto seleccionado, botones).
    if (enfocar && !area.current?.closest("[data-panel]")?.contains(document.activeElement)) area.current?.focus();
  }, [enfocar]);
  const adjunto =useClaude((s) => s.adjuntos[espacio]);
  const imagenes = useClaude((s) => s.imagenes[espacio] ?? SIN_IMAGENES);
  const selector = useRef<HTMLInputElement>(null);
  // @archivo: lo escrito tras la @ del cursor, los archivos que encajan y cuál está elegido.
  const [cursor, setCursor] = useState(0);
  const [rutas, setRutas] = useState<string[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegidoA, setElegidoA] = useState(0);
  const [sinMenuA, setSinMenuA] = useState(false);
  const mencion = permiso === null && !sinMenuA && carpeta ? mencionEnCursor(texto, cursor) : null;
  const consulta = mencion?.[1] ?? null;
  const selA = Math.min(elegidoA, Math.max(0, rutas.length - 1));
  // La respuesta que propone Claude, solo con la caja vacía y nada pendiente.
  const seleccion = useClaude((s) => s.selecciones[espacio]);
  const sugerencia = permiso === null && !ocupado && !adjunto && !seleccion && !imagenes.length ? c.sugerencia : null;

  useEffect(() => {
    if (consulta === null || !carpeta) return;
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      buscarArchivos(carpeta, consulta)
        .then((r) => vivo && (setRutas(r), setElegidoA(0)))
        .catch(() => vivo && setRutas([]))
        .finally(() => vivo && setBuscando(false));
    }, 70);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [consulta, carpeta]);

  const ponerRuta = (ruta: string) => {
    if (!mencion) return;
    const [desde] = mencion;
    // Las rutas con espacios van entre comillas, como en `claude`.
    const r = /\s/.test(ruta) ? `"${ruta}"` : ruta;
    // En una carpeta se sigue escribiendo dentro de ella; en un archivo se cierra con un espacio.
    const pon = `@${r}${ruta.endsWith("/") ? "" : " "}`;
    const nuevo = texto.slice(0, desde) + pon + texto.slice(cursor);
    setTexto(nuevo);
    const pos = desde + pon.length;
    setCursor(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  const insertar = (s: string) => {
    const el = area.current;
    const pos = el?.selectionStart ?? texto.length;
    const antes = texto.slice(0, pos);
    const hueco = antes && !/\s$/.test(antes) ? " " : "";
    const nuevo = antes + hueco + s + texto.slice(pos);
    const fin = pos + hueco.length + s.length;
    setTexto(nuevo);
    setCursor(fin);
    setSinMenuA(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(fin, fin);
    });
  };
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
    if ((!t && !adjunto && !seleccion && !imagenes.length) || ocupado) return;
    setTexto("");
    void enviar(espacio, t);
  };

  return (
    <div className={`flex-none border-t border-borde px-3 pb-3 pt-2.5 ${grande ? "border-t-0" : ""}`}>
      <div className={grande ? "mx-auto w-full max-w-[780px]" : undefined}>
      <div className="relative rounded-[10px] border border-borde2 bg-fondo focus-within:border-[#3a3a42]">
        {comandos && <MenuComandos comandos={comandos} elegido={sel} alElegir={completar} alPasar={setElegido} />}
        {!comandos && mencion && (
          <MenuArchivos rutas={rutas} elegido={selA} buscando={buscando} alElegir={ponerRuta} alPasar={setElegidoA} />
        )}
        {imagenes.length > 0 && <Miniaturas imagenes={imagenes} alQuitar={(id) => quitarImagen(espacio, id)} />}
        {adjunto && (
          <div className="flex px-2 pt-2">
            <RecuadroOrden a={adjunto} onQuitar={() => quitarAdjunto(espacio)} />
          </div>
        )}
        {seleccion && (
          <div className="flex px-2 pt-2">
            <RecuadroSeleccion s={seleccion} onQuitar={() => quitarSeleccion(espacio)} />
          </div>
        )}
        <textarea
          id={principal ? ID_ENTRADA : undefined}
          ref={area}
          rows={2}
          value={texto}
          spellCheck={false}
          placeholder={
            permiso !== null
              ? esPlan
                ? "Intro aprueba · Esc sigue planificando · o escribe qué cambiar"
                : "Intro permite · Esc deniega · o escribe qué hacer en su lugar"
              : adjunto
                ? "Pregunta sobre esta orden, o Intro para que la revise"
                : seleccion
                  ? "Pregunta sobre la selección, o Intro para que la explique"
                  : imagenes.length
                  ? "Pregunta sobre la imagen"
                  : sugerencia
                    ? `${sugerencia}  · Tab`
                    : "Escribe a Claude · @ archivos · / comandos"
          }
          onChange={(e) => {
            setTexto(e.target.value);
            setCursor(e.target.selectionStart);
            setElegido(0);
            setSinMenu(false);
            setSinMenuA(false);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const archivos = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (!archivos.length) return;
            e.preventDefault();
            void imagenesDe(archivos).then((l) => añadirImagenes(espacio, l));
          }}
          onKeyDown={(e) => {
            // Menú de archivos abierto: lo mismo que el de comandos.
            if (!comandos && mencion && rutas.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setElegidoA((selA + d + rutas.length) % rutas.length);
                return;
              }
              if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
                e.preventDefault();
                ponerRuta(rutas[selA]);
                return;
              }
            }
            // Mientras busca, Tab no saca el foco de la caja.
            if (!comandos && mencion && e.key === "Tab") {
              e.preventDefault();
              return;
            }
            if (!comandos && mencion && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setSinMenuA(true);
              return;
            }
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
            // Caja vacía con una sugerencia de Claude: Tab la escribe (para mandarla o retocarla).
            if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && sugerencia && !texto) {
              e.preventDefault();
              setTexto(sugerencia);
              setCursor(sugerencia.length);
              requestAnimationFrame(() => area.current?.setSelectionRange(sugerencia.length, sugerencia.length));
              return;
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
          alArroba={() => insertar("@")}
          alImagen={() => selector.current?.click()}
        />
        <input
          ref={selector}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void imagenesDe(e.target.files).then((l) => añadirImagenes(espacio, l));
            e.target.value = "";
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
            disabled={!texto.trim() && !adjunto && !seleccion && !imagenes.length}
            className="absolute bottom-1 right-1.5 grid size-6 place-items-center rounded-lg bg-texto text-fondo disabled:bg-hover disabled:text-muy"
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        )}
      </div>
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
  return <span className="min-w-0 truncate">Intro envía · Mayús+Intro, nueva línea · / comandos</span>;
}
