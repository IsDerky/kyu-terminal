import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import type { Terminal } from "@xterm/xterm";
import { ArrowUpRight, Ban, Check, Copy, GitBranch, ListX, MemoryStick, X } from "lucide-react";
import { useProblemas } from "../lib/problemas";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { matarProceso, quienEnPuerto } from "../lib/nucleo";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { duracion, textoBloque, textoRam, type Bloque, type Bloques } from "../lib/bloques";
import type { Autocompletado } from "../lib/autocompletado";
import { adjuntar, nombreAgente, useAgenteDestino } from "../lib/claude";
import { useKyu } from "../lib/estado";
import { IconoAgente } from "./iconos";

/** Abre el panel de Claude con la orden y su salida adjuntas, listo para preguntar. */
function preguntarAClaude(term: Terminal, b: Bloque) {
  const t = textoBloque(term, b);
  if (!t) return;
  adjuntar(useKyu.getState().activo, t);
}

interface Props {
  term: Terminal;
  bloques: Bloques;
  auto: Autocompletado | null;
  fuente: string;
  tamano: number;
}

/** Margen a la izquierda del terminal donde va la franja de color. */
const MARGEN = 14;

const COLOR: Record<Bloque["estado"], string> = {
  ok: "var(--color-ok)",
  mal: "var(--color-mal)",
  corre: "var(--color-acento)",
  escribiendo: "var(--color-borde2)",
  vacio: "var(--color-borde2)",
};

const COLOR_FLECHA: Record<Bloque["estado"], string> = {
  ok: "var(--color-ok)",
  mal: "var(--color-mal)",
  corre: "var(--color-acento2)",
  escribiendo: "var(--color-ok)",
  vacio: "var(--color-muy)",
};

/**
 * Capa por encima de xterm: el título de cada bloque (en la línea vacía que deja el
 * prompt), la franja de color del lateral y la flecha «›». No recibe clics.
 */
export default function CapaBloques({ term, bloques, auto, fuente, tamano }: Props) {
  useSyncExternalStore(bloques.suscribir, bloques.version);
  useSyncExternalStore(auto?.suscribir ?? sinCambios, auto?.version ?? cero);
  const [, setCuadro] = useState(0);

  // Redibujar cuando xterm pinta, se desplaza o cambia de tamaño (una vez por cuadro).
  useEffect(() => {
    let f = 0;
    const pedir = () => {
      cancelAnimationFrame(f);
      f = requestAnimationFrame(() => setCuadro((c) => c + 1));
    };
    const quitar = [
      term.onRender(pedir),
      term.onResize(pedir),
      term.onScroll(pedir),
      term.buffer.onBufferChange(pedir),
    ];
    pedir();
    return () => {
      cancelAnimationFrame(f);
      quitar.forEach((d) => d.dispose());
    };
  }, [term]);

  const pantalla = term.element?.querySelector<HTMLElement>(".xterm-screen");
  const buffer = term.buffer.active;
  // En vim, less… (pantalla alternativa) no hay bloques.
  if (!pantalla || buffer.type !== "normal" || term.rows === 0) return null;

  const alto = pantalla.offsetHeight / term.rows;
  const ancho = pantalla.offsetWidth;
  const arriba = buffer.viewportY;
  const cursor = buffer.baseY + buffer.cursorY;
  const lista = bloques.lista;

  const visibles = lista.flatMap((b, i) => {
    const desde = b.inicio.line;
    if (desde < 0) return [];
    const sig = lista[i + 1];
    let hasta: number;
    if (b.fin && b.fin.line >= 0) hasta = b.fin.line - 1;
    else if (sig && sig.inicio.line >= 0) hasta = sig.inicio.line - 2; // la línea en blanco de separación
    else hasta = cursor;
    hasta = Math.max(hasta, desde + 1);
    const fila = desde - arriba;
    const filaFin = hasta - arriba;
    if (filaFin < 0 || fila >= term.rows) return [];
    return [{ b, fila, filaFin }];
  });

  return (
    <div
      className="pointer-events-none absolute top-0 z-20 overflow-hidden"
      style={{ left: -MARGEN, width: ancho + MARGEN, height: pantalla.offsetHeight }}
    >
      {visibles.map(({ b, fila, filaFin }) => (
        <Fragment key={b.id}>
          <div
            className="absolute rounded-full"
            style={{
              left: 2,
              width: 3,
              top: fila * alto + 3,
              height: (filaFin - fila + 1) * alto - 6,
              background: COLOR[b.estado],
            }}
          />
          <Titulo
            b={b}
            onPreguntar={() => preguntarAClaude(term, b)}
            style={{ left: MARGEN, width: ancho, top: fila * alto, height: alto }}
          />
          <span
            className="absolute"
            style={{
              left: MARGEN,
              top: (fila + 1) * alto,
              lineHeight: `${alto}px`,
              fontFamily: fuente,
              fontSize: tamano,
              color: COLOR_FLECHA[b.estado],
            }}
          >
            ›
          </span>
        </Fragment>
      ))}
      {auto && <Fantasma term={term} auto={auto} alto={alto} ancho={ancho} fuente={fuente} tamano={tamano} />}
    </div>
  );
}

const sinCambios = () => () => {};
const cero = () => 0;

/** La sugerencia en gris, en las celdas que siguen al cursor (cortada al final de la línea). */
function Fantasma({
  term,
  auto,
  alto,
  ancho,
  fuente,
  tamano,
}: {
  term: Terminal;
  auto: Autocompletado;
  alto: number;
  ancho: number;
  fuente: string;
  tamano: number;
}) {
  const f = auto.fantasma();
  const buf = term.buffer.active;
  // Solo con el historial abajo del todo (si has subido a leer, el cursor no se ve).
  if (!f || buf.viewportY !== buf.baseY) return null;
  const celda = ancho / term.cols;
  const caben = term.cols - buf.cursorX;
  const letras = [...f.resto].slice(0, Math.max(0, caben));
  if (!letras.length) return null;
  return (
    <div
      className={`absolute flex items-center whitespace-pre ${f.deClaude ? "text-claude2/70" : "text-muy"}`}
      style={{
        left: MARGEN + buf.cursorX * celda,
        top: buf.cursorY * alto,
        height: alto,
        fontFamily: fuente,
        fontSize: tamano,
      }}
    >
      {letras.map((l, i) => (
        <span key={i} className="inline-block text-center" style={{ width: celda }}>
          {l}
        </span>
      ))}
      {f.deClaude && caben - letras.length > 12 && (
        <span className="ml-3 rounded-full border border-claude/40 bg-claude/10 px-1.5 font-ui text-[10.5px] leading-[16px] text-claude2">
          Claude · Tab
        </span>
      )}
      {f.total > 1 && caben - letras.length > 6 && (
        <span className="ml-3 font-ui text-[10.5px] tabular-nums text-muy/70">
          {f.indice + 1}/{f.total}
        </span>
      )}
    </div>
  );
}

function Titulo({
  b,
  onPreguntar,
  style,
}: {
  b: Bloque;
  onPreguntar: () => void;
  style: React.CSSProperties;
}) {
  const terminado = (b.estado === "ok" || b.estado === "mal") && !!b.fin;
  const padre = b.padre.replace(/[\\/]$/, "");
  return (
    <div className="absolute flex items-center gap-2 whitespace-nowrap text-[12px]" style={style}>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[13.5px] font-semibold text-texto">{b.hoja || "…"}</span>
        {padre && <span className="text-[12px] text-muy">{padre}</span>}
      </span>
      {b.rama && (
        <Pastilla>
          <GitBranch size={12} strokeWidth={1.9} />
          {b.rama}
          {b.cambios > 0 && <span className="text-aviso">±{b.cambios}</span>}
        </Pastilla>
      )}
      {b.ram !== null && (
        <Pastilla titulo="RAM del equipo en uso">
          <MemoryStick size={12} strokeWidth={1.9} />
          <span className="tabular-nums">{textoRam(b.ram)}</span>
        </Pastilla>
      )}
      <span className="ml-auto flex items-center gap-3.5 pr-1 text-tenue">
        {/* Solo mientras corre: al parar el servidor el enlace ya no lleva a nada. */}
        {b.estado === "corre" && b.locales?.map((url) => (
          <button
            key={url}
            type="button"
            title={`Abrir ${url} en el navegador`}
            onClick={() => void openUrl(url)}
            onMouseDown={(e) => e.preventDefault()}
            className="pointer-events-auto flex h-[19px] items-center gap-1 rounded-full border border-acento/40 bg-acento/10 px-2 text-[11.5px] text-acento2 transition-colors hover:border-acento hover:bg-acento/20"
          >
            <ArrowUpRight size={12} strokeWidth={2} />
            {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </button>
        ))}
        {b.ocupado && <PuertoOcupado puerto={b.ocupado} />}
        {terminado && b.problemas && <PastillaProblemas b={b} />}
        {(terminado || b.estado === "corre") && b.orden?.trim() && <CopiarOrden orden={b.orden.trim()} />}
        {terminado && <PreguntarPorBloque onPreguntar={onPreguntar} />}
        <Resultado b={b} />
        <span className="tabular-nums text-muy">{b.hora}</span>
      </span>
    </div>
  );
}

/** «3 errores · 1 aviso»: abre el panel de problemas con los de este bloque. */
/**
 * El icono fijo en cada bloque terminado; al pasar por encima se despliega. Va a la última
 * conversación del espacio, así que lleva el icono y el nombre de quien contesta en ella.
 */
function PreguntarPorBloque({ onPreguntar }: { onPreguntar: () => void }) {
  const espacio = useKyu((s) => s.activo);
  const agente = useAgenteDestino(espacio);
  const quien = nombreAgente({ agente });
  return (
    <button
      type="button"
      title={`Preguntar a ${quien} por esta orden`}
      onClick={onPreguntar}
      onMouseDown={(e) => e.preventDefault()}
      className={`group/claude pointer-events-auto flex h-[19px] items-center gap-1.5 rounded-full border border-transparent px-1.5 text-[11.5px] transition-colors ${
        agente ? "text-sky-300 hover:border-sky-400/50 hover:bg-sky-400/10" : "text-claude2 hover:border-claude/50 hover:bg-claude/10"
      }`}
    >
      <span className="opacity-55 transition-opacity group-hover/claude:opacity-100">
        <IconoAgente agente={agente} alto={10} />
      </span>
      <span className="hidden group-hover/claude:inline">Preguntar a {quien}</span>
    </button>
  );
}

function PastillaProblemas({ b }: { b: Bloque }) {
  const lista = b.problemas ?? [];
  const errores = lista.filter((p) => p.nivel === "error").length;
  const avisos = lista.length - errores;
  const partes = [
    errores ? `${errores} ${errores === 1 ? "error" : "errores"}` : "",
    avisos ? `${avisos} ${avisos === 1 ? "aviso" : "avisos"}` : "",
  ].filter(Boolean);
  const abrir = () => {
    const k = useKyu.getState();
    useProblemas.getState().poner(k.activo, { orden: b.orden ?? "", carpeta: b.ruta, hora: b.hora, lista });
    k.abrirProblemas();
  };
  return (
    <button
      type="button"
      title="Ver los problemas y abrirlos en su línea"
      onClick={abrir}
      onMouseDown={(e) => e.preventDefault()}
      className={`pointer-events-auto flex h-[19px] items-center gap-1 rounded-full border px-2 text-[11.5px] transition-colors ${
        errores ? "border-mal/40 bg-mal/10 text-mal hover:border-mal" : "border-aviso/40 bg-aviso/10 text-aviso hover:border-aviso"
      }`}
    >
      <ListX size={12} strokeWidth={2} />
      {partes.join(" · ")}
    </button>
  );
}

/** «:3000 ocupado»: dice quién lo tiene y, tras confirmar, lo cierra. */
function PuertoOcupado({ puerto }: { puerto: number }) {
  const [estado, setEstado] = useState<"" | "buscando" | "libre" | "cerrado" | "error">("");
  useEffect(() => {
    if (estado !== "libre" && estado !== "error") return;
    const t = setTimeout(() => setEstado(""), 2500);
    return () => clearTimeout(t);
  }, [estado]);

  const cerrar = async () => {
    setEstado("buscando");
    const p = await quienEnPuerto(puerto).catch(() => null);
    if (!p) return setEstado("libre");
    const si = await ask(`El puerto ${puerto} lo tiene ${p.nombre} (PID ${p.pid}).\n\n¿Cerrarlo? Se cierran también los procesos que lanzó.`, {
      title: "Puerto ocupado",
      kind: "warning",
      okLabel: "Cerrar proceso",
      cancelLabel: "Cancelar",
    });
    if (!si) return setEstado("");
    try {
      await matarProceso(p.pid);
      setEstado("cerrado");
    } catch {
      setEstado("error");
    }
  };

  const texto =
    estado === "buscando" ? "buscando…"
    : estado === "libre" ? `:${puerto} ya está libre`
    : estado === "cerrado" ? `:${puerto} libre, vuelve a lanzarlo`
    : estado === "error" ? "no se pudo cerrar"
    : `:${puerto} ocupado · cerrar`;
  return (
    <button
      type="button"
      title={`Ver quién usa el puerto ${puerto} y cerrarlo`}
      disabled={estado === "buscando" || estado === "cerrado"}
      onClick={() => void cerrar()}
      onMouseDown={(e) => e.preventDefault()}
      className={`pointer-events-auto flex h-[19px] items-center gap-1 rounded-full border px-2 text-[11.5px] transition-colors ${
        estado === "cerrado"
          ? "border-ok/40 bg-ok/10 text-ok"
          : "border-mal/40 bg-mal/10 text-mal hover:border-mal hover:bg-mal/20"
      }`}
    >
      {estado === "cerrado" ? <Check size={12} strokeWidth={2} /> : <Ban size={12} strokeWidth={2} />}
      {texto}
    </button>
  );
}

/** Copia la orden del bloque al portapapeles; un momento «Copiada» para saber que ha ido. */
function CopiarOrden({ orden }: { orden: string }) {
  const [copiada, setCopiada] = useState(false);
  useEffect(() => {
    if (!copiada) return;
    const t = setTimeout(() => setCopiada(false), 1400);
    return () => clearTimeout(t);
  }, [copiada]);
  return (
    <button
      type="button"
      title={`Copiar la orden: ${orden}`}
      onClick={() => void writeText(orden).then(() => setCopiada(true))}
      onMouseDown={(e) => e.preventDefault()}
      className={`group/copiar pointer-events-auto flex h-[19px] items-center gap-1.5 rounded-full border px-1.5 text-[11.5px] transition-colors ${
        copiada ? "border-ok/40 bg-ok/10 text-ok" : "border-transparent text-tenue hover:border-borde2 hover:bg-hover hover:text-texto"
      }`}
    >
      {copiada ? (
        <>
          <Check size={12} strokeWidth={2} />
          Copiada
        </>
      ) : (
        <>
          <span className="opacity-55 transition-opacity group-hover/copiar:opacity-100">
            <Copy size={12} strokeWidth={1.9} />
          </span>
          <span className="hidden group-hover/copiar:inline">Copiar orden</span>
        </>
      )}
    </button>
  );
}

function Resultado({ b }: { b: Bloque }) {
  if (b.estado === "ok" && b.durMs !== undefined)
    return (
      <span className="flex items-center gap-1 text-ok">
        <Check size={13} strokeWidth={2} />
        {duracion(b.durMs)}
      </span>
    );
  if (b.estado === "mal" && b.durMs !== undefined)
    return (
      <span className="flex items-center gap-1 text-mal">
        <X size={13} strokeWidth={2} />
        código {b.codigo} · {duracion(b.durMs)}
      </span>
    );
  if (b.estado === "corre" && b.tInicio !== undefined)
    return (
      <span className="flex items-center gap-1.5 text-acento2">
        <span className="size-1.5 rounded-full bg-acento" />
        ejecutando · {Math.floor((performance.now() - b.tInicio) / 1000)} s
      </span>
    );
  return null;
}

function Pastilla({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <span
      title={titulo}
      className="flex h-[19px] items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-2 text-[11.5px] text-tenue"
    >
      {children}
    </span>
  );
}
