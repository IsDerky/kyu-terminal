// Barra del runbook (F1, variante C): encima de la caja, solo el paso que toca.
import { useMemo, useState } from "react";
import { Check, SkipForward, SquareTerminal } from "lucide-react";
import type { Conversacion } from "../lib/claude";
import { nombreDestino } from "../lib/comandoClaude";
import { esRunbook, pasoHecho, pasosDe, prepararPaso, saltarPaso, useRunbook } from "../lib/runbook";

const COLOR: Record<string, string> = {
  powershell: "border-[#33335a] text-[#a5b4fc]",
  wsl: "border-[#4a3c14] text-[#fcd34d]",
  ssh: "border-[#164e57] text-[#67e8f9]",
};

export default function BarraRunbook({ cid, c }: { cid: string; c: Conversacion }) {
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  // La última respuesta, si no hay un mensaje tuyo después.
  const ultima = c.entradas[c.entradas.length - 1]?.tipo === "claude" ? c.entradas[c.entradas.length - 1] : undefined;
  const texto = ultima?.tipo === "claude" ? ultima.texto : "";
  const pasos = useMemo(() => pasosDe(texto), [texto]);
  const progreso = useRunbook((s) => (ultima && s.porConv[cid]?.entrada === ultima.id ? s.porConv[cid] : null));
  const [sinSalida, setSinSalida] = useState(false);
  if (ocupado || !ultima || !esRunbook(texto, pasos)) return null;
  const i = progreso?.paso ?? 0;
  if (i >= pasos.length) return null;
  const paso = pasos[i];

  return (
    // Mismo ancho que la caja (centrada con el panel ancho).
    <div className="flex-none px-3">
      <div className="mx-auto mb-0.5 flex w-full max-w-[780px] flex-col gap-1 rounded-lg border border-acento/35 bg-[#141219] px-2.5 py-1.5 text-[12px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex-none rounded border px-1.5 text-[11px] ${COLOR[paso.destino.tipo]}`} title={`Paso ${i + 1} de ${pasos.length}`}>
            {i + 1}/{pasos.length} · {nombreDestino(paso.destino)}
          </span>
          <code
            className="min-w-0 flex-1 truncate rounded border border-borde bg-fondo px-1.5 py-[1px] font-mono text-[11.5px] text-texto"
            title={paso.codigo}
          >
            {paso.codigo.split("\n")[0]}
            {paso.codigo.includes("\n") && <span className="text-muy"> …</span>}
          </code>
          <button
            type="button"
            title="La deja escrita en su terminal, sin Intro"
            onClick={() => void prepararPaso(cid, ultima.id, paso)}
            className="flex h-6 flex-none items-center gap-1 rounded-md border border-acento bg-acento px-2 text-[11.5px] font-medium text-fondo hover:brightness-110"
          >
            <SquareTerminal size={12} /> Preparar
          </button>
          <button
            type="button"
            title={i + 1 < pasos.length ? "Adjunta su salida y pasa al siguiente" : "Adjunta la salida para mandarla"}
            onClick={() => {
              setSinSalida(!pasoHecho(cid, ultima.id, paso, pasos.length));
              // El siguiente ya queda escrito en su terminal.
              const siguiente = pasos[i + 1];
              if (siguiente) void prepararPaso(cid, ultima.id, siguiente);
            }}
            className="flex h-6 flex-none items-center gap-1 rounded-md border border-borde2 px-2 text-[11.5px] text-tenue hover:bg-hover hover:text-texto"
          >
            <Check size={12} /> Hecho
          </button>
          <button
            type="button"
            title="Saltar este paso"
            onClick={() => saltarPaso(cid, ultima.id)}
            className="grid size-6 flex-none place-items-center rounded text-muy hover:bg-hover hover:text-texto"
          >
            <SkipForward size={12} />
          </button>
        </div>
        {(paso.titulo || sinSalida) && (
          <p className="truncate pl-0.5 text-[11px] text-muy">
            {sinSalida ? "El paso anterior no dejó salida que adjuntar (en ssh no se ve): cópiala si hace falta." : paso.titulo}
          </p>
        )}
      </div>
    </div>
  );
}
