// Pestaña «Visor de archivos»: el árbol de una carpeta a la izquierda y, en la misma
// pestaña, el archivo que se elige en él (con el editor de Kyu). Elegir otro cambia el de
// la derecha; no abre pestañas nuevas.
import { lazy, Suspense, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { FileSearch, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useKyu, type Item } from "../lib/estado";
import { destruirEditor } from "../lib/editores";
import VistaArbol from "./VistaArbol";
const VistaArchivo = lazy(() => import("./VistaArchivo"));

type Visor = Extract<Item, { tipo: "visor" }>;

/** Árbol plegado de cada visor (sobrevive a mover o dividir el panel). */
const plegados = new Set<string>();

export default function VistaVisor({ visor, conFoco }: { visor: Visor; conFoco: boolean }) {
  const [plegado, setPlegado] = useState(() => plegados.has(visor.id));
  const plegar = (p: boolean) => {
    if (p) plegados.add(visor.id);
    else plegados.delete(visor.id);
    setPlegado(p);
  };

  const elegir = async (ruta: string) => {
    if (visor.ruta && ruta.toLowerCase() === visor.ruta.toLowerCase()) return;
    if (visor.sucio) {
      const nombre = visor.ruta?.split(/[\\/]/).pop();
      const seguro = await ask(`${nombre} tiene cambios sin guardar. ¿Abrir otro y perderlos?`, {
        title: "Kyu",
        kind: "warning",
        okLabel: "Abrir sin guardar",
        cancelLabel: "Cancelar",
      });
      if (!seguro) return;
    }
    // El editor va con el id de la pestaña: uno por visor, se rehace con cada archivo.
    destruirEditor(visor.id);
    useKyu.getState().verEnVisor(visor.id, ruta);
  };

  return (
    <div className="flex h-full w-full min-w-0">
      {plegado ? (
        <div className="flex w-8 flex-none flex-col items-center border-r border-borde bg-panel pt-1.5 text-muy">
          <button type="button" title="Enseñar el árbol" onClick={() => plegar(false)} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-texto">
            <PanelLeftOpen size={13} />
          </button>
        </div>
      ) : (
        <div className="flex w-64 flex-none flex-col border-r border-borde">
          <VistaArbol
            item={visor.id}
            raizFija={visor.raiz}
            alAbrir={(r) => void elegir(r)}
            elegido={visor.ruta}
            extra={
              <button type="button" title="Plegar el árbol" onClick={() => plegar(true)} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-texto">
                <PanelLeftClose size={13} />
              </button>
            }
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {visor.ruta ? (
          <Suspense fallback={null}>
            <VistaArchivo
              key={`${visor.id}|${visor.ruta}`}
              archivo={{ id: visor.id, tipo: "archivo", ruta: visor.ruta, sucio: visor.sucio, linea: 1, columna: 1, salto: 0 }}
              conFoco={conFoco}
            />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12.5px] text-muy">
            <FileSearch size={22} strokeWidth={1.5} />
            <p>Elige un archivo del árbol para verlo o editarlo aquí.</p>
          </div>
        )}
      </div>
    </div>
  );
}
