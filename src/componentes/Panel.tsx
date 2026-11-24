import { useState } from "react";
import { ChevronDown, Columns2, Plus, Rows2, X } from "lucide-react";
import { useKyu, type Nodo, type Zona } from "../lib/estado";
import { cerrarItem } from "../lib/acciones";
import type { ConfigVista } from "../lib/nucleo";
import VistaTerminal from "./VistaTerminal";
import VistaArchivo from "./VistaArchivo";
import { IconoArchivo, IconoPerfil, Mascota } from "./iconos";
import MenuPerfiles from "./MenuPerfiles";

type PanelNodo = Extract<Nodo, { tipo: "panel" }>;

const TIPO_ARRASTRE = "text/kyu-item";

interface Props {
  panel: PanelNodo;
  conFoco: boolean;
  /** true si hay más de un panel en el espacio (entonces se marca el del foco). */
  varios: boolean;
  config: ConfigVista;
}

export default function Panel({ panel, conFoco, varios, config }: Props) {
  const items = useKyu((s) => s.items);
  const { activar, enfocar, nuevaPestana, dividir, moverItem } = useKyu.getState();
  const [zona, setZona] = useState<Zona | null>(null);
  const [menu, setMenu] = useState(false);
  const activo = panel.activo ? items[panel.activo] : undefined;
  const perfilDe = (nombre: string) => config.perfiles.find((p) => p.nombre === nombre);
  // Lo nuevo (dividir, +) se abre con el perfil de la pestaña activa, o el predeterminado.
  const perfilNuevo = activo?.tipo === "terminal" ? activo.perfil : config.perfiles[0]?.nombre ?? "";

  const zonaDe = (e: React.DragEvent<HTMLDivElement>): Zona => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const bordes: [Zona, number][] = [
      ["izquierda", x],
      ["derecha", 1 - x],
      ["arriba", y],
      ["abajo", 1 - y],
    ];
    const [cercana, distancia] = bordes.sort((a, b) => a[1] - b[1])[0];
    return distancia < 0.25 ? cercana : "centro";
  };

  return (
    <div
      data-panel={panel.id}
      onMouseDown={() => enfocar(panel.id)}
      className="relative flex h-full w-full flex-col"
    >
      {varios && conFoco && <div className="pointer-events-none absolute inset-0 z-20 border border-acento/35" />}

      {/* Barrita del panel: sus pestañas y acciones */}
      <div
        className="flex h-[30px] flex-none items-center gap-0.5 border-b border-borde bg-barra px-1.5"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(TIPO_ARRASTRE);
          if (id) moverItem(id, panel.id, "centro");
        }}
      >
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
          {panel.items.map((id) => {
            const it = items[id];
            if (!it) return null;
            const nombre = it.tipo === "terminal" ? it.titulo : it.ruta.split(/[\\/]/).pop()!;
            const esActivo = id === panel.activo;
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TIPO_ARRASTRE, id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => activar(panel.id, id)}
                onAuxClick={(e) => e.button === 1 && void cerrarItem(id)}
                title={it.tipo === "archivo" ? it.ruta : it.carpeta ?? it.perfil}
                className={`group flex h-[22px] min-w-0 max-w-48 cursor-default items-center gap-1.5 rounded-[5px] pl-2 pr-1 text-[12px] ${
                  esActivo ? "bg-hover text-texto" : "text-tenue hover:text-texto"
                }`}
              >
                {it.tipo === "terminal" ? (
                  it.deClaude ? (
                    <span title="Panel donde ejecuta Claude">
                      <Mascota alto={9} />
                    </span>
                  ) : (
                    <IconoPerfil perfil={perfilDe(it.perfil)} size={12} />
                  )
                ) : (
                  <IconoArchivo size={12} />
                )}
                <span className="truncate">{nombre}</span>
                {it.tipo === "archivo" && it.sucio ? (
                  <span className="mx-1 size-1.5 flex-none rounded-full bg-tenue group-hover:hidden" title="Sin guardar" />
                ) : null}
                <button
                  type="button"
                  title="Cerrar (Ctrl+Mayús+W)"
                  onClick={(e) => {
                    e.stopPropagation();
                    void cerrarItem(id);
                  }}
                  className={`grid size-4 flex-none place-items-center rounded text-muy hover:bg-borde2 hover:text-texto ${
                    it.tipo === "archivo" && it.sucio ? "hidden group-hover:grid" : esActivo ? "" : "invisible group-hover:visible"
                  }`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="relative flex flex-none items-center text-muy">
          <BotonBarra titulo="Nueva pestaña (Ctrl+Mayús+T)" onClick={() => nuevaPestana(perfilNuevo, panel.id)}>
            <Plus size={13} />
          </BotonBarra>
          <BotonBarra titulo="Elegir perfil" onClick={() => setMenu(!menu)} estrecho>
            <ChevronDown size={11} />
          </BotonBarra>
          {menu && (
            <MenuPerfiles
              perfiles={config.perfiles}
              alElegir={(p) => {
                setMenu(false);
                nuevaPestana(p, panel.id);
              }}
              alCerrar={() => setMenu(false)}
            />
          )}
        </div>
        <span className="flex-1" />
        <div className="flex flex-none items-center text-muy">
          <BotonBarra titulo="Dividir a la derecha (Ctrl+Mayús+D)" onClick={() => dividir("horizontal", perfilNuevo, panel.id)}>
            <Columns2 size={13} />
          </BotonBarra>
          <BotonBarra titulo="Dividir abajo (Ctrl+Mayús+E)" onClick={() => dividir("vertical", perfilNuevo, panel.id)}>
            <Rows2 size={13} />
          </BotonBarra>
        </div>
      </div>

      {/* Contenido: la pestaña activa. Al arrastrar una pestaña encima, se marca dónde caerá. */}
      <div
        className="relative min-h-0 flex-1"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setZona(zonaDe(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setZona(null);
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(TIPO_ARRASTRE);
          const z = zonaDe(e);
          setZona(null);
          if (id) moverItem(id, panel.id, z);
        }}
      >
        {activo?.tipo === "terminal" && <VistaTerminal key={activo.id} item={activo.id} conFoco={conFoco} config={config} />}
        {activo?.tipo === "archivo" && <VistaArchivo key={activo.id} archivo={activo} conFoco={conFoco} />}
        {zona && <ZonaSoltar zona={zona} />}
      </div>
    </div>
  );
}

function ZonaSoltar({ zona }: { zona: Zona }) {
  const pos: Record<Zona, string> = {
    centro: "inset-2",
    izquierda: "inset-y-2 left-2 w-[calc(50%-12px)]",
    derecha: "inset-y-2 right-2 w-[calc(50%-12px)]",
    arriba: "inset-x-2 top-2 h-[calc(50%-12px)]",
    abajo: "inset-x-2 bottom-2 h-[calc(50%-12px)]",
  };
  return <div className={`pointer-events-none absolute z-30 rounded-lg border border-acento/60 bg-acento/10 ${pos[zona]}`} />;
}

function BotonBarra({
  titulo,
  onClick,
  estrecho,
  children,
}: {
  titulo: string;
  onClick: () => void;
  estrecho?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      className={`grid h-[22px] place-items-center rounded-[5px] hover:bg-hover hover:text-texto ${estrecho ? "w-4" : "w-[22px]"}`}
    >
      {children}
    </button>
  );
}
