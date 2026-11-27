import { useEffect, useState } from "react";
import { ChevronDown, Columns2, FileSearch, Maximize2, Minimize2, Plus, Rows2, X } from "lucide-react";
import { IconoMenu } from "./iconos";
import { useKyu, type Nodo, type Zona } from "../lib/estado";
import { cerrarItem } from "../lib/acciones";
import { abrirMenuPestana } from "../lib/menus";
import { remotoInicio, type ConfigVista } from "../lib/nucleo";
import { message } from "@tauri-apps/plugin-dialog";
import { iconoPestana, nombrePestana, pestanaSucia, tituloPestana, vistaPestana, type Contexto } from "./tiposPestana";
import MenuPerfiles from "./MenuPerfiles";
import { ARRASTRE_RUTA, carpetaDelEspacio, conversacionEnPanel, ponerAgente } from "../lib/claude";
import { useActividad } from "../lib/actividad";
import { colorDe } from "../lib/estiloPestana";

/** Punto en la pestaña: ámbar que late mientras corre algo; verde o rojo si acabó sin
 *  estar a la vista, hasta que se abre la pestaña. */
function MarcaActividad({ item, visible }: { item: string; visible: boolean }) {
  const a = useActividad((s) => s.porItem[item]);
  useEffect(() => {
    if (visible && a && a.estado !== "corre") useActividad.getState().quitar(item);
  }, [visible, a, item]);
  if (!a) return null;
  const [color, texto] =
    a.estado === "corre"
      ? ["bg-aviso animate-pulse", `Ejecutando ${a.nombre}`]
      : a.estado === "ok"
        ? ["bg-ok", `${a.nombre} terminó bien`]
        : ["bg-mal", `${a.nombre} terminó con error`];
  return <span className={`size-1.5 flex-none rounded-full ${color}`} title={texto} />;
}

type PanelNodo = Extract<Nodo, { tipo: "panel" }>;

const TIPO_ARRASTRE = "text/kyu-item";

interface Props {
  panel: PanelNodo;
  conFoco: boolean;
  /** true si hay más de un panel en el espacio (entonces se marca el del foco). */
  varios: boolean;
  config: ConfigVista;
  /** Está a pantalla completa (Ctrl+Mayús+X). */
  maximizado?: boolean;
}

export default function Panel({ panel, conFoco, varios, config, maximizado = false }: Props) {
  const items = useKyu((s) => s.items);
  const actividad = useActividad((s) => s.porItem);
  // Solo se pinta el espacio activo: es el de este panel.
  const espacioDeItem = useKyu((s) => s.activo);
  const { activar, enfocar, nuevaPestana, dividir, moverItem } = useKyu.getState();
  const [zona, setZona] = useState<Zona | null>(null);
  const [menu, setMenu] = useState(false);
  // Pestaña que se está renombrando (lo pide el menú de clic derecho).
  const [renombrando, setRenombrando] = useState<string | null>(null);
  useEffect(() => {
    const pedir = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (panel.items.includes(id)) setRenombrando(id);
    };
    window.addEventListener("kyu-renombrar", pedir);
    return () => window.removeEventListener("kyu-renombrar", pedir);
  }, [panel.items]);
  const activo = panel.activo ? items[panel.activo] : undefined;
  const ctx: Contexto = { espacio: espacioDeItem, conFoco, config };
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
            const nombre = nombrePestana(it, { ...ctx, actividad: actividad[id]?.nombre });
            const esActivo = id === panel.activo;
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TIPO_ARRASTRE, id);
                  // Un archivo soltado sobre la caja de Claude queda como @ruta.
                  if (it.tipo === "archivo") e.dataTransfer.setData(ARRASTRE_RUTA, it.ruta);
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onClick={() => activar(panel.id, id)}
                onAuxClick={(e) => e.button === 1 && void cerrarItem(id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  abrirMenuPestana(id, panel.id, e.clientX, e.clientY);
                }}
                title={tituloPestana(it)}
                style={it.tipo === "terminal" && it.color ? { boxShadow: `inset 0 -2px 0 ${colorDe(it.color)}` } : undefined}
                className={`group flex h-[22px] min-w-0 max-w-48 cursor-default items-center gap-1.5 rounded-[5px] pl-2 pr-1 text-[12px] ${
                  esActivo ? "bg-hover text-texto" : "text-tenue hover:text-texto"
                }`}
              >
                {iconoPestana(it, ctx)}
                {renombrando === id && it.tipo === "terminal" ? (
                  <input
                    autoFocus
                    defaultValue={it.nombre ?? (typeof nombre === "string" ? nombre : "")}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") (e.currentTarget.dataset.cancelar = "1"), e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      // Vacío = vuelve al título que pone la shell.
                      if (!e.currentTarget.dataset.cancelar) useKyu.getState().renombrarItem(id, e.currentTarget.value || null);
                      setRenombrando(null);
                    }}
                    className="w-28 min-w-0 rounded bg-fondo px-1 text-[12px] text-texto outline-none ring-1 ring-acento/50"
                  />
                ) : (
                  <span className="truncate">{nombre}</span>
                )}
                {it.tipo === "terminal" && <MarcaActividad item={id} visible={esActivo} />}
                {pestanaSucia(it) ? (
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
                    pestanaSucia(it) ? "hidden group-hover:grid" : esActivo ? "" : "invisible group-hover:visible"
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
              otras={[
                {
                  icono: <IconoMenu agente={null} />,
                  texto: "Conversación con Claude",
                  hacer: () => conversacionEnPanel(espacioDeItem, { panel: panel.id }),
                },
                {
                  icono: <IconoMenu agente="antigravity" />,
                  texto: "Conversación con Antigravity",
                  hacer: () => ponerAgente(conversacionEnPanel(espacioDeItem, { panel: panel.id }), "antigravity"),
                },
                {
                  icono: <FileSearch size={13} strokeWidth={1.8} className="flex-none text-tenue" />,
                  texto: "Visor de archivos",
                  hijos: [
                    { texto: "Este PC", detalle: "carpeta del espacio", hacer: () => useKyu.getState().abrirVisor(carpetaDelEspacio(espacioDeItem), panel.id) },
                    ...config.perfiles
                      .filter((p) => p.nombre.startsWith("SSH · "))
                      .map((p) => p.nombre.slice("SSH · ".length))
                      .map((host) => ({
                        texto: host,
                        detalle: /-ro$/i.test(host) ? "solo lectura" : undefined,
                        color: /-ro$/i.test(host) ? "var(--color-muy)" : "#67e8f9",
                        hacer: () => void abrirVisorRemoto(host, panel.id),
                      })),
                  ],
                },
              ]}
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
          {(varios || maximizado) && (
            <BotonBarra
              titulo={maximizado ? "Volver a los paneles (Ctrl+Mayús+X)" : "Maximizar este panel (Ctrl+Mayús+X)"}
              onClick={() => {
                enfocar(panel.id);
                useKyu.getState().alternarMaximizar();
              }}
            >
              {maximizado ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </BotonBarra>
          )}
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
        {activo && vistaPestana(activo, ctx)}
        {zona && <ZonaSoltar zona={zona} />}
      </div>
    </div>
  );
}

/** Visor de un servidor: empieza en la carpeta de inicio del usuario de ese alias. */
async function abrirVisorRemoto(host: string, panel: string) {
  try {
    const inicio = await remotoInicio(host);
    useKyu.getState().abrirVisor(inicio || "/", panel, host);
  } catch (e) {
    await message(`No se pudo entrar en ${host}: ${e}`, { title: "Visor de archivos", kind: "error" });
  }
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

