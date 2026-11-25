import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, ClipboardList, Loader2, SquarePen, Undo2 } from "lucide-react";
import { espacioDe, irAClaude, nuevaConversacion, irAConversacion, pendiente, sitioDe, tituloDe, useClaude, type Conversacion } from "../lib/claude";
import { useKyu } from "../lib/estado";
import { nombreEspacio } from "./BarraTitulo";
import { Mascota } from "./iconos";

type Grupo = "trabajando" | "esperan" | "acabadas" | "vacias";

const segundos = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function grupoDe(c: Conversacion): Grupo {
  if (pendiente(c)) return "esperan";
  if (c.estado === "arrancando" || c.estado === "pensando") return "trabajando";
  if (!c.entradas.length) return "vacias";
  return "acabadas";
}

const TITULOS: Record<Grupo, string> = { trabajando: "Trabajando", esperan: "Esperan", acabadas: "Acabadas", vacias: "Sin empezar" };

/**
 * Botón «Claude» de la barra y su centro de actividad: todas las conversaciones abiertas, en
 * cualquier espacio, con cuál trabaja, cuál espera un permiso tuyo y cuál ha acabado.
 */
export default function CentroClaude() {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const conversaciones = useClaude((s) => s.conversaciones);
  const espacios = useKyu((s) => s.espacios);
  const activo = useKyu((s) => s.activo);
  useKyu((s) => s.items);
  const [, tic] = useState(0);

  // Solo las que tienen pestaña (las demás se están cerrando).
  const lista = Object.entries(conversaciones)
    .filter(([cid]) => sitioDe(cid) !== null)
    .map(([cid, c]) => ({ cid, c, grupo: grupoDe(c) }));
  const trabajando = lista.filter((x) => x.grupo === "trabajando").length;
  const esperan = lista.filter((x) => x.grupo === "esperan").length;

  // Con algo en marcha y el menú abierto, el tiempo corre.
  useEffect(() => {
    if (!abierto || !trabajando) return;
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [abierto, trabajando]);

  // Se cierra al pulsar fuera o con Esc.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("mousedown", fuera);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", fuera);
      window.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  const ir = (cid: string) => {
    setAbierto(false);
    irAConversacion(cid);
  };
  const nombre = (cid: string) => {
    const esp = espacios.find((e) => e.id === espacioDe(cid));
    return esp ? nombreEspacio(esp) : "";
  };

  const grupos: Grupo[] = ["esperan", "trabajando", "acabadas", "vacias"];
  // Primero las del último turno.
  const orden = (a: { c: Conversacion }, b: { c: Conversacion }) => b.c.desde - a.c.desde;

  return (
    <div ref={caja} className="relative mr-2">
      <button
        type="button"
        title="Conversaciones con Claude (Ctrl+Mayús+C va a la última)"
        onClick={() => setAbierto((v) => !v)}
        className={`flex h-7 items-center gap-2 rounded-[7px] px-2.5 text-[12.5px] ${
          abierto || trabajando || esperan ? "bg-claude/10 text-claude2" : "text-tenue hover:bg-hover hover:text-texto"
        }`}
      >
        <Mascota alto={12} />
        Claude
        {trabajando + esperan > 0 && (
          <span className="flex items-center gap-1 text-[11.5px]">
            · {trabajando + esperan}
            {esperan > 0 && <span title="Alguna espera un permiso tuyo" className="size-1.5 rounded-full bg-aviso" />}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 top-9 z-50 w-[360px] overflow-hidden rounded-[10px] border border-borde2 bg-tarjeta text-[12.5px] shadow-[0_24px_60px_-16px_#000]">
          <div className="flex gap-1 border-b border-borde p-1.5">
            <Accion
              icono={<SquarePen size={13} strokeWidth={1.8} />}
              texto="Nueva conversación"
              atajo="Ctrl+Mayús+K"
              onClick={() => {
                setAbierto(false);
                nuevaConversacion(activo);
              }}
            />
            <Accion
              icono={<Undo2 size={13} strokeWidth={1.8} />}
              texto="Ir a la última"
              atajo="Ctrl+Mayús+C"
              onClick={() => {
                setAbierto(false);
                irAClaude(activo);
              }}
            />
          </div>
          {!lista.length && <p className="px-3 py-4 text-tenue">No hay ninguna conversación abierta.</p>}
          <div className="max-h-[60vh] overflow-y-auto pb-1">
            {grupos.map((g) => {
              const filas = lista.filter((x) => x.grupo === g).sort(orden);
              if (!filas.length) return null;
              return (
                <div key={g}>
                  <div className="px-3 pb-1 pt-2.5 text-[10.5px] uppercase tracking-[.06em] text-muy">{TITULOS[g]}</div>
                  {filas.map(({ cid, c }) => (
                    <Fila key={cid} cid={cid} c={c} espacio={espacios.length > 1 ? nombre(cid) : null} onClick={() => ir(cid)} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Accion({ icono, texto, atajo, onClick }: { icono: React.ReactNode; texto: string; atajo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={atajo}
      className="flex h-7 flex-1 items-center gap-2 rounded-md px-2 text-tenue hover:bg-hover hover:text-texto"
    >
      {icono}
      {texto}
    </button>
  );
}

function Fila({ cid, c, espacio, onClick }: { cid: string; c: Conversacion; espacio: string | null; onClick: () => void }) {
  const p = pendiente(c);
  const trabaja = c.estado === "arrancando" || c.estado === "pensando";
  const enCola = useClaude((s) => s.colas[cid]?.length ?? 0);
  const carpeta = c.carpeta ? c.carpeta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : null;
  const detalle = p
    ? p.herramienta === "ExitPlanMode"
      ? "tiene un plan para que lo revises"
      : `quiere usar ${p.herramienta}`
    : [espacio, carpeta, enCola ? `${enCola} en cola` : null].filter(Boolean).join(" · ") || "sin empezar";
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left hover:bg-hover">
      <span className="grid w-4 flex-none place-items-center">
        {p ? (
          p.herramienta === "ExitPlanMode" ? (
            <ClipboardList size={14} strokeWidth={1.8} className="text-aviso" />
          ) : (
            <CircleAlert size={14} strokeWidth={1.8} className="text-aviso" />
          )
        ) : trabaja ? (
          <Loader2 size={13} className="animate-spin text-claude2" />
        ) : c.entradas.length ? (
          <Check size={14} strokeWidth={2} className="text-ok" />
        ) : (
          <span className="size-1.5 rounded-full bg-borde2" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-texto">{tituloDe(c)}</span>
        <span className="block truncate text-[11px] text-muy">{detalle}</span>
      </span>
      <span className={`flex-none text-[11px] ${p ? "text-aviso" : "text-muy"}`}>
        {p ? "permiso" : trabaja ? segundos(Date.now() - c.desde) : ""}
      </span>
    </button>
  );
}
