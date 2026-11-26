import { useEffect } from "react";
import { Check, ClipboardList, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { corto, useGasto } from "../lib/gasto";
import { espacioDe, irAConversacion, panelMuestra, pendiente, responder, sitioDe, useClaude, type AvisoFin } from "../lib/claude";
import { useKyu } from "../lib/estado";
import { herramienta, partirRuta, relativa } from "../lib/herramientas";
import { nombreEspacio } from "./BarraTitulo";
import { IconoRun } from "./BarraEstado";
import { useGit, type AvisoCI } from "../lib/git";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Mascota } from "./iconos";

const DURACION_FIN = 8000;

/** Lleva a la pestaña de esa conversación con el cursor en la caja. */
const ver = (cid: string) => irAConversacion(cid);

/**
 * Avisos flotantes de Claude cuando su pestaña no se ve (otra pestaña delante u otro espacio):
 * permisos pendientes, que se contestan desde aquí, y turnos terminados.
 */
export default function Avisos() {
  const conversaciones = useClaude((s) => s.conversaciones);
  const avisos = useClaude((s) => s.avisos);
  // Lo que se ve cambia con las pestañas, el espacio, Ajustes y Uso.
  const espacios = useKyu((s) => s.espacios);
  useKyu((s) => s.activo);
  useKyu((s) => s.items);
  useKyu((s) => s.ajustes);
  useKyu((s) => s.uso);

  const muestra = (cid: string) => panelMuestra(cid);
  const existe = (cid: string) => sitioDe(cid) !== null;
  const nombre = (cid: string) => {
    const esp = espacios.find((e) => e.id === espacioDe(cid));
    return espacios.length > 1 && esp ? nombreEspacio(esp) : null;
  };

  const permisos = Object.keys(conversaciones).flatMap((cid) => {
    const c = conversaciones[cid];
    const p = pendiente(c);
    return p && existe(cid) && !muestra(cid) ? [{ espacio: cid, p, carpeta: c!.carpeta }] : [];
  });
  const fines = avisos.filter((a) => !muestra(a.espacio) && existe(a.espacio));

  // Lo que ya se ve no hace falta avisarlo.
  useEffect(() => {
    const vistos = avisos.filter((a) => muestra(a.espacio) || !existe(a.espacio));
    for (const a of vistos) useClaude.getState().quitarAviso(a.id);
  });

  const gasto = useGasto((s) => s.aviso);
  const ci = useGit((s) => s.avisos);
  if (!permisos.length && !fines.length && !gasto && !ci.length) return null;
  return (
    <div className="pointer-events-none absolute bottom-8 right-3 z-40 flex w-[330px] flex-col gap-2">
      {permisos.map(({ espacio, p, carpeta }) => {
        const [accion] = herramienta(p.herramienta);
        const resumen = relativa(p.resumen, carpeta);
        const ruta = partirRuta(p.herramienta, resumen);
        // Un plan o unas preguntas no se aprueban a ciegas: solo se ofrece verlos.
        if (p.herramienta === "ExitPlanMode" || p.herramienta === "AskUserQuestion") {
          const plan = p.herramienta === "ExitPlanMode";
          return (
            <Recuadro key={p.id} espacio={nombre(espacio)} onCerrar={null} onClick={() => ver(espacio)}>
              <div className="flex items-center gap-2 text-[12.5px]">
                <ClipboardList size={14} strokeWidth={1.8} className="flex-none text-acento" />
                {plan ? "Tiene un plan listo para que lo revises" : "Te ha hecho una pregunta"}
              </div>
              <p className="mt-1 text-[11.5px] text-muy">Clic para verlo</p>
            </Recuadro>
          );
        }
        return (
          <Recuadro key={p.id} espacio={nombre(espacio)} onCerrar={null}>
            <div className="flex min-w-0 items-start gap-2 text-[12.5px]">
              <ShieldAlert size={14} strokeWidth={1.8} className="mt-0.5 flex-none text-aviso" />
              <span className="min-w-0">
                Quiere usar <b className="font-semibold">{accion}</b>{" "}
                {ruta ? (
                  <>
                    <span className="font-mono text-[12px]">{ruta[0]}</span>
                    {ruta[1] && <span className="block truncate font-mono text-[11px] text-muy">{ruta[1]}</span>}
                  </>
                ) : (
                  <span className="line-clamp-2 break-all font-mono text-[11.5px] text-tenue">{resumen}</span>
                )}
              </span>
            </div>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => void responder(espacio, p.id, "permitir")}
                className="flex h-7 items-center gap-1.5 rounded-md border border-claude bg-claude px-2.5 text-[12px] font-medium text-white hover:brightness-110"
              >
                <Check size={13} /> Permitir
              </button>
              <button
                type="button"
                onClick={() => void responder(espacio, p.id, "denegar")}
                className="h-7 rounded-md border border-borde2 px-2.5 text-[12px] text-tenue hover:bg-hover hover:text-texto"
              >
                Denegar
              </button>
              <button
                type="button"
                onClick={() => ver(espacio)}
                className="ml-auto h-7 rounded-md px-2.5 text-[12px] text-tenue hover:bg-hover hover:text-texto"
              >
                Ver detalle
              </button>
            </div>
          </Recuadro>
        );
      })}
      {gasto && (
        <Recuadro espacio={null} onCerrar={() => useGasto.setState({ aviso: null })}>
          <div className="flex items-center gap-2 text-[12.5px]">
            <TriangleAlert size={14} strokeWidth={1.8} className={`flex-none ${gasto.nivel === 100 ? "text-mal" : "text-aviso"}`} />
            <span className="font-medium">{gasto.nivel === 100 ? "Has pasado el límite de hoy" : "Llevas el 80 % del límite de hoy"}</span>
          </div>
          <p className="mt-1 text-[12px] text-tenue">
            {corto(gasto.hoy)} de {corto(gasto.limite)} tokens de salida. No se corta nada; cámbialo en Ajustes → Agentes.
          </p>
        </Recuadro>
      )}
      {fines.map((a) => (
        <AvisoTerminado key={a.id} aviso={a} espacio={nombre(a.espacio)} />
      ))}
      {ci.map((a) => (
        <AvisoDeCI key={a.id} aviso={a} />
      ))}
    </div>
  );
}

function AvisoTerminado({ aviso: a, espacio }: { aviso: AvisoFin; espacio: string | null }) {
  const quitar = () => useClaude.getState().quitarAviso(a.id);
  useEffect(() => {
    const t = setTimeout(quitar, DURACION_FIN);
    return () => clearTimeout(t);
  }, []);
  const segundos = (a.duracion / 1000).toLocaleString("es-ES", { maximumFractionDigits: a.duracion < 10_000 ? 1 : 0 });
  return (
    <Recuadro espacio={espacio} onCerrar={quitar} onClick={() => ver(a.espacio)}>
      <div className="flex items-center gap-1.5 text-[12.5px]">
        {a.error ? <X size={13} className="text-mal" /> : <Check size={13} className="text-ok" />}
        <span className="font-medium">{a.error ? "Ha terminado con un error" : "Ha terminado"}</span>
        <span className="text-muy">· {segundos} s</span>
      </div>
      {a.texto && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-tenue">{a.texto}</p>}
    </Recuadro>
  );
}

function Recuadro({
  espacio,
  onCerrar,
  onClick,
  children,
}: {
  espacio: string | null;
  onCerrar: (() => void) | null;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`aviso-entra pointer-events-auto rounded-[10px] border border-claude/40 bg-panel px-3 pb-2.5 pt-2 shadow-[0_0_0_3px_#d977570a,0_16px_40px_-12px_#000000cc] ${
        onClick ? "cursor-pointer hover:border-claude/60" : ""
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-tenue">
        <Mascota alto={12} />
        <span className="font-semibold text-texto">Claude</span>
        {espacio && <span className="truncate">· {espacio}</span>}
        {onCerrar && (
          <button
            type="button"
            title="Cerrar"
            onClick={(e) => {
              e.stopPropagation();
              onCerrar();
            }}
            className="-mr-1 ml-auto grid size-5 place-items-center rounded text-muy hover:bg-hover hover:text-texto"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Un run de CI que acaba de terminar: en verde se va solo; en rojo se queda hasta cerrarlo. */
function AvisoDeCI({ aviso: a }: { aviso: AvisoCI }) {
  const quitar = () => useGit.getState().quitarAviso(a.id);
  const bien = a.run.conclusion === "success";
  useEffect(() => {
    if (!bien) return;
    const t = setTimeout(quitar, 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const repo = a.repo.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const titulo = bien ? "en verde" : a.run.conclusion === "cancelled" ? "cancelado" : "en rojo";
  return (
    <div
      onClick={() => void openUrl(a.run.url)}
      className={`aviso-entra pointer-events-auto cursor-pointer rounded-[10px] border bg-panel px-3 pb-2.5 pt-2 shadow-[0_16px_40px_-12px_#000000cc] ${
        bien ? "border-borde2 hover:border-ok/50" : "border-mal/50 hover:border-mal/70"
      }`}
    >
      <div className="mb-1 flex items-center gap-2 text-[11.5px] text-tenue">
        <IconoRun run={a.run} size={12} />
        <span className="font-semibold text-texto">
          {a.run.workflowName} {titulo}
        </span>
        <span className="truncate">· {repo}</span>
        <button
          type="button"
          title="Cerrar"
          onClick={(e) => {
            e.stopPropagation();
            quitar();
          }}
          className="-mr-1 ml-auto grid size-5 place-items-center rounded text-muy hover:bg-hover hover:text-texto"
        >
          <X size={12} />
        </button>
      </div>
      <p className="truncate text-[12px] text-tenue">
        <span className="font-mono text-[11.5px] text-acento2">{a.run.headBranch}</span> · {a.run.displayTitle}
      </p>
      <p className="mt-0.5 text-[11px] text-muy">Clic para verlo en GitHub</p>
    </div>
  );
}
