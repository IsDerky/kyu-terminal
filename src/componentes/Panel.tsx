import { lazy, Suspense, useEffect, useState } from "react";
import { Bot, ChevronDown, Columns2, FileSearch, FolderTree, GitCommitHorizontal, ListX, Maximize2, Minimize2, Plus, Rows2, Sparkles, X } from "lucide-react";
import { useKyu, type Nodo, type Zona } from "../lib/estado";
import { cerrarItem } from "../lib/acciones";
import { abrirMenuPestana } from "../lib/menus";
import type { ConfigVista } from "../lib/nucleo";
import VistaTerminal from "./VistaTerminal";
// CodeMirror se carga al abrir el primer archivo.
const VistaArchivo = lazy(() => import("./VistaArchivo"));
import VistaArbol from "./VistaArbol";
// El panel de Claude ya va aparte (carga diferida): se reutiliza para las pestañas.
const PanelClaude = lazy(() => import("./PanelClaude"));
const VistaCambios = lazy(() => import("./VistaCambios"));
const VistaProblemas = lazy(() => import("./VistaProblemas"));
const VistaVisor = lazy(() => import("./VistaVisor"));
import { IconoAgente, IconoArchivo, IconoPerfil, Mascota } from "./iconos";
import MenuPerfiles from "./MenuPerfiles";
import { ARRASTRE_RUTA, carpetaDelEspacio, conversacionEnPanel, espacioDe, nombreAgente, ponerAgente, useClaude } from "../lib/claude";
import { useActividad } from "../lib/actividad";
import { colorDe, iconoDe } from "../lib/estiloPestana";
import type { Item } from "../lib/estado";
import type { Perfil } from "../lib/nucleo";

/** Icono de una pestaña de terminal: el puesto a mano (con su color) o el del perfil. */
function IconoPestana({ it, perfil }: { it: Extract<Item, { tipo: "terminal" }>; perfil: Perfil | undefined }) {
  const Icono = iconoDe(it.icono);
  const color = colorDe(it.color);
  if (!Icono) return <IconoPerfil perfil={perfil} size={12} color={color} />;
  return <Icono size={12} strokeWidth={1.8} className="flex-none" style={color ? { color } : undefined} />;
}

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
            const nombre =
              it.tipo === "terminal"
                ? it.nombre ?? actividad[id]?.nombre ?? it.titulo
                : it.tipo === "arbol"
                  ? "Archivos"
                  : it.tipo === "claude"
                    ? <NombreConversacion cid={it.cid} />
                    : it.tipo === "cambios"
                      ? "Cambios"
                      : it.tipo === "problemas"
                        ? "Problemas"
                        : it.tipo === "visor"
                          ? it.ruta?.split(/[\\/]/).pop() ?? "Visor de archivos"
                          : it.ruta.split(/[\\/]/).pop()!;
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
                title={
                  it.tipo === "archivo"
                    ? it.ruta
                    : it.tipo === "arbol"
                      ? "Archivos (Ctrl+Mayús+B)"
                      : it.tipo === "claude"
                        ? `Conversación con ${nombreAgente(useClaude.getState().conversaciones[it.cid])}`
                        : it.tipo === "cambios"
                          ? `Cambios sin commit en ${it.raiz}`
                          : it.tipo === "problemas"
                            ? "Errores y avisos del último build o lint"
                            : it.tipo === "visor"
                              ? `Visor de archivos · ${it.ruta ?? it.raiz ?? "carpeta del espacio"}`
                              : it.carpeta ?? it.perfil
                }
                style={it.tipo === "terminal" && it.color ? { boxShadow: `inset 0 -2px 0 ${colorDe(it.color)}` } : undefined}
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
                    <IconoPestana it={it} perfil={perfilDe(it.perfil)} />
                  )
                ) : it.tipo === "arbol" ? (
                  <FolderTree size={12} strokeWidth={1.8} className="flex-none" />
                ) : it.tipo === "claude" ? (
                  <IconoPestanaClaude cid={it.cid} />
                ) : it.tipo === "cambios" ? (
                  <GitCommitHorizontal size={12} strokeWidth={1.8} className="flex-none" />
                ) : it.tipo === "problemas" ? (
                  <ListX size={12} strokeWidth={1.8} className="flex-none" />
                ) : it.tipo === "visor" ? (
                  <FileSearch size={12} strokeWidth={1.8} className="flex-none" />
                ) : (
                  <IconoArchivo size={12} />
                )}
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
                {(it.tipo === "archivo" || it.tipo === "visor") && it.sucio ? (
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
                    (it.tipo === "archivo" || it.tipo === "visor") && it.sucio ? "hidden group-hover:grid" : esActivo ? "" : "invisible group-hover:visible"
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
                  icono: <Sparkles size={13} strokeWidth={1.8} className="flex-none text-claude2" />,
                  texto: "Conversación con Claude",
                  hacer: () => conversacionEnPanel(espacioDeItem, { panel: panel.id }),
                },
                {
                  icono: <Bot size={13} strokeWidth={1.8} className="flex-none text-tenue" />,
                  texto: "Conversación con Antigravity",
                  hacer: () => ponerAgente(conversacionEnPanel(espacioDeItem, { panel: panel.id }), "antigravity"),
                },
                {
                  icono: <FileSearch size={13} strokeWidth={1.8} className="flex-none text-tenue" />,
                  texto: "Visor de archivos",
                  hacer: () => useKyu.getState().abrirVisor(carpetaDelEspacio(espacioDeItem), panel.id),
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
        {activo?.tipo === "terminal" && <VistaTerminal key={activo.id} item={activo.id} conFoco={conFoco} config={config} />}
        {activo?.tipo === "archivo" && (
          <Suspense fallback={null}>
            <VistaArchivo key={activo.id} archivo={activo} conFoco={conFoco} />
          </Suspense>
        )}
        {activo?.tipo === "arbol" && <VistaArbol key={activo.id} item={activo.id} />}
        {activo?.tipo === "cambios" && (
          <Suspense fallback={null}>
            <VistaCambios key={activo.id} raiz={activo.raiz} espacio={espacioDeItem} />
          </Suspense>
        )}
        {activo?.tipo === "problemas" && (
          <Suspense fallback={null}>
            <VistaProblemas key={activo.id} espacio={espacioDeItem} />
          </Suspense>
        )}
        {activo?.tipo === "claude" && (
          <Suspense fallback={null}>
            <PanelClaude key={activo.id} espacio={espacioDe(activo.cid)} conversacion={activo.cid} conFoco={conFoco} />
          </Suspense>
        )}
        {activo?.tipo === "visor" && (
          <Suspense fallback={null}>
            <VistaVisor key={activo.id} visor={activo} conFoco={conFoco} />
          </Suspense>
        )}
        {zona && <ZonaSoltar zona={zona} />}
      </div>
    </div>
  );
}

/** Nombre de la pestaña de una conversación: su primer mensaje, o «Claude» si está vacía. */
function NombreConversacion({ cid }: { cid: string }) {
  const titulo = useClaude((s) => {
    const c = s.conversaciones[cid];
    // El título que puso el agente o generó Claude manda sobre el primer mensaje.
    if (c?.titulo) return c.titulo.slice(0, 40);
    const primero = c?.entradas.find((e) => e.tipo === "tu");
    return primero?.tipo === "tu" ? primero.texto.split("\n")[0].slice(0, 40) : "";
  });
  const quien = useClaude((s) => nombreAgente(s.conversaciones[cid]));
  return <>{titulo || quien}</>;
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

/** Icono de la pestaña de una conversación: el de quien contesta en ella. */
function IconoPestanaClaude({ cid }: { cid: string }) {
  const agente = useClaude((s) => s.conversaciones[cid]?.agente);
  return <IconoAgente agente={agente} alto={9} />;
}
