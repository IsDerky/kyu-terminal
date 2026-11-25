import { useMemo, useState } from "react";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useProblemas, type Problema } from "../lib/problemas";
import { resolverArchivo } from "../lib/nucleo";
import { useKyu } from "../lib/estado";
import { IconoArchivo } from "./iconos";

/** Errores y avisos del último build o lint del espacio, por archivo; clic → su línea. */
export default function VistaProblemas({ espacio }: { espacio: string }) {
  const r = useProblemas((s) => s.porEspacio[espacio]);
  const [filtro, setFiltro] = useState<"todo" | "error" | "aviso">("todo");
  const [noEncontrado, setNoEncontrado] = useState<string | null>(null);

  const porArchivo = useMemo(() => {
    const m = new Map<string, Problema[]>();
    for (const p of r?.lista ?? []) {
      if (filtro !== "todo" && p.nivel !== filtro) continue;
      m.set(p.ruta, [...(m.get(p.ruta) ?? []), p]);
    }
    return [...m.entries()];
  }, [r, filtro]);

  if (!r) {
    return (
      <div className="grid h-full place-items-center bg-panel p-6 text-center text-[12.5px] text-tenue">
        <p>
          Aquí salen los errores y avisos del último build o lint de este espacio
          <br />
          (tsc, eslint, cargo, next build…). Lanza uno en un terminal.
        </p>
      </div>
    );
  }

  const errores = r.lista.filter((p) => p.nivel === "error").length;
  const avisos = r.lista.length - errores;
  const abrir = async (p: Problema) => {
    const ruta = await resolverArchivo(p.ruta, r.carpeta).catch(() => null);
    if (!ruta) return setNoEncontrado(p.ruta);
    setNoEncontrado(null);
    useKyu.getState().abrirArchivo(ruta, p.linea, p.columna);
  };

  return (
    <div className="flex h-full flex-col bg-panel text-[12.5px]">
      <div className="flex flex-none items-center gap-3 border-b border-borde px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-tenue" title={r.carpeta ?? undefined}>
          {r.orden || "orden"} <span className="text-muy">· {r.hora}</span>
        </span>
        <span className="ml-auto flex flex-none gap-1">
          {(["todo", "error", "aviso"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={`flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11.5px] ${filtro === f ? "bg-hover text-texto" : "text-tenue hover:text-texto"}`}
            >
              {f === "todo" ? `Todo ${r.lista.length}` : f === "error" ? <><CircleX size={11} className="text-mal" /> {errores}</> : <><TriangleAlert size={11} className="text-aviso" /> {avisos}</>}
            </button>
          ))}
        </span>
      </div>

      {noEncontrado && <p className="flex-none px-3 py-1.5 text-[11.5px] text-aviso">No encuentro «{noEncontrado}» desde la carpeta de la orden.</p>}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {r.lista.length === 0 && (
          <p className="flex items-center gap-2 px-3 py-3 text-ok">
            <CircleCheck size={14} /> Sin problemas.
          </p>
        )}
        {porArchivo.map(([ruta, lista]) => (
          <div key={ruta} className="mb-1">
            <div className="flex items-center gap-1.5 px-3 py-1 text-texto">
              <IconoArchivo size={12} />
              <span className="truncate font-medium">{ruta.split(/[\\/]/).pop()}</span>
              <span className="truncate text-[11.5px] text-muy">{ruta}</span>
              <span className="ml-auto flex-none text-[11px] tabular-nums text-muy">{lista.length}</span>
            </div>
            {lista.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => void abrir(p)}
                className="flex w-full items-start gap-2 py-1 pl-7 pr-3 text-left hover:bg-hover"
              >
                {p.nivel === "error" ? <CircleX size={13} className="mt-px flex-none text-mal" /> : <TriangleAlert size={13} className="mt-px flex-none text-aviso" />}
                <span className="min-w-0 flex-1 text-tenue">
                  <span className="text-texto">{p.mensaje}</span>
                  {p.codigo && <span className="ml-2 font-mono text-[11px] text-muy">{p.codigo}</span>}
                </span>
                <span className="flex-none font-mono text-[11px] tabular-nums text-muy">
                  {p.linea}:{p.columna}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
