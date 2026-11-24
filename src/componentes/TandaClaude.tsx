// Piezas del panel de Claude de la tanda C: razonamiento, subagentes, plan y puntos de control.
import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight, ClipboardList, Loader2, RotateCcw } from "lucide-react";
import {
  cambiosAlVolver,
  responder,
  useClaude,
  volver,
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
