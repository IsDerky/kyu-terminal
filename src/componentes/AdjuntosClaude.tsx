// Panel de Claude: menciones @archivo, miniaturas de imágenes y conversaciones guardadas.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { File, Folder, Search, X } from "lucide-react";
import { reanudar } from "../lib/claude";
import type { ImagenAdjunta } from "../lib/imagenes";
import { sesionesClaude, type SesionGuardada } from "../lib/nucleo";

// ---------- @archivo ----------

/** «@src/li» justo antes del cursor → [posición de la @, lo escrito tras ella]; null si no hay. */
export function mencionEnCursor(texto: string, cursor: number): [number, string] | null {
  const m = texto.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/);
  return m ? [cursor - m[1].length - 1, m[1]] : null;
}

export function MenuArchivos({
  rutas,
  elegido,
  buscando,
  alElegir,
  alPasar,
}: {
  rutas: string[];
  elegido: number;
  buscando: boolean;
  alElegir: (ruta: string) => void;
  alPasar: (i: number) => void;
}) {
  const lista = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    lista.current?.querySelector(`[data-i="${elegido}"]`)?.scrollIntoView({ block: "nearest" });
  }, [elegido]);

  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-1.5 overflow-hidden rounded-lg border border-borde2 bg-tarjeta shadow-[0_12px_32px_-12px_#000]">
      <div ref={lista} className="max-h-[260px] overflow-y-auto overflow-x-hidden py-1">
        {rutas.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-muy">{buscando ? "Buscando…" : "Ningún archivo encaja"}</p>
        )}
        {rutas.map((r, i) => {
          const carpeta = r.endsWith("/");
          const limpia = r.replace(/\/$/, "");
          const corte = limpia.lastIndexOf("/") + 1;
          const Icono = carpeta ? Folder : File;
          return (
            <button
              key={r}
              type="button"
              data-i={i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => alElegir(r)}
              onMouseMove={() => alPasar(i)}
              className={`flex w-full items-center gap-2 px-3 py-[5px] text-left ${i === elegido ? "bg-hover" : ""}`}
            >
              <Icono size={12} strokeWidth={1.8} className={`flex-none ${carpeta ? "text-acento" : "text-muy"}`} />
              <span className="flex-none text-[12px] text-texto">
                {limpia.slice(corte)}
                {carpeta && "/"}
              </span>
              <span className="min-w-0 truncate text-[11px] text-muy">{limpia.slice(0, corte)}</span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-borde px-3 py-1 text-[10.5px] text-muy">↑↓ elegir · Tab o Intro poner · Esc cerrar</p>
    </div>
  );
}

// ---------- Imágenes ----------

export function Miniaturas({ imagenes, alQuitar }: { imagenes: ImagenAdjunta[]; alQuitar: (id: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2">
      {imagenes.map((i) => (
        <div
          key={i.id}
          title={i.nombre}
          className="group/img relative size-12 overflow-hidden rounded-md border border-borde2 bg-tarjeta"
        >
          <img src={i.url} alt={i.nombre} className="size-full object-cover" />
          <button
            type="button"
            title="Quitar"
            onClick={() => alQuitar(i.id)}
            className="absolute right-0.5 top-0.5 hidden size-4 place-items-center rounded bg-fondo/85 text-texto group-hover/img:grid"
          >
            <X size={10} strokeWidth={2.2} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- Conversaciones guardadas ----------

const hace = (ms: number) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) {
    const d = Math.floor(s / 86400);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }
  return new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};

/** Conversaciones guardadas de `carpeta`, pedidas al montar. */
function useSesiones(carpeta: string | null) {
  const [lista, setLista] = useState<SesionGuardada[] | null>(null);
  useEffect(() => {
    if (!carpeta) return;
    let vivo = true;
    setLista(null);
    sesionesClaude(carpeta)
      .then((l) => vivo && setLista(l))
      .catch(() => vivo && setLista([]));
    return () => {
      vivo = false;
    };
  }, [carpeta]);
  return lista;
}

function FilaSesion({ s, actual, alElegir }: { s: SesionGuardada; actual: boolean; alElegir: () => void }) {
  return (
    <button
      type="button"
      onClick={alElegir}
      disabled={actual}
      title={s.ultimo ? `${s.titulo}\nÚltimo mensaje: ${s.ultimo}` : s.titulo}
      className="flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="flex w-full items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-texto">{s.titulo}</span>
        <span className="flex-none text-[11px] text-muy">{actual ? "abierta" : hace(s.fecha)}</span>
      </span>
      {s.ultimo && <span className="w-full truncate text-[11px] text-muy">{s.ultimo}</span>}
    </button>
  );
}

const nombreCarpeta = (ruta: string | null) => (ruta ? ruta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ruta : "~");

export function ListaSesiones({
  espacio,
  carpeta,
  actual,
  alCerrar,
}: {
  espacio: string;
  carpeta: string | null;
  actual: string | null;
  alCerrar: () => void;
}) {
  const lista = useSesiones(carpeta);
  const [filtro, setFiltro] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!caja.current?.contains(t) && !t.closest("[data-boton-sesiones]")) alCerrar();
    };
    window.addEventListener("mousedown", fuera);
    return () => window.removeEventListener("mousedown", fuera);
  }, [alCerrar]);
  const f = filtro.toLowerCase();
  const visibles = (lista ?? []).filter((s) => s.titulo.toLowerCase().includes(f) || s.ultimo?.toLowerCase().includes(f));

  return (
    <div
      ref={caja}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          alCerrar();
        }
      }}
      className="absolute inset-x-2 top-12 z-30 flex max-h-[min(440px,70%)] flex-col rounded-lg border border-borde2 bg-tarjeta shadow-[0_12px_32px_-12px_#000]"
    >
      <div className="flex items-center gap-2 border-b border-borde px-3 py-2">
        <Search size={12} className="flex-none text-muy" />
        <input
          autoFocus
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder={`Conversaciones en ${nombreCarpeta(carpeta)}`}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-texto outline-none placeholder:text-muy"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {lista === null && <p className="px-2.5 py-2 text-[12px] text-muy">Buscando…</p>}
        {lista && visibles.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-muy">
            {lista.length ? "Ninguna encaja" : "Aún no hay conversaciones en esta carpeta"}
          </p>
        )}
        {visibles.map((s) => (
          <FilaSesion
            key={s.id}
            s={s}
            actual={s.id === actual}
            alElegir={() => {
              alCerrar();
              if (carpeta) void reanudar(espacio, carpeta, s.id, s.titulo);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** En el panel vacío: las 3 últimas conversaciones de la carpeta, para seguir una. */
export function Recientes({ espacio, carpeta }: { espacio: string; carpeta: string | null }) {
  const lista = useSesiones(carpeta);
  if (!lista?.length || !carpeta) return null;
  return (
    <div className="mt-5 w-full max-w-[300px] text-left">
      <p className="mb-1 px-2.5 text-[10.5px] font-medium uppercase tracking-wider text-muy">Seguir una conversación</p>
      {lista.slice(0, 3).map((s) => (
        <FilaSesion key={s.id} s={s} actual={false} alElegir={() => void reanudar(espacio, carpeta, s.id, s.titulo)} />
      ))}
    </div>
  );
}
