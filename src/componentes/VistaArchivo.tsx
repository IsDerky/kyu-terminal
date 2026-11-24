import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { Diff, Undo2, X } from "lucide-react";
import { editor, obtenerEditor, ponerDiff, recargarRuta, saltar } from "../lib/editores";
import { useKyu, type Item } from "../lib/estado";
import { borrarArchivo, guardarArchivo } from "../lib/nucleo";
import { contar, diffLineas } from "../lib/diff";
import { cerrarItem } from "../lib/acciones";

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

  // Marcas de los cambios de Claude.
  const antes = archivo.diff ? archivo.diff.antes : undefined;
  const [cuenta, setCuenta] = useState<{ puestas: number; quitadas: number } | null>(null);
  useEffect(() => {
    void ponerDiff(archivo.id, antes);
    if (antes === undefined) return setCuenta(null);
    void ed.cargado.then(() => setCuenta(contar(diffLineas(antes ?? "", ed.vista.state.doc.toString()))));
  }, [archivo.id, antes, ed]);

  const deshacer = async () => {
    if (antes === undefined) return;
    const nombre = archivo.ruta.split(/[\\/]/).pop();
    if (antes === null) {
      if (!(await ask(`Claude creó «${nombre}». ¿Borrarlo?`, { title: "Deshacer cambios", kind: "warning", okLabel: "Borrar", cancelLabel: "Cancelar" }))) return;
      await borrarArchivo(archivo.ruta).catch((e) => window.alert(String(e)));
      void cerrarItem(archivo.id, false);
      return;
    }
    const aviso = archivo.sucio ? " Lo que no has guardado se pierde." : "";
    if (!(await ask(`¿Dejar «${nombre}» como estaba antes de los cambios de Claude?${aviso}`, { title: "Deshacer cambios", kind: "warning", okLabel: "Deshacer", cancelLabel: "Cancelar" }))) return;
    await guardarArchivo(archivo.ruta, antes);
    ed.guardado = "";
    ed.vista.dispatch({ changes: { from: 0, to: ed.vista.state.doc.length, insert: antes } });
    ed.guardado = antes;
    useKyu.getState().marcarSucio(archivo.id, false);
    useKyu.getState().quitarDiff(archivo.id);
    recargarRuta(archivo.ruta);
  };

  const abrirEnVsCode = () => {
    const pos = editor(archivo.id)?.vista.state;
    const linea = pos ? pos.doc.lineAt(pos.selection.main.head).number : archivo.linea;
    void openUrl(`vscode://file/${archivo.ruta.replace(/\\/g, "/")}:${linea}`);
  };

  return (
    <div className="flex h-full w-full flex-col">
      {antes !== undefined && (
        <div className="flex h-8 flex-none items-center gap-2 overflow-hidden whitespace-nowrap border-b border-borde bg-claude/[0.07] pl-3 pr-2 text-[12px] text-claude2">
          <Diff size={13} strokeWidth={1.8} className="flex-none" />
          <span className="flex-none">{antes === null ? "Archivo nuevo de Claude" : "Cambios de Claude"}</span>
          {cuenta && (
            <span className="flex-none font-mono text-[11.5px]">
              <span className="text-ok">+{cuenta.puestas}</span> <span className="text-mal">−{cuenta.quitadas}</span>
            </span>
          )}
          <span className="flex-1" />
          <button type="button" onClick={() => void deshacer()} className="flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-md border border-borde2 px-2 text-[11.5px] text-tenue hover:bg-hover hover:text-texto">
            <Undo2 size={12} /> {antes === null ? "Borrar" : "Deshacer"}
          </button>
          <button type="button" onClick={() => useKyu.getState().quitarDiff(archivo.id)} className="flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-md border border-borde2 px-2 text-[11.5px] text-tenue hover:bg-hover hover:text-texto">
            <X size={12} /> Quitar marcas
          </button>
        </div>
      )}
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
