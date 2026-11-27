import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Perfil } from "../lib/nucleo";
import { IconoPerfil } from "./iconos";

/** Así empiezan los perfiles que salen de ~/.ssh/config (config.rs). */
const PREFIJO_SSH = "SSH · ";

interface Props {
  perfiles: Perfil[];
  alElegir: (nombre: string) => void;
  alCerrar: () => void;
  /** Hacia dónde se abre respecto al botón. */
  alinear?: "izquierda" | "derecha";
  /** Lo que va debajo de los perfiles (en el de espacios: abrir carpeta y recientes). */
  pie?: React.ReactNode;
  /** Pestañas que no son terminales (conversaciones, visor de archivos), debajo de los perfiles. */
  otras?: Otra[];
}

interface Otra {
  icono: React.ReactNode;
  texto: string;
  hacer?: () => void;
  /** Con hijos, al pulsar se despliegan (p. ej. el visor: este PC o un servidor). */
  hijos?: { texto: string; detalle?: string; color?: string; hacer: () => void }[];
}

/** Menú desplegable con los perfiles de shell. */
export default function MenuPerfiles({ perfiles, alElegir, alCerrar, alinear = "izquierda", pie, otras }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [desplegada, setDesplegada] = useState<string | null>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) alCerrar();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && alCerrar();
    window.addEventListener("mousedown", fuera);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", fuera);
      window.removeEventListener("keydown", esc);
    };
  }, [alCerrar]);

  return (
    <div
      ref={caja}
      className={`absolute top-7 z-50 max-h-[calc(100vh-70px)] w-56 overflow-y-auto rounded-lg border border-borde2 bg-tarjeta p-1 shadow-[0_18px_40px_-14px_#000e] ${
        alinear === "izquierda" ? "left-0" : "right-0"
      }`}
    >
      <div className="px-2 pb-1 pt-1.5 text-[11px] uppercase tracking-wider text-muy">Nueva pestaña</div>
      {perfiles.map((p, i) => {
        const ssh = p.nombre.startsWith(PREFIJO_SSH);
        const primeroSsh = ssh && !perfiles[i - 1]?.nombre.startsWith(PREFIJO_SSH);
        return (
        <Fragment key={p.nombre}>
        {primeroSsh && <div className="mt-1 border-t border-borde px-2 pb-1 pt-2 text-[11px] uppercase tracking-wider text-muy">Servidores (ssh)</div>}
        <button
          key={p.nombre}
          type="button"
          onClick={() => alElegir(p.nombre)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-texto hover:bg-hover"
        >
          <IconoPerfil perfil={p} />
          <span className="flex-1 truncate">{ssh ? p.nombre.slice(PREFIJO_SSH.length) : p.nombre}</span>
          {i === 0 && <span className="text-[11px] text-muy">predeterminado</span>}
        </button>
        </Fragment>
        );
      })}
      {otras?.length ? (
        <div className="mt-1 border-t border-borde pt-1">
          {otras.map((o) => (
            <Fragment key={o.texto}>
              <button
                type="button"
                onClick={() => {
                  if (o.hijos) return setDesplegada(desplegada === o.texto ? null : o.texto);
                  alCerrar();
                  o.hacer?.();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-texto hover:bg-hover"
              >
                {o.icono}
                <span className="flex-1 truncate">{o.texto}</span>
                {o.hijos && (desplegada === o.texto ? <ChevronDown size={12} className="text-muy" /> : <ChevronRight size={12} className="text-muy" />)}
              </button>
              {desplegada === o.texto &&
                o.hijos?.map((h) => (
                  <button
                    key={h.texto}
                    type="button"
                    onClick={() => {
                      alCerrar();
                      h.hacer();
                    }}
                    className="flex w-full items-center gap-2 rounded-md py-1 pl-[34px] pr-2 text-left text-[12px] text-texto hover:bg-hover"
                    style={{ color: h.color }}
                  >
                    <span className="flex-1 truncate">{h.texto}</span>
                    {h.detalle && <span className="text-[11px] text-muy">{h.detalle}</span>}
                  </button>
                ))}
            </Fragment>
          ))}
        </div>
      ) : null}
      {pie}
    </div>
  );
}
