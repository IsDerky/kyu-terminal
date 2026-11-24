import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { enganchar, obtener, soltar } from "../lib/terminales";
import { useKyu } from "../lib/estado";
import type { ConfigVista } from "../lib/nucleo";
import CapaBloques from "./CapaBloques";

interface Props {
  item: string;
  conFoco: boolean;
  config: ConfigVista;
}

/** Muestra el terminal de la pestaña `item` (que vive en el registro, no aquí). */
export default function VistaTerminal({ item, conFoco, config }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const sesion = obtener(item);
  const buscando = useKyu((s) => s.buscando === item);
  const [, setLista] = useState(0);

  useEffect(() => {
    const div = caja.current!;
    void enganchar(item, div).then(() => setLista((n) => n + 1));
    // El tamaño se aplica una sola vez, cuando deja de cambiar. Si xterm y ConPTY pasan
    // por tamaños intermedios (al dividir), ConPTY repinta con un tamaño que xterm ya no
    // tiene, el texto se desborda al historial y se duplica (y los bloques se descolocan).
    let espera = 0;
    const observador = new ResizeObserver(() => {
      clearTimeout(espera);
      espera = window.setTimeout(() => {
        if (sesion.term.element && div.offsetWidth > 0) sesion.ajuste.fit();
      }, 100);
    });
    observador.observe(div);
    return () => {
      clearTimeout(espera);
      observador.disconnect();
      soltar(item);
    };
  }, [item, sesion]);

  useEffect(() => {
    if (conFoco && !buscando) sesion.term.focus();
  }, [conFoco, buscando, sesion]);

  return (
    <div className="relative h-full w-full py-2 pl-3.5 pr-1">
      <div data-kyu-terminal className="relative h-full w-full">
        <div ref={caja} className="h-full w-full" />
        {sesion.term.element && (
          <CapaBloques
            term={sesion.term}
            bloques={sesion.bloques}
            fuente={config.fuente}
            tamano={config.tema.fuente_tamano}
          />
        )}
      </div>
      {buscando && <BarraBusqueda item={item} />}
    </div>
  );
}

const DECORACIONES = {
  matchBackground: "#fbbf2433",
  matchBorder: "#fbbf2477",
  matchOverviewRuler: "#fbbf24",
  activeMatchBackground: "#fbbf24",
  activeMatchColorOverviewRuler: "#fbbf24",
};

function BarraBusqueda({ item }: { item: string }) {
  const sesion = obtener(item);
  const [texto, setTexto] = useState("");
  const [mayusculas, setMayusculas] = useState(false);
  const [regex, setRegex] = useState(false);
  const [resultado, setResultado] = useState<{ indice: number; total: number } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entrada.current?.focus();
    const d = sesion.busqueda.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResultado({ indice: resultIndex, total: resultCount }),
    );
    return () => {
      d.dispose();
      sesion.busqueda.clearDecorations();
    };
  }, [sesion]);

  const opciones = { caseSensitive: mayusculas, regex, decorations: DECORACIONES };
  const buscar = (adelante: boolean, incremental = false) => {
    if (!texto) {
      sesion.busqueda.clearDecorations();
      setResultado(null);
      return;
    }
    if (adelante) sesion.busqueda.findNext(texto, { ...opciones, incremental });
    else sesion.busqueda.findPrevious(texto, opciones);
  };

  useEffect(() => {
    buscar(true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, mayusculas, regex]);

  const cerrar = () => {
    useKyu.getState().ponerBuscando(null);
    sesion.term.focus();
  };

  return (
    <div className="absolute right-4 top-2.5 z-10 flex items-center gap-2 rounded-lg border border-borde2 bg-tarjeta py-1 pl-2.5 pr-1 text-[12px] text-tenue shadow-[0_10px_30px_-10px_#000c]">
      <input
        ref={entrada}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") buscar(!e.shiftKey);
          if (e.key === "Escape") cerrar();
        }}
        placeholder="Buscar"
        spellCheck={false}
        className="w-44 border-r border-borde bg-transparent pr-2 font-mono text-[12.5px] text-texto outline-none placeholder:text-muy"
      />
      <Conmutador activo={mayusculas} titulo="Distinguir mayúsculas" onClick={() => setMayusculas(!mayusculas)}>
        Aa
      </Conmutador>
      <Conmutador activo={regex} titulo="Expresión regular" onClick={() => setRegex(!regex)}>
        .*
      </Conmutador>
      <span className="min-w-14 text-center tabular-nums">
        {resultado && texto ? (resultado.total ? `${resultado.indice + 1} de ${resultado.total}` : "0 de 0") : ""}
      </span>
      <BotonIcono titulo="Anterior (Mayús+Intro)" onClick={() => buscar(false)}>
        <ChevronUp size={14} />
      </BotonIcono>
      <BotonIcono titulo="Siguiente (Intro)" onClick={() => buscar(true)}>
        <ChevronDown size={14} />
      </BotonIcono>
      <BotonIcono titulo="Cerrar (Esc)" onClick={cerrar}>
        <X size={14} />
      </BotonIcono>
    </div>
  );
}

function Conmutador({ activo, titulo, onClick, children }: { activo: boolean; titulo: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      className={`rounded px-1.5 font-mono text-[11px] ${activo ? "bg-hover text-texto" : "text-muy hover:text-tenue"}`}
    >
      {children}
    </button>
  );
}

function BotonIcono({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={titulo} onClick={onClick} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-texto">
      {children}
    </button>
  );
}
