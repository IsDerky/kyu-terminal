import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Terminal } from "@xterm/xterm";
import { Check, GitBranch, MemoryStick, X } from "lucide-react";
import { duracion, textoBloque, textoRam, type Bloque, type Bloques } from "../lib/bloques";
import { adjuntar } from "../lib/claude";
import { useKyu } from "../lib/estado";
import { Mascota } from "./iconos";
import { ID_ENTRADA } from "./PanelClaude";

/** Abre el panel de Claude con la orden y su salida adjuntas, listo para preguntar. */
function preguntarAClaude(term: Terminal, b: Bloque) {
  const t = textoBloque(term, b);
  if (!t) return;
  adjuntar(useKyu.getState().activo, t);
  requestAnimationFrame(() => (document.getElementById(ID_ENTRADA) as HTMLTextAreaElement | null)?.focus());
}

interface Props {
  term: Terminal;
  bloques: Bloques;
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
export default function CapaBloques({ term, bloques, fuente, tamano }: Props) {
  useSyncExternalStore(bloques.suscribir, bloques.version);
  const [, setCuadro] = useState(0);
  // Bloque con el ratón encima (para enseñar «Preguntar a Claude»). La capa no recibe
  // clics, así que se mira el ratón en el contenedor del terminal.
  const [encima, setEncima] = useState<number | null>(null);
  const filas = useRef<{ id: number; fila: number; filaFin: number }[]>([]);
  useEffect(() => {
    const contenedor = term.element?.closest<HTMLElement>("[data-kyu-terminal]");
    if (!contenedor) return;
    const mover = (e: MouseEvent) => {
      const pantalla = term.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!pantalla || term.rows === 0) return;
      const r = pantalla.getBoundingClientRect();
      const fila = Math.floor((e.clientY - r.top) / (r.height / term.rows));
      const v = filas.current.find((x) => fila >= x.fila && fila <= x.filaFin);
      setEncima(v ? v.id : null);
    };
    const salir = () => setEncima(null);
    contenedor.addEventListener("mousemove", mover);
    contenedor.addEventListener("mouseleave", salir);
    return () => {
      contenedor.removeEventListener("mousemove", mover);
      contenedor.removeEventListener("mouseleave", salir);
    };
  }, [term]);

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
  filas.current = visibles.map(({ b, fila, filaFin }) => ({ id: b.id, fila, filaFin }));

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
            encima={encima === b.id}
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
    </div>
  );
}

function Titulo({
  b,
  encima,
  onPreguntar,
  style,
}: {
  b: Bloque;
  encima: boolean;
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
        {terminado && (encima || b.estado === "mal") && (
          <button
            type="button"
            title="Preguntar a Claude por esta orden"
            onClick={onPreguntar}
            onMouseDown={(e) => e.preventDefault()}
            className={`pointer-events-auto flex h-[19px] items-center gap-1.5 rounded-full border px-2 text-[11.5px] transition-colors ${
              encima
                ? "border-claude/40 text-claude2 hover:border-claude/70 hover:bg-claude/10"
                : "border-transparent opacity-50"
            }`}
          >
            <Mascota alto={10} />
            {encima && "Preguntar a Claude"}
          </button>
        )}
        <Resultado b={b} />
        <span className="tabular-nums text-muy">{b.hora}</span>
      </span>
    </div>
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
