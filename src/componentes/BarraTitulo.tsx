import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const ventana = getCurrentWindow();

interface Props {
  titulo: string;
}

/** Barra propia (la ventana va sin marco): logo, la pestaña y los botones de la ventana. */
export default function BarraTitulo({ titulo }: Props) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-10 flex-none items-stretch border-b border-borde bg-barra"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 px-3.5 font-mono text-[13px] font-bold">
        <span className="grid size-[18px] place-items-center rounded-[5px] bg-texto text-[11px] text-fondo">k</span>
        kyu
      </div>

      <div data-tauri-drag-region className="flex items-end px-1">
        <div className="mb-1.5 flex h-7 max-w-64 items-center gap-2 rounded-[7px] border border-[#26262c] bg-hover px-3 text-[12.5px] text-texto">
          <span className="size-1.5 flex-none rounded-full bg-acento" />
          <span className="truncate">{titulo}</span>
        </div>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      <div className="flex">
        <BotonVentana titulo="Minimizar" onClick={() => void ventana.minimize()}>
          <Minus size={15} strokeWidth={1.8} />
        </BotonVentana>
        <BotonVentana titulo="Maximizar" onClick={() => void ventana.toggleMaximize()}>
          <Square size={12} strokeWidth={1.8} />
        </BotonVentana>
        <BotonVentana titulo="Cerrar" cerrar onClick={() => void ventana.close()}>
          <X size={15} strokeWidth={1.8} />
        </BotonVentana>
      </div>
    </header>
  );
}

function BotonVentana({
  titulo,
  cerrar,
  onClick,
  children,
}: {
  titulo: string;
  cerrar?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      className={`grid w-11 place-items-center text-tenue transition-colors hover:text-texto ${
        cerrar ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}
