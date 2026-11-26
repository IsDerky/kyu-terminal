// Piezas del panel de Claude de la tanda C: razonamiento, subagentes, plan y puntos de control.
import { useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronRight, ClipboardList, Diff, Loader2, MessageCircleQuestion, RotateCcw } from "lucide-react";
import {
  cambiosAlVolver,
  contestarPreguntas,
  responder,
  useClaude,
  volver,
  verCambios,
  type ArchivoCambiado,
  type CambiosVuelta,
  type Entrada,
  type Vuelta,
} from "../lib/claude";
import { herramienta, relativa } from "../lib/herramientas";
import Markdown from "./Markdown";

/** Resumen de lo que pensó Claude: plegado en una línea; abierto mientras piensa. */
export function Razonamiento({ e }: { e: Extract<Entrada, { tipo: "razonamiento" }> }) {
  const [abierto, setAbierto] = useState(false);
  const ver = abierto || e.enCurso;
  const primera = e.texto.trim().split("\n")[0].replace(/[*_`#]/g, "");
  return (
    <div className="text-[12px] text-tenue">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left hover:text-texto"
      >
        <Brain size={13} strokeWidth={1.8} className={`flex-none ${e.enCurso ? "animate-pulse text-claude2" : ""}`} />
        <span className="flex-none font-medium">{e.enCurso ? "Pensando" : "Pensamiento"}</span>
        {!ver && <span className="min-w-0 truncate text-muy">{primera}</span>}
        <ChevronRight size={12} className={`ml-auto flex-none text-muy transition-transform ${ver ? "rotate-90" : ""}`} />
      </button>
      {ver && (
        <div className="md mt-1 border-l-2 border-borde2 pl-2.5 text-[12px] italic text-tenue">
          <Markdown texto={e.texto} />
        </div>
      )}
    </div>
  );
}

/** En cada Editar/Escribir terminado: abre el archivo con lo que cambió marcado. */
export function BotonVerCambios({ espacio, ruta }: { espacio: string; ruta: string }) {
  const puede = useClaude((s) => {
    const c = s.conversaciones[espacio];
    return !!c && (ruta in c.tocados || ruta in c.antesDe);
  });
  if (!puede) return null;
  return (
    <button
      type="button"
      title="Abrir en Kyu con los cambios marcados"
      onClick={() => void verCambios(espacio, ruta)}
      className="flex h-5 flex-none items-center gap-1 rounded border border-borde2 px-1.5 text-[11px] text-tenue hover:bg-hover hover:text-texto"
    >
      <Diff size={11} strokeWidth={1.9} /> Ver cambios
    </button>
  );
}

/** Al acabar un turno: los archivos que tocó Claude, con lo que puso y quitó. */
export function ResumenCambios({ espacio, archivos, carpeta }: { espacio: string; archivos: ArchivoCambiado[]; carpeta: string | null }) {
  return (
    <div className="overflow-hidden rounded-[9px] border border-borde2">
      <div className="flex items-center gap-2 border-b border-borde px-2.5 py-1.5 text-[12px] text-tenue">
        <Diff size={13} strokeWidth={1.8} />
        <span className="text-texto">Archivos cambiados</span>
        <span className="ml-auto text-[11px] text-muy">{archivos.length}</span>
      </div>
      {archivos.map((a) => (
        <button
          key={a.ruta}
          type="button"
          disabled={a.borrado}
          title={a.borrado ? `${a.ruta} (ya no está)` : `${a.ruta} · ver los cambios`}
          onClick={() => void verCambios(espacio, a.ruta)}
          className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1 text-left font-mono text-[11.5px] text-tenue hover:bg-hover hover:text-texto disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate">{relativa(a.ruta, carpeta)}</span>
          {a.antes === null && <span className="flex-none font-ui text-[10.5px] text-ok">nuevo</span>}
          <span className="flex-none text-ok">+{a.puestas}</span>
          <span className="flex-none text-mal">−{a.quitadas}</span>
        </button>
      ))}
    </div>
  );
}

/** Debajo de un subagente: cuántas herramientas lleva y la última. */
export function PasosSubagente({ pasos, ultimo, carpeta }: { pasos: number; ultimo?: { nombre: string; resumen: string }; carpeta: string | null }) {
  const [nombre, Icono] = herramienta(ultimo?.nombre ?? "");
  return (
    <div className="ml-[22px] flex min-w-0 items-center gap-1.5 text-[11px] text-muy">
      <span className="flex-none">
        {pasos} {pasos === 1 ? "paso" : "pasos"}
      </span>
      {ultimo && (
        <>
          <span className="flex-none">·</span>
          <Icono size={11} strokeWidth={1.8} className="flex-none" />
          <span className="flex-none">{nombre}</span>
          <span title={ultimo.resumen} className="min-w-0 truncate font-mono">
            {relativa(ultimo.resumen, carpeta)}
          </span>
        </>
      )}
    </div>
  );
}

/** El plan que propone Claude (ExitPlanMode) con las tres salidas de `claude`. */
export function Plan({ e, espacio }: { e: Extract<Entrada, { tipo: "permiso" }>; espacio: string }) {
  const plan = typeof (e.input as { plan?: unknown })?.plan === "string" ? (e.input as { plan: string }).plan : "";

  if (e.respuesta) {
    const si = e.respuesta !== "denegar";
    return (
      <div className="px-1 text-[11.5px] text-muy">
        <div className="flex items-center gap-2">
          <ClipboardList size={12} className={si ? "text-ok" : "text-mal"} />
          {si ? "Plan aprobado" : "Plan rechazado: sigue planificando"}
        </div>
        {e.mensaje && <p className="mt-1 select-text whitespace-pre-wrap pl-5 text-tenue">«{e.mensaje}»</p>}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-acento/30 bg-acento/[0.03]">
      <div className="flex items-center gap-2 px-[11px] py-[9px] text-[12.5px]">
        <ClipboardList size={14} strokeWidth={1.8} className="flex-none text-acento" />
        <span>
          Claude propone este <b className="font-semibold">plan</b>
        </span>
      </div>
      <div className="mx-[11px] mb-2.5 max-h-[340px] overflow-auto rounded-md border border-borde bg-fondo px-3 py-2">
        <Markdown texto={plan || "(plan vacío)"} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-[11px] pb-2.5">
        <BotonPlan principal tecla="Intro" onClick={() => void responder(espacio, e.id, "permitir", undefined, "acceptEdits")}>
          Sí, y editar sin preguntar
        </BotonPlan>
        <BotonPlan onClick={() => void responder(espacio, e.id, "permitir", undefined, "default")}>Sí, pidiendo permiso</BotonPlan>
        <BotonPlan tecla="Esc" onClick={() => void responder(espacio, e.id, "denegar")}>
          No, sigue planificando
        </BotonPlan>
      </div>
      <p className="px-[11px] pb-2.5 text-[11px] text-muy">O escribe abajo qué cambiar y pulsa Intro.</p>
    </div>
  );
}

interface Opcion {
  label: string;
  description?: string;
}
interface Pregunta {
  question: string;
  header?: string;
  options: Opcion[];
  multiSelect?: boolean;
}

/** Las preguntas de AskUserQuestion vienen en `input.questions`; si no encajan, null. */
export function preguntasDe(input: unknown): Pregunta[] | null {
  const qs = (input as { questions?: unknown })?.questions;
  if (!Array.isArray(qs) || !qs.length) return null;
  const ok = qs.every(
    (q) => typeof q?.question === "string" && Array.isArray(q.options) && q.options.every((o: Opcion) => typeof o?.label === "string"),
  );
  return ok ? (qs as Pregunta[]) : null;
}

/** AskUserQuestion: cada pregunta con sus opciones (y «Otra» para escribir), como en `claude`. */
export function Preguntas({ e, espacio }: { e: Extract<Entrada, { tipo: "permiso" }>; espacio: string }) {
  const preguntas = preguntasDe(e.input) ?? [];
  // Por pregunta: etiquetas elegidas y el texto de «Otra» (si está marcada).
  const [elegidas, setElegidas] = useState<string[][]>(() => preguntas.map(() => []));
  const [otra, setOtra] = useState<(string | null)[]>(() => preguntas.map(() => null));

  if (e.respuesta) {
    const si = e.respuesta !== "denegar";
    return (
      <div className="px-1 text-[11.5px] text-muy">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion size={12} className={si ? "text-ok" : "text-mal"} />
          {si ? "Respondido" : "Sin responder"}
        </div>
        {si && e.respuestas && (
          <ul className="mt-1 flex flex-col gap-0.5 pl-5">
            {Object.entries(e.respuestas).map(([p, r]) => (
              <li key={p} className="select-text">
                <span className="text-muy">{p}</span> <span className="text-tenue">→ {r}</span>
              </li>
            ))}
          </ul>
        )}
        {e.mensaje && <p className="mt-1 select-text whitespace-pre-wrap pl-5 text-tenue">«{e.mensaje}»</p>}
      </div>
    );
  }

  const respuestaDe = (i: number): string | null => {
    const lista = [...elegidas[i]];
    const libre = otra[i]?.trim();
    if (libre) lista.push(libre);
    return lista.length ? lista.join(", ") : null;
  };
  const completas = preguntas.every((_, i) => respuestaDe(i) !== null);
  const enviar = (forzadas?: (string | null)[]) => {
    const r: Record<string, string> = {};
    preguntas.forEach((p, i) => (r[p.question] = (forzadas?.[i] ?? respuestaDe(i)) as string));
    void contestarPreguntas(espacio, e.id, r);
  };
  // Una sola pregunta de una opción: elegir ya es responder.
  const directa = preguntas.length === 1 && !preguntas[0].multiSelect;

  const elegir = (i: number, label: string) => {
    if (directa) return enviar([label]);
    const multi = preguntas[i].multiSelect;
    setElegidas((prev) =>
      prev.map((l, k) => (k !== i ? l : multi ? (l.includes(label) ? l.filter((x) => x !== label) : [...l, label]) : [label])),
    );
    if (!multi) setOtra((prev) => prev.map((t, k) => (k === i ? null : t)));
  };
  const marcarOtra = (i: number) => {
    setOtra((prev) => prev.map((t, k) => (k === i ? (t === null ? "" : preguntas[i].multiSelect ? null : t) : t)));
    if (!preguntas[i].multiSelect) setElegidas((prev) => prev.map((l, k) => (k === i ? [] : l)));
  };

  return (
    <div className="overflow-hidden rounded-[10px] border border-acento/30 bg-acento/[0.03]">
      <div className="flex items-center gap-2 px-[11px] py-[9px] text-[12.5px]">
        <MessageCircleQuestion size={14} strokeWidth={1.8} className="flex-none text-acento" />
        <span>
          Claude te <b className="font-semibold">{preguntas.length > 1 ? "hace unas preguntas" : "hace una pregunta"}</b>
        </span>
      </div>
      <div className="flex flex-col gap-3 px-[11px] pb-2.5">
        {preguntas.map((p, i) => (
          <fieldset key={i} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[12.5px] text-texto">
              {p.header && (
                <span className="rounded bg-acento/15 px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide text-acento">
                  {p.header}
                </span>
              )}
              <span className="select-text">{p.question}</span>
              {p.multiSelect && <span className="text-[11px] text-muy">(puedes marcar varias)</span>}
            </legend>
            {p.options.map((o) => {
              const marcada = elegidas[i].includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => elegir(i, o.label)}
                  className={`flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left ${
                    marcada ? "border-claude bg-claude/10" : "border-borde2 hover:bg-hover"
                  }`}
                >
                  <Marca marcada={marcada} multi={!!p.multiSelect} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-texto">{o.label}</span>
                    {o.description && <span className="block text-[11.5px] leading-snug text-tenue">{o.description}</span>}
                  </span>
                </button>
              );
            })}
            <div
              className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 ${otra[i] !== null ? "border-claude bg-claude/10" : "border-borde2"}`}
            >
              <button type="button" onClick={() => marcarOtra(i)} className="flex items-center gap-2.5 text-[12.5px] text-tenue">
                <Marca marcada={otra[i] !== null} multi={!!p.multiSelect} />
                {otra[i] === null && "Otra…"}
              </button>
              {otra[i] !== null && (
                <input
                  autoFocus
                  value={otra[i] ?? ""}
                  onChange={(ev) => setOtra((prev) => prev.map((t, k) => (k === i ? ev.target.value : t)))}
                  onKeyDown={(ev) => {
                    // Intro aquí responde (si ya está todo), no aprueba nada a ciegas.
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      if (completas) enviar();
                    }
                  }}
                  placeholder="Escribe tu respuesta"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-texto outline-none placeholder:text-muy"
                />
              )}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-[11px] pb-2.5">
        {(!directa || otra[0] !== null) && (
          <button
            type="button"
            disabled={!completas}
            onClick={() => enviar()}
            className="flex h-7 items-center gap-1.5 rounded-md border border-claude bg-claude px-2.5 text-[12px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Responder
          </button>
        )}
        <BotonPlan tecla="Esc" onClick={() => void responder(espacio, e.id, "denegar")}>
          No responder
        </BotonPlan>
      </div>
    </div>
  );
}

function Marca({ marcada, multi }: { marcada: boolean; multi: boolean }) {
  return (
    <span
      className={`mt-0.5 grid size-3.5 flex-none place-items-center border ${multi ? "rounded-[3px]" : "rounded-full"} ${
        marcada ? "border-claude bg-claude text-white" : "border-borde2"
      }`}
    >
      {marcada && (multi ? <Check size={10} strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-white" />)}
    </span>
  );
}

function BotonPlan({ principal, tecla, onClick, children }: { principal?: boolean; tecla?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] ${
        principal ? "border-claude bg-claude font-medium text-white hover:brightness-110" : "border-borde2 text-tenue hover:bg-hover hover:text-texto"
      }`}
    >
      {children}
      {tecla && (
        <kbd className={`hidden rounded px-1 font-ui text-[10px] group-focus-within/claude:inline ${principal ? "bg-white/20 text-white" : "bg-hover text-muy"}`}>
          {tecla}
        </kbd>
      )}
    </button>
  );
}

/**
 * Botón «Volver aquí» de un mensaje tuyo (se ve al pasar por encima). Abre un menú con lo que
 * se puede deshacer; los archivos solo con Claude en marcha y si cambió alguno.
 */
export function VolverAqui({ espacio, entrada, tieneUuid }: { espacio: string; entrada: number; tieneUuid: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [cambios, setCambios] = useState<CambiosVuelta | null | undefined>(undefined);
  const enMarcha = useClaude((s) => s.conversaciones[espacio]?.claudeId != null);
  const ocupado = useClaude((s) => {
    const e = s.conversaciones[espacio]?.estado;
    return e === "arrancando" || e === "pensando";
  });
  const caja = useRef<HTMLDivElement>(null);

  // «Volver a este punto» del menú de un mensaje de Claude abre este (el del mensaje tuyo siguiente).
  useEffect(() => {
    const abrir = (ev: Event) => {
      const d = (ev as CustomEvent<{ cid: string; entrada: number }>).detail;
      if (d.cid !== espacio || d.entrada !== entrada) return;
      caja.current?.scrollIntoView({ block: "center" });
      setAbierto(true);
    };
    window.addEventListener("kyu-volver", abrir);
    return () => window.removeEventListener("kyu-volver", abrir);
  }, [espacio, entrada]);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setCambios(undefined);
    void cambiosAlVolver(espacio, entrada).then((r) => vivo && setCambios(r));
    const fuera = (ev: MouseEvent) => {
      if (!caja.current?.contains(ev.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => {
      vivo = false;
      document.removeEventListener("mousedown", fuera);
    };
  }, [abierto, espacio, entrada]);

  if (ocupado) return null;
  const archivos = cambios?.canRewind ? (cambios.filesChanged?.length ?? 0) : 0;
  const hacer = (que: Vuelta) => {
    setAbierto(false);
    void volver(espacio, entrada, que);
  };

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        title="Volver a antes de este mensaje"
        onClick={() => setAbierto((a) => !a)}
        className={`grid size-6 place-items-center rounded-md text-muy hover:bg-hover hover:text-texto ${abierto ? "bg-hover text-texto" : "opacity-0 group-hover/tu:opacity-100"}`}
      >
        <RotateCcw size={12.5} strokeWidth={1.9} />
      </button>
      {abierto && (
        <div className="absolute left-0 top-7 z-30 w-[250px] overflow-hidden rounded-lg border border-borde2 bg-tarjeta py-1 text-[12px] shadow-xl">
          <p className="px-3 pb-1.5 pt-1 text-[11px] text-muy">Volver a antes de este mensaje</p>
          {enMarcha && tieneUuid && cambios === undefined ? (
            <p className="flex items-center gap-1.5 px-3 py-1.5 text-tenue">
              <Loader2 size={12} className="animate-spin" /> Mirando qué archivos cambiaron…
            </p>
          ) : archivos > 0 ? (
            <>
              <Opcion onClick={() => hacer("todo")} titulo="Conversación y archivos" detalle={detalleArchivos(cambios!)} />
              <Opcion onClick={() => hacer("conversacion")} titulo="Solo la conversación" detalle="Los archivos se quedan como están" />
              <Opcion onClick={() => hacer("archivos")} titulo="Solo los archivos" detalle="La conversación sigue igual" />
            </>
          ) : (
            <>
              <Opcion onClick={() => hacer("conversacion")} titulo="Volver aquí" detalle="El mensaje vuelve a la caja para cambiarlo" />
              <p className="px-3 pb-1 pt-0.5 text-[11px] text-muy">
                {!enMarcha || !tieneUuid ? "Los archivos solo se pueden devolver con Claude en marcha en esta conversación." : "Claude no ha cambiado archivos desde aquí."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const detalleArchivos = (c: CambiosVuelta) => {
  const n = c.filesChanged?.length ?? 0;
  const partes = [`${n} ${n === 1 ? "archivo" : "archivos"}`];
  if (c.insertions || c.deletions) partes.push(`+${c.insertions ?? 0} −${c.deletions ?? 0}`);
  return partes.join(" · ");
};

function Opcion({ titulo, detalle, onClick }: { titulo: string; detalle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-hover">
      <span className="block text-texto">{titulo}</span>
      <span className="block text-[11px] text-muy">{detalle}</span>
    </button>
  );
}
