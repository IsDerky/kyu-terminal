import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { editor, obtenerEditor, saltar } from "../lib/editores";
import type { Item } from "../lib/estado";

type Archivo = Extract<Item, { tipo: "archivo" }>;

/** Muestra el editor de la pestaña (que vive en el registro, no aquí). */
export default function VistaArchivo({ archivo, conFoco }: { archivo: Archivo; conFoco: boolean }) {
  const caja = useRef<HTMLDivElement>(null);
  const ed = obtenerEditor(archivo.id, archivo.ruta);
  const [error, setError] = useState<string | null>(ed.error);

  useEffect(() => {
    caja.current!.appendChild(ed.elemento);
    void ed.cargado.then(() => setError(ed.error));
    return () => ed.elemento.remove();
  }, [ed]);

  // Cada vez que se pide abrir el archivo en una línea (Ctrl+Clic en un enlace).
  useEffect(() => {
    void saltar(archivo.id, archivo.linea, archivo.columna);
  }, [archivo.id, archivo.salto, archivo.linea, archivo.columna]);

  useEffect(() => {
    if (conFoco) editor(archivo.id)?.vista.focus();
  }, [conFoco, archivo.id]);

  const abrirEnVsCode = () => {
    const pos = editor(archivo.id)?.vista.state;
    const linea = pos ? pos.doc.lineAt(pos.selection.main.head).number : archivo.linea;
    void openUrl(`vscode://file/${archivo.ruta.replace(/\\/g, "/")}:${linea}`);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={caja} className="h-full w-full" />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-fondo p-6 text-center text-[13px] text-tenue">
            <p>
              No se puede abrir <span className="font-mono text-texto">{archivo.ruta}</span>: {error}
            </p>
          </div>
        )}
      </div>
      <div className="flex h-[22px] flex-none items-center gap-3.5 whitespace-nowrap border-t border-borde px-2.5 text-[11px] text-muy">
        <span className="flex-none">{ed.lenguaje}</span>
        <span className="min-w-0 flex-1 truncate font-mono" title={archivo.ruta}>
          {archivo.ruta}
        </span>
        <button type="button" onClick={abrirEnVsCode} className="flex-none hover:text-texto">
          Abrir en VS Code
        </button>
        <span className={`flex-none ${archivo.sucio ? "text-aviso" : ""}`}>
          {archivo.sucio ? "Sin guardar · Ctrl+S" : "Guardado"}
        </span>
      </div>
    </div>
  );
}
