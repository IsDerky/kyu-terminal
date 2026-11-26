import { useEffect, useMemo, useRef, useState } from "react";
import { abrirCarpeta, abrirEnCarpeta, recientes } from "../lib/carpetas";
import { BarChart3, Braces, CircleDot, Folder, FolderOpen, ListX, FileDiff, Clapperboard, FolderTree, Columns2, Layers, Search, Rows2, SlidersHorizontal, SquarePen, SquareTerminal, TextQuote, X, ArrowLeftRight, type LucideIcon } from "lucide-react";
import { preguntarPorSeleccion } from "../lib/seleccion";
import { focoActual, useKyu } from "../lib/estado";
import { cerrarActual } from "../lib/acciones";
import { textoBloque } from "../lib/bloques";
import { adjuntar, nuevaConversacion } from "../lib/claude";
import { sesion } from "../lib/terminales";
import { useGit } from "../lib/git";
import { alternarGrabacion } from "../lib/grabar";
import type { ConfigVista, Perfil } from "../lib/nucleo";
import { nombreEspacio } from "./BarraTitulo";
import { IconoPerfil } from "./iconos";

interface Orden {
  id: string;
  grupo: string;
  titulo: string;
  detalle?: string;
  atajo?: string;
  icono?: LucideIcon;
  perfil?: Perfil;
  hacer: () => void;
}

/** Coincidencia «difusa»: las letras de la búsqueda aparecen en orden. Devuelve dónde. */
function coincide(texto: string, busqueda: string): number[] | null {
  if (!busqueda) return [];
  const t = texto.toLowerCase();
  const q = busqueda.toLowerCase().replace(/\s+/g, "");
  const pos: number[] = [];
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) (pos.push(i), j++);
  return j === q.length ? pos : null;
}

/** Ctrl+Mayús+P: todo lo que hace Kyu, buscando por nombre. */
export default function Paleta({ config }: { config: ConfigVista }) {
  const [busqueda, setBusqueda] = useState("");
  const [sel, setSel] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const espacios = useKyu((s) => s.espacios);
  const cerrar = () => useKyu.getState().ponerPaleta(false);

  const ordenes = useMemo<Orden[]>(() => {
    const k = useKyu.getState();
    const f = focoActual();
    const perfilFoco = f?.item?.tipo === "terminal" ? f.item.perfil : config.perfiles[0]?.nombre ?? "";
    const porDefecto = config.perfiles[0]?.nombre ?? "";
    const lista: Orden[] = [
      { id: "carpeta", grupo: "Espacios", titulo: "Abrir carpeta…", detalle: "un espacio fijo en ella; Kyu la recuerda", atajo: "Ctrl+Mayús+O", icono: FolderOpen, hacer: () => void abrirCarpeta(porDefecto) },
      ...recientes().map((r) => ({
        id: `reciente:${r}`,
        grupo: "Espacios",
        titulo: r.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? r,
        detalle: r,
        icono: Folder,
        hacer: () => void abrirEnCarpeta(r, porDefecto),
      })),
      { id: "div-d", grupo: "Paneles", titulo: "Dividir a la derecha", atajo: "Ctrl+Mayús+D", icono: Columns2, hacer: () => k.dividir("horizontal", perfilFoco) },
      { id: "div-a", grupo: "Paneles", titulo: "Dividir abajo", atajo: "Ctrl+Mayús+E", icono: Rows2, hacer: () => k.dividir("vertical", perfilFoco) },
      { id: "arbol", grupo: "Paneles", titulo: "Archivos", detalle: "árbol de la carpeta del terminal", atajo: "Ctrl+Mayús+B", icono: FolderTree, hacer: () => k.alternarArbol() },
      ...(useGit.getState().resumen ? [{ id: "cambios", grupo: "Git", titulo: "Cambios", detalle: "diff y commit del repo", icono: FileDiff, hacer: () => k.abrirCambios(useGit.getState().resumen!.raiz) }] : []),
      ...(useGit.getState().resumen?.github ? [{ id: "issues", grupo: "Git", titulo: "Trabajar en un issue", detalle: "worktree, espacio y conversación", icono: CircleDot, hacer: () => window.dispatchEvent(new Event("kyu-issues")) }] : []),
      { id: "claude-panel", grupo: "Paneles", titulo: "Nueva conversación con Claude", detalle: "junto a las demás, o a la derecha", atajo: "Ctrl+Mayús+K", icono: SquarePen, hacer: () => nuevaConversacion(k.activo) },
      { id: "antigravity-panel", grupo: "Paneles", titulo: "Nueva conversación con Antigravity", detalle: "modelos de Google con tu cuenta (agy)", icono: SquarePen, hacer: () => nuevaConversacion(k.activo, "antigravity") },
      { id: "cerrar", grupo: "Paneles", titulo: "Cerrar pestaña", atajo: "Ctrl+Mayús+W", icono: X, hacer: cerrarActual },
      {
        id: "claude-orden",
        grupo: "Claude",
        titulo: "Enviar la última orden a Claude",
        detalle: "con su salida",
        icono: SquareTerminal,
        hacer: () => {
          const it = f?.item;
          const s = it?.tipo === "terminal" ? sesion(it.id) : undefined;
          if (!s) return;
          const t = [...s.bloques.lista].reverse().map((b) => textoBloque(s.term, b)).find((x) => x !== null);
          if (!t) return;
          adjuntar(k.activo, t);
        },
      },
      {
        id: "claude-seleccion",
        grupo: "Claude",
        titulo: "Preguntar a Claude por la selección",
        detalle: "del terminal o del archivo",
        atajo: "Alt+K",
        icono: TextQuote,
        hacer: () => void preguntarPorSeleccion(),
      },
      { id: "gif", grupo: "Kyu", titulo: "Grabar el panel a GIF", detalle: "empezar o parar", atajo: "Ctrl+Mayús+G", icono: Clapperboard, hacer: () => void alternarGrabacion() },
      { id: "problemas", grupo: "Paneles", titulo: "Problemas", detalle: "errores y avisos del último build o lint", icono: ListX, hacer: () => k.abrirProblemas() },
      { id: "entorno", grupo: "Kyu", titulo: "Variables de entorno", detalle: "las de las shells, el PATH y los .env de la carpeta", icono: Braces, hacer: () => window.dispatchEvent(new Event("kyu-entorno")) },
      { id: "uso", grupo: "Kyu", titulo: "Uso de Claude Code", detalle: "tokens por día, proyecto y modelo", icono: BarChart3, hacer: () => k.ponerUso(true) },
      { id: "ajustes", grupo: "Kyu", titulo: "Ajustes", atajo: "Ctrl+,", icono: SlidersHorizontal, hacer: () => k.ponerAjustes(true) },
      { id: "buscar", grupo: "Paneles", titulo: "Buscar en el terminal", atajo: "Ctrl+F", icono: Search, hacer: () => f?.item?.tipo === "terminal" && k.ponerBuscando(f.item.id) },
      ...config.perfiles.map<Orden>((p, i) => ({
        id: `pest-${p.nombre}`,
        grupo: "Pestañas",
        titulo: `Nueva pestaña: ${p.nombre}`,
        atajo: i === 0 ? "Ctrl+Mayús+T" : undefined,
        perfil: p,
        hacer: () => k.nuevaPestana(p.nombre),
      })),
      ...config.perfiles.map<Orden>((p, i) => ({
        id: `esp-${p.nombre}`,
        grupo: "Espacios",
        titulo: `Nuevo espacio: ${p.nombre}`,
        atajo: i === 0 ? "Ctrl+Mayús+N" : undefined,
        icono: Layers,
        hacer: () => k.nuevoEspacio(p.nombre),
      })),
      ...espacios.map<Orden>((e, i) => ({
        id: `ir-${e.id}`,
        grupo: "Espacios",
        titulo: `Ir a ${nombreEspacio(e)}`,
        atajo: i < 9 ? `Ctrl+${i + 1}` : undefined,
        icono: ArrowLeftRight,
        hacer: () => k.cambiarEspacio(e.id),
      })),
    ];
    return lista;
  }, [config, espacios]);

  // Buscando, primero lo que coincide más junto («pestaña wsl» → WSL antes que
  // PowerShell, donde las letras salen sueltas); sin buscar, el orden por grupos.
  const filtradas = ordenes
    .map((o) => ({ o, pos: coincide(o.titulo, busqueda) }))
    .filter((x): x is { o: Orden; pos: number[] } => x.pos !== null)
    .map((x) => ({ ...x, nota: x.pos.length ? x.pos[x.pos.length - 1] - x.pos[0] + x.pos[0] / 100 : 0 }))
    .sort((a, b) => (busqueda ? a.nota - b.nota : 0));

  useEffect(() => setSel(0), [busqueda]);
  useEffect(() => entrada.current?.focus(), []);

  const ejecutar = (o?: Orden) => {
    if (!o) return;
    cerrar();
    o.hacer();
  };

  let grupoAnterior = "";
  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-[#05040899] pt-[70px]" onMouseDown={cerrar}>
      <div
        className="h-max w-[600px] overflow-hidden rounded-xl border border-borde2 bg-[#141417] shadow-[0_40px_90px_-20px_#000]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-borde px-4 py-3">
          <Search size={17} className="text-tenue" />
          <input
            ref={entrada}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, filtradas.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter") ejecutar(filtradas[sel]?.o);
              if (e.key === "Escape") cerrar();
            }}
            placeholder="Escribe una orden…"
            spellCheck={false}
            className="flex-1 bg-transparent text-[15px] text-texto outline-none placeholder:text-muy"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1">
          {filtradas.length === 0 && <p className="px-4 py-3 text-[13px] text-muy">Nada coincide.</p>}
          {filtradas.map(({ o, pos }, i) => {
            const cabecera = !busqueda && o.grupo !== grupoAnterior ? o.grupo : null;
            grupoAnterior = o.grupo;
            const Icono = o.icono;
            return (
              <div key={o.id}>
                {cabecera && <div className="px-4 pb-1 pt-2.5 text-[11px] uppercase tracking-wider text-muy">{cabecera}</div>}
                <div
                  onMouseMove={() => setSel(i)}
                  onClick={() => ejecutar(o)}
                  className={`flex cursor-default items-center gap-2.5 px-4 py-2 text-[13px] text-texto ${
                    i === sel ? "bg-hover shadow-[inset_2px_0_0_var(--color-acento)]" : ""
                  }`}
                >
                  {o.perfil ? <IconoPerfil perfil={o.perfil} /> : Icono ? <Icono size={14} className="text-tenue" /> : null}
                  <span>
                    {[...o.titulo].map((c, j) => (
                      <span key={j} className={pos.includes(j) ? "font-semibold text-acento2" : ""}>
                        {c}
                      </span>
                    ))}
                  </span>
                  {o.atajo && (
                    <kbd className="ml-auto rounded border border-borde2 px-1.5 font-mono text-[11px] text-tenue">{o.atajo}</kbd>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 border-t border-borde px-4 py-2 text-[11px] text-muy">
          <span>↑↓ moverse</span>
          <span>Intro ejecutar</span>
          <span>Esc cerrar</span>
        </div>
      </div>
    </div>
  );
}
