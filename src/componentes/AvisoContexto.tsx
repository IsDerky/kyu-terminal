// Aviso al final de la conversación cuando el contexto pasa de UMBRAL tokens: cada mensaje
// vuelve a leerlo entero, así que sale más barato compactar o apuntar lo hecho y empezar
// de cero. Solo con Claude (los agentes por ACP no tienen /compact).
import { useState } from "react";
import { Layers, NotebookPen, X } from "lucide-react";
import { enviar, type Conversacion } from "../lib/claude";

export const UMBRAL = 150_000;
/** Tras «Ahora no», vuelve a salir al crecer esto más. */
const PASO = 50_000;

/** Lo que se ha hecho en cada conversación (sobrevive a mover la pestaña). */
const ocultoHasta = new Map<string, number>();
const documentadas = new Set<string>();

const k = (n: number) => `${Math.round(n / 1000)} k`;

export default function AvisoContexto({ cid, c }: { cid: string; c: Conversacion }) {
  const [, refrescar] = useState(0);
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  if (c.agente || ocupado || c.tokens < UMBRAL || c.tokens < (ocultoHasta.get(cid) ?? 0)) return null;
  const documentada = documentadas.has(cid);

  const boton = "flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11.5px]";
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 rounded-lg border border-aviso/30 bg-aviso/[0.06] px-2.5 py-1.5 text-[12px] text-tenue">
      <span className="min-w-[180px] flex-1">
        {documentada ? (
          <>Lo hecho ya está apuntado. Empieza una conversación nueva con <b className="font-medium text-texto">/clear</b>.</>
        ) : (
          <>
            Esta conversación lleva <b className="font-medium text-texto">{k(c.tokens)}</b> de contexto y cada mensaje lo vuelve a leer entero.
          </>
        )}
      </span>
      {documentada ? (
        <button type="button" onClick={() => void enviar(cid, "/clear")} className={`${boton} border-acento/60 bg-acento/15 text-texto hover:bg-acento/25`}>
          /clear
        </button>
      ) : (
        <>
          <button type="button" title="Resume la conversación y sigue en ella" onClick={() => void enviar(cid, "/compact")} className={`${boton} border-borde2 text-tenue hover:bg-hover hover:text-texto`}>
            <Layers size={12} /> /compact
          </button>
          <button
            type="button"
            title="Pide a Claude que apunte lo hecho en la memoria; después, /clear"
            onClick={() => {
              documentadas.add(cid);
              void enviar(cid, "documenta");
              refrescar((n) => n + 1);
            }}
            className={`${boton} border-borde2 text-tenue hover:bg-hover hover:text-texto`}
          >
            <NotebookPen size={12} /> Documenta y /clear
          </button>
        </>
      )}
      <button
        type="button"
        title="Ahora no (vuelve a salir si crece mucho más)"
        onClick={() => {
          ocultoHasta.set(cid, c.tokens + PASO);
          documentadas.delete(cid);
          refrescar((n) => n + 1);
        }}
        className="grid size-6 flex-none place-items-center rounded text-muy hover:bg-hover hover:text-texto"
      >
        <X size={12} />
      </button>
    </div>
  );
}
