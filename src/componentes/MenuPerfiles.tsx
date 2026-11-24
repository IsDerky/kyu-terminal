import { useEffect, useRef } from "react";
import type { Perfil } from "../lib/nucleo";
import { IconoPerfil } from "./iconos";

interface Props {
  perfiles: Perfil[];
  alElegir: (nombre: string) => void;
  alCerrar: () => void;
  /** Hacia dónde se abre respecto al botón. */
  alinear?: "izquierda" | "derecha";
}

/** Menú desplegable con los perfiles de shell. */
export default function MenuPerfiles({ perfiles, alElegir, alCerrar, alinear = "izquierda" }: Props) {
  const caja = useRef<HTMLDivElement>(null);
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
      className={`absolute top-7 z-50 w-56 rounded-lg border border-borde2 bg-tarjeta p-1 shadow-[0_18px_40px_-14px_#000e] ${
        alinear === "izquierda" ? "left-0" : "right-0"
      }`}
    >
      <div className="px-2 pb-1 pt-1.5 text-[11px] uppercase tracking-wider text-muy">Nueva pestaña</div>
      {perfiles.map((p, i) => (
        <button
          key={p.nombre}
          type="button"
          onClick={() => alElegir(p.nombre)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-texto hover:bg-hover"
        >
          <IconoPerfil perfil={p} />
          <span className="flex-1">{p.nombre}</span>
          {i === 0 && <span className="text-[11px] text-muy">predeterminado</span>}
        </button>
      ))}
    </div>
  );
}
