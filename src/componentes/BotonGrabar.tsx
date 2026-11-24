import { useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { pararGrabacion, useGrabar } from "../lib/grabar";

/** En la barra de título: el punto rojo con el tiempo mientras se graba, y el resultado. */
export default function BotonGrabar() {
  const estado = useGrabar((s) => s.estado);
  const [, tic] = useState(0);
  useEffect(() => {
    if (estado.tipo !== "grabando") return;
    const t = setInterval(() => tic((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [estado.tipo]);

  switch (estado.tipo) {
    case "parado":
      return null;
    case "grabando": {
      const s = Math.floor((Date.now() - estado.desde) / 1000);
      return (
        <button
          type="button"
          title="Parar y guardar el GIF (Ctrl+Mayús+G)"
          onClick={() => void pararGrabacion()}
          className="mr-2 flex h-7 items-center gap-2 rounded-[7px] border border-mal/40 px-2.5 text-[12.5px] text-mal hover:bg-mal/10"
        >
          <span className="size-2 animate-pulse rounded-full bg-mal" />
          <span className="tabular-nums">
            {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
          </span>
          <span className="text-tenue">/ 1:00</span>
        </button>
      );
    }
    case "guardando":
      return (
        <span className="mr-2 flex h-7 items-center gap-2 px-2.5 text-[12.5px] text-tenue">
          <Loader2 size={12} className="animate-spin" /> Guardando GIF…
        </span>
      );
    case "hecho":
      return (
        <button
          type="button"
          title={estado.ruta}
          onClick={() => void revealItemInDir(estado.ruta)}
          className="mr-2 flex h-7 items-center gap-2 rounded-[7px] px-2.5 text-[12.5px] text-ok hover:bg-hover"
        >
          <FolderOpen size={13} strokeWidth={1.8} /> GIF guardado · ver
        </button>
      );
    case "error":
      return (
        <span title={estado.texto} className="mr-2 max-w-72 truncate px-2.5 text-[12px] text-mal">
          {estado.texto}
        </span>
      );
  }
}
