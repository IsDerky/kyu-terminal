import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BarChart3, ChevronDown, FolderTree, Layers, Minus, Plus, SlidersHorizontal, Square, X } from "lucide-react";
import { paneles, useKyu, type Espacio } from "../lib/estado";
import { cerrarItem } from "../lib/acciones";
import type { ConfigVista } from "../lib/nucleo";
import MenuPerfiles from "./MenuPerfiles";
import { LogoKyu, Mascota } from "./iconos";
import BotonGrabar from "./BotonGrabar";
import { useClaude } from "../lib/claude";
import { guardarSesion } from "../lib/restaurar";

const ventana = getCurrentWindow();

/**
 * Nombre del espacio: el que le pusiste o, si no, la carpeta de su terminal (el del
 * panel con el foco si es un terminal; si no, el primero que haya).
 */
export function nombreEspacio(e: Espacio): string {
  if (e.nombre) return e.nombre;
  const s = useKyu.getState();
  const lista = paneles(e.raiz);
  const conFoco = lista.find((p) => p.id === e.foco);
  const terminalDe = (p?: (typeof lista)[number]) => {
    const it = p?.activo ? s.items[p.activo] : undefined;
    return it?.tipo === "terminal" ? it : undefined;
  };
  // Si no se ve ningún terminal (p. ej. con «Archivos» delante), el primero que haya detrás.
  const escondido = () =>
    lista.flatMap((p) => p.items.map((i) => s.items[i])).find((it): it is Extract<typeof it, { tipo: "terminal" }> => it?.tipo === "terminal");
  const t = terminalDe(conFoco) ?? lista.map(terminalDe).find(Boolean) ?? escondido();
  if (t) return t.titulo;
  const a = conFoco?.activo ? s.items[conFoco.activo] : undefined;
  return a?.tipo === "archivo" ? a.ruta.split(/[\\/]/).pop()! : "Espacio";
}

/** Barra propia (la ventana va sin marco): logo, espacios de trabajo y botones de la ventana. */
export default function BarraTitulo({ config }: { config: ConfigVista }) {
  const espacios = useKyu((s) => s.espacios);
  const activo = useKyu((s) => s.activo);
  useKyu((s) => s.items); // los nombres dependen de los títulos de los terminales
  const { cambiarEspacio, nuevoEspacio, renombrarEspacio } = useKyu.getState();
  const [editando, setEditando] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const claude = useClaude((s) => s.visible);
  const ajustes = useKyu((s) => s.ajustes);
  const uso = useKyu((s) => s.uso);

  const cerrarEspacio = async (e: Espacio) => {
    for (const p of paneles(e.raiz)) for (const item of p.items) await cerrarItem(item);
  };

  return (
    <header data-tauri-drag-region className="flex h-10 flex-none items-center border-b border-borde bg-barra">
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3.5 pr-3 font-mono text-[13px] font-bold">
        <LogoKyu size={20} />
        kyu
      </div>

      <div className="flex min-w-0 items-center gap-1">
        {espacios.map((e, i) => {
          const esActivo = e.id === activo && !ajustes && !uso;
          return (
            <div
              key={e.id}
              onMouseDown={() => {
                cambiarEspacio(e.id);
                useKyu.getState().ponerAjustes(false);
                useKyu.getState().ponerUso(false);
              }}
              onDoubleClick={() => setEditando(e.id)}
              onAuxClick={(ev) => ev.button === 1 && void cerrarEspacio(e)}
              title={`Espacio ${i + 1} (Ctrl+${i + 1}) · doble clic para renombrar`}
              className={`group flex h-7 min-w-0 max-w-56 items-center gap-2 rounded-[7px] border pl-2.5 pr-1 text-[12.5px] ${
                esActivo ? "border-[#26262c] bg-hover text-texto" : "border-transparent text-tenue hover:text-texto"
              }`}
            >
              <Layers size={13} strokeWidth={1.8} className="flex-none" />
              {editando === e.id ? (
                <input
                  autoFocus
                  defaultValue={e.nombre ?? nombreEspacio(e)}
                  onBlur={(ev) => {
                    renombrarEspacio(e.id, ev.target.value.trim() || null);
                    setEditando(null);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                    if (ev.key === "Escape") setEditando(null);
                  }}
                  className="w-28 bg-transparent text-texto outline-none"
                />
              ) : (
                <span className="truncate">{nombreEspacio(e)}</span>
              )}
              <button
                type="button"
                title="Cerrar espacio"
                onMouseDown={(ev) => ev.stopPropagation()}
                onClick={() => void cerrarEspacio(e)}
                className={`grid size-4 flex-none place-items-center rounded text-muy hover:bg-borde2 hover:text-texto ${
                  esActivo ? "" : "invisible group-hover:visible"
                }`}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        {uso && (
          <div className="flex h-7 items-center gap-2 rounded-[7px] border border-[#26262c] bg-hover pl-2.5 pr-1 text-[12.5px] text-texto">
            <BarChart3 size={13} strokeWidth={1.8} className="flex-none" />
            Uso
            <button
              type="button"
              title="Cerrar"
              onClick={() => useKyu.getState().ponerUso(false)}
              className="grid size-4 flex-none place-items-center rounded text-muy hover:bg-borde2 hover:text-texto"
            >
              <X size={11} />
            </button>
          </div>
        )}
        {ajustes && (
          <div className="flex h-7 items-center gap-2 rounded-[7px] border border-[#26262c] bg-hover pl-2.5 pr-1 text-[12.5px] text-texto">
            <SlidersHorizontal size={13} strokeWidth={1.8} className="flex-none" />
            Ajustes
            <button
              type="button"
              title="Cerrar ajustes (Ctrl+,)"
              onClick={() => useKyu.getState().ponerAjustes(false)}
              className="grid size-4 flex-none place-items-center rounded text-muy hover:bg-borde2 hover:text-texto"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      <div className="relative flex items-center pl-1 text-muy">
        <button
          type="button"
          title="Nuevo espacio (Ctrl+Mayús+N)"
          onClick={() => nuevoEspacio(config.perfiles[0]?.nombre ?? "")}
          className="grid size-7 place-items-center rounded-md hover:bg-hover hover:text-texto"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          title="Nuevo espacio con otro perfil"
          onClick={() => setMenu(!menu)}
          className="grid h-7 w-4 place-items-center rounded-md hover:bg-hover hover:text-texto"
        >
          <ChevronDown size={11} />
        </button>
        {menu && (
          <MenuPerfiles
            perfiles={config.perfiles}
            alElegir={(p) => {
              setMenu(false);
              nuevoEspacio(p);
            }}
            alCerrar={() => setMenu(false)}
          />
        )}
      </div>

      <div data-tauri-drag-region className="h-full flex-1" />

      <BotonGrabar />

      <button
        type="button"
        title="Uso de Claude Code"
        onClick={() => useKyu.getState().ponerUso(!uso)}
        className={`grid size-7 place-items-center rounded-md ${uso ? "bg-hover text-texto" : "text-tenue hover:bg-hover hover:text-texto"}`}
      >
        <BarChart3 size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title="Archivos (Ctrl+Mayús+B)"
        onClick={() => useKyu.getState().alternarArbol()}
        className="grid size-7 place-items-center rounded-md text-tenue hover:bg-hover hover:text-texto"
      >
        <FolderTree size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title="Ajustes (Ctrl+,)"
        onClick={() => useKyu.getState().ponerAjustes(!ajustes)}
        className={`mr-1 grid size-7 place-items-center rounded-md ${ajustes ? "bg-hover text-texto" : "text-tenue hover:bg-hover hover:text-texto"}`}
      >
        <SlidersHorizontal size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title="Panel de Claude (Ctrl+Mayús+C)"
        onClick={() => useClaude.getState().mostrar(!claude)}
        className={`mr-2 flex h-7 items-center gap-2 rounded-[7px] px-2.5 text-[12.5px] ${
          claude ? "bg-claude/10 text-claude2" : "text-tenue hover:bg-hover hover:text-texto"
        }`}
      >
        <Mascota alto={12} />
        Claude
      </button>

      <div className="flex h-full">
        <BotonVentana titulo="Minimizar" onClick={() => void ventana.minimize()}>
          <Minus size={15} strokeWidth={1.8} />
        </BotonVentana>
        <BotonVentana titulo="Maximizar" onClick={() => void ventana.toggleMaximize()}>
          <Square size={12} strokeWidth={1.8} />
        </BotonVentana>
        <BotonVentana titulo="Cerrar" cerrar onClick={() => (guardarSesion(), void ventana.close())}>
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
