import { useEffect, useRef, useState } from "react";
import { Bot, Check, CircleAlert, ClipboardList, Loader2, Monitor, SquareTerminal, Undo2 } from "lucide-react";
import {
  conversacionEnPanel,
  espacioDe,
  irAClaude,
  irAConversacion,
  nombreAgente,
  nuevaConversacion,
  pendiente,
  reanudar,
  sitioDe,
  tituloDe,
  useClaude,
  type Conversacion,
  type Entrada,
} from "../lib/claude";
import { useKyu } from "../lib/estado";
import { claudeActivas, type SesionActiva } from "../lib/nucleo";
import { nombreEspacio } from "./BarraTitulo";
import { IconoMenu } from "./iconos";
import { avance, BarraTareas, BotonParar, Cronometro, tiempo } from "./Tareas";

type Grupo = "trabajando" | "esperan" | "acabadas" | "vacias";

const ocupada = (c: Conversacion) => c.estado === "arrancando" || c.estado === "pensando";

function grupoDe(c: Conversacion): Grupo {
  if (pendiente(c)) return "esperan";
  // Con algo en segundo plano sigue trabajando aunque el turno haya acabado.
  if (ocupada(c) || c.fondo.length) return "trabajando";
  if (!c.entradas.length) return "vacias";
  return "acabadas";
}

const TITULOS: Record<Grupo, string> = { trabajando: "Trabajando", esperan: "Esperan", acabadas: "Acabadas", vacias: "Sin empezar" };

type Herramienta = Extract<Entrada, { tipo: "herramienta" }>;
const herramientas = (c: Conversacion) => c.entradas.filter((e): e is Herramienta => e.tipo === "herramienta");
const ES_SUBAGENTE = new Set(["Task", "Agent"]);
const nombreCarpeta = (r: string | null) => (r ? r.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : null);

/**
 * Botón «Agentes» de la barra y su centro de actividad: todas las conversaciones abiertas (Claude y
 * otros agentes), con lo que hace cada una, sus subagentes, lo que deja en segundo plano y su lista
 * de tareas; y las sesiones de Claude que trabajan fuera de Kyu.
 */
export default function CentroClaude() {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const conversaciones = useClaude((s) => s.conversaciones);
  const espacios = useKyu((s) => s.espacios);
  const activo = useKyu((s) => s.activo);
  useKyu((s) => s.items);
  const [fuera, setFuera] = useState<SesionActiva[]>([]);

  // Solo las que tienen pestaña (las demás se están cerrando).
  const lista = Object.entries(conversaciones)
    .filter(([cid]) => sitioDe(cid) !== null)
    .map(([cid, c]) => ({ cid, c, grupo: grupoDe(c) }));
  const trabajando = lista.filter((x) => x.grupo === "trabajando").length;
  const esperan = lista.filter((x) => x.grupo === "esperan").length;

  // Con el menú abierto, las de fuera de Kyu cada 5 s (sin las de Kyu).
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    const mirar = () => {
      const propias = Object.values(useClaude.getState().conversaciones).flatMap((c) => (c.sesion ? [c.sesion] : []));
      claudeActivas(propias)
        .then((l) => vivo && setFuera(l))
        .catch(() => {});
    };
    mirar();
    const t = setInterval(mirar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [abierto]);

  // Se cierra al pulsar fuera o con Esc.
  useEffect(() => {
    if (!abierto) return;
    const fueraClic = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("mousedown", fueraClic);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", fueraClic);
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
  /** Abre el historial de una sesión de fuera en una pestaña nueva (Claude la sigue si escribes). */
  const ver = (s: SesionActiva) => {
    if (!s.carpeta) return;
    setAbierto(false);
    const cid = conversacionEnPanel(activo, { alLado: true });
    void reanudar(cid, s.carpeta, s.id, s.titulo).catch(() => {});
  };

  const grupos: Grupo[] = ["esperan", "trabajando", "acabadas", "vacias"];
  // Primero las del último turno.
  const orden = (a: { c: Conversacion }, b: { c: Conversacion }) => b.c.desde - a.c.desde;

  return (
    <div ref={caja} className="relative mr-2">
      <button
        type="button"
        title="Agentes: qué hace cada conversación (Ctrl+Mayús+C va a la última)"
        onClick={() => setAbierto((v) => !v)}
        className={`flex h-7 items-center gap-2 rounded-[7px] px-2.5 text-[12.5px] ${
          abierto || trabajando || esperan ? "bg-claude/10 text-claude2" : "text-tenue hover:bg-hover hover:text-texto"
        }`}
      >
        <Bot size={13} strokeWidth={1.8} />
        Agentes
        {trabajando + esperan > 0 && (
          <span className="flex items-center gap-1 text-[11.5px]">
            · {trabajando + esperan}
            {esperan > 0 && <span title="Alguno espera un permiso tuyo" className="size-1.5 rounded-full bg-aviso" />}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 top-9 z-50 w-[420px] overflow-hidden rounded-[10px] border border-borde2 bg-tarjeta text-[12.5px] shadow-[0_24px_60px_-16px_#000]">
          <div className="flex gap-1 border-b border-borde p-1.5">
            <Accion
              icono={<IconoMenu agente={null} />}
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
          {!lista.length && !fuera.length && <p className="px-3 py-4 text-tenue">No hay ninguna conversación abierta.</p>}
          <div className="max-h-[65vh] overflow-y-auto pb-1">
            {grupos.map((g) => {
              const filas = lista.filter((x) => x.grupo === g).sort(orden);
              if (!filas.length) return null;
              return (
                <div key={g}>
                  <Cabecera texto={TITULOS[g]} derecha={filas.length > 1 ? String(filas.length) : undefined} />
                  {filas.map(({ cid, c }) => (
                    <Fila key={cid} cid={cid} c={c} espacio={espacios.length > 1 ? nombre(cid) : null} onClick={() => ir(cid)} />
                  ))}
                </div>
              );
            })}
            {fuera.length > 0 && (
              <div>
                <Cabecera texto="Fuera de Kyu" derecha="solo lectura" />
                {fuera.map((s) => (
                  <FilaFuera key={s.id} s={s} onVer={s.carpeta ? () => ver(s) : undefined} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Cabecera({ texto, derecha }: { texto: string; derecha?: string }) {
  return (
    <div className="flex justify-between px-3 pb-1 pt-2.5 text-[10.5px] uppercase tracking-[.06em] text-muy">
      <span>{texto}</span>
      {derecha && <span>{derecha}</span>}
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
  const trabaja = ocupada(c);
  const enCola = useClaude((s) => s.colas[cid]?.length ?? 0);
  const lista = herramientas(c);
  // Lo que hace ahora: la última herramienta que no ha acabado (sin contar subagentes).
  const enCurso = [...lista].reverse().find((e) => e.estado === "ejecutando" && !ES_SUBAGENTE.has(e.nombre));
  const subagentes = lista.filter((e) => ES_SUBAGENTE.has(e.nombre) && e.estado === "ejecutando");
  const { hechas, total, actual } = avance(c.tareas);
  const carpeta = nombreCarpeta(c.carpeta);
  // El espacio suele llamarse como su carpeta: entonces una vez.
  const lugar = [espacio, carpeta?.toLowerCase() === espacio?.toLowerCase() ? null : carpeta].filter(Boolean).join(" · ");
  const detalle = p
    ? p.herramienta === "ExitPlanMode"
      ? "tiene un plan para que lo revises"
      : p.herramienta === "AskUserQuestion"
        ? "te ha hecho una pregunta"
        : `quiere usar ${p.herramienta}${p.resumen ? `: ${p.resumen}` : ""}`
    : trabaja && enCurso
      ? `${enCurso.nombre} ${enCurso.resumen}`
      : enCola
        ? `${enCola} en cola`
        : "";
  const sub = [lugar, detalle].filter(Boolean).join(" · ") || "sin empezar";
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-2.5 px-3 py-[7px] text-left hover:bg-hover">
      <span className="mt-[3px] grid w-4 flex-none place-items-center">
        {p ? (
          p.herramienta === "ExitPlanMode" ? (
            <ClipboardList size={14} strokeWidth={1.8} className="text-aviso" />
          ) : (
            <CircleAlert size={14} strokeWidth={1.8} className="text-aviso" />
          )
        ) : trabaja || c.fondo.length ? (
          <Loader2 size={13} className={`animate-spin ${c.agente ? "text-sky-400" : "text-claude2"}`} />
        ) : c.entradas.length ? (
          <Check size={14} strokeWidth={2} className="text-ok" />
        ) : (
          <span className="size-1.5 rounded-full bg-borde2" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-texto">{tituloDe(c)}</span>
          {c.agente && (
            <span className="flex-none rounded border border-sky-900 px-1.5 text-[10.5px] text-sky-400">{nombreAgente(c)}</span>
          )}
        </span>
        <span className="block truncate text-[11px] text-muy">{sub}</span>
        {(subagentes.length > 0 || c.fondo.length > 0) && (
          <span className="mt-1 flex flex-col gap-0.5 border-l border-borde2 pl-2.5">
            {subagentes.map((s) => (
              <span key={s.id} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-tenue">
                <Loader2 size={11} className="flex-none animate-spin text-claude2" />
                <span className="truncate">Subagente · {s.resumen}</span>
                {s.pasos ? <span className="ml-auto flex-none text-muy">{s.pasos} pasos</span> : null}
              </span>
            ))}
            {c.fondo.map((f) => (
              <span key={f.id} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-tenue">
                {f.tipo === "local_bash" ? (
                  <SquareTerminal size={11} strokeWidth={1.8} className="flex-none" />
                ) : (
                  <Bot size={11} strokeWidth={1.8} className="flex-none" />
                )}
                <span className="truncate">En segundo plano · {f.descripcion}</span>
                <span className="ml-auto flex-none text-muy">
                  <Cronometro desde={f.desde} />
                </span>
                {!c.agente && <BotonParar cid={cid} tarea={f.id} />}
              </span>
            ))}
          </span>
        )}
        {total > 0 && hechas < total && (
          <>
            <BarraTareas tareas={c.tareas} className="mt-1.5" />
            <span className="mt-0.5 block truncate text-[11px] text-muy">
              Tareas {hechas} de {total}
              {actual ? ` · ahora: ${actual}` : ""}
            </span>
          </>
        )}
      </span>
      <span className={`mt-[2px] flex-none text-[11px] ${p ? "text-aviso" : "text-muy"}`}>
        {p ? "permiso" : trabaja ? <Cronometro desde={c.desde} /> : ""}
      </span>
    </button>
  );
}

function FilaFuera({ s, onVer }: { s: SesionActiva; onVer?: () => void }) {
  const sub = [nombreCarpeta(s.carpeta), s.herramienta, `hace ${tiempo(Date.now() - s.fecha)}`].filter(Boolean).join(" · ");
  return (
    <div className="flex w-full items-start gap-2.5 px-3 py-[7px] hover:bg-hover">
      <span className="mt-[3px] grid w-4 flex-none place-items-center text-muy">
        <Monitor size={13} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-texto">{s.titulo}</span>
        </span>
        <span className="block truncate text-[11px] text-muy">{sub}</span>
      </span>
      {onVer && (
        <button
          type="button"
          onClick={onVer}
          title="Abre su conversación en una pestaña. Si escribes ahí, Claude la sigue desde Kyu: mejor cuando la otra haya acabado."
          className="mt-[1px] flex-none rounded px-1.5 text-[11.5px] text-acento2 hover:bg-hover"
        >
          Ver
        </button>
      )}
    </div>
  );
}
