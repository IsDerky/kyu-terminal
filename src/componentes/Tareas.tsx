// Lista de tareas del agente (encima de la caja) y lo que deja en segundo plano.
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Circle, ListChecks, Loader2 } from "lucide-react";
import type { Conversacion } from "../lib/claude";
import { useKyu } from "../lib/estado";
import type { Tarea } from "../lib/nucleo";

export const tiempo = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Cuántas hay hechas y la que se está haciendo. */
export function avance(tareas: Tarea[]) {
  const hechas = tareas.filter((t) => t.estado === "completed").length;
  const actual = tareas.find((t) => t.estado === "in_progress");
  return { hechas, total: tareas.length, actual: actual ? actual.activo || actual.texto : null };
}

/** Segundos desde `desde`, al día cada segundo. */
export function Cronometro({ desde }: { desde: number }) {
  const [, tic] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{tiempo(Date.now() - desde)}</>;
}

/** Barrita de avance de la lista de tareas. */
export function BarraTareas({ tareas, className = "" }: { tareas: Tarea[]; className?: string }) {
  const { hechas, total } = avance(tareas);
  return (
    <span className={`block h-1 overflow-hidden rounded-full bg-hover ${className}`}>
      <span className="block h-full rounded-full bg-claude transition-[width]" style={{ width: `${total ? (hechas / total) * 100 : 0}%` }} />
    </span>
  );
}

/** En una herramienta lanzada en segundo plano: cuánto lleva o cómo acabó, y su salida. */
export function EtiquetaFondo({ fondo }: { fondo: { desde: number; estado?: string; salida?: string | null } }) {
  const acabada = !!fondo.estado;
  const mal = acabada && fondo.estado !== "completed";
  return (
    <span className="ml-auto flex flex-none items-center gap-1.5 text-[11px] text-muy">
      {acabada ? (mal ? `segundo plano · ${fondo.estado}` : "segundo plano · acabada") : <>segundo plano · <Cronometro desde={fondo.desde} /></>}
      {fondo.salida && (
        <button
          type="button"
          title={fondo.salida}
          onClick={() => useKyu.getState().abrirArchivo(fondo.salida!, 1, 1)}
          className="text-acento2 hover:underline"
        >
          Ver salida
        </button>
      )}
    </span>
  );
}

/** Pegada encima de la caja: la lista de tareas del agente, plegada en una línea con su avance. */
export function TiraTareas({ c }: { c: Conversacion }) {
  const [abierta, setAbierta] = useState(false);
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  const { hechas, total, actual } = avance(c.tareas);
  // Se quita cuando está todo hecho y el agente ha acabado.
  if (!total || (hechas === total && !ocupado)) return null;
  return (
    <div className="mx-3 rounded-t-lg border border-b-0 border-borde2 bg-[#121215] px-3 py-1.5 text-[12px]">
      <button type="button" onClick={() => setAbierta((v) => !v)} className="flex w-full min-w-0 items-center gap-2 text-left">
        <ListChecks size={13} strokeWidth={1.8} className="flex-none text-claude2" />
        <b className="flex-none font-medium text-texto">
          Tareas {hechas} de {total}
        </b>
        {actual && <span className="min-w-0 truncate text-tenue">· {actual}</span>}
        <span className="ml-auto flex-none text-muy">{abierta ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</span>
      </button>
      {abierta ? (
        <ul className="mt-1.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto pb-0.5">
          {c.tareas.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-[3px] flex-none">
                {t.estado === "completed" ? (
                  <Check size={12} className="text-muy" />
                ) : t.estado === "in_progress" ? (
                  ocupado ? <Loader2 size={12} className="animate-spin text-claude2" /> : <Circle size={12} className="text-claude2" />
                ) : (
                  <Circle size={12} className="text-muy" />
                )}
              </span>
              <span className={t.estado === "completed" ? "text-muy line-through" : t.estado === "in_progress" ? "text-texto" : "text-tenue"}>{t.texto}</span>
            </li>
          ))}
        </ul>
      ) : (
        <BarraTareas tareas={c.tareas} className="mt-1.5" />
      )}
    </div>
  );
}
