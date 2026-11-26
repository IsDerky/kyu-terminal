// Pestaña «Archivos»: el árbol de la carpeta del terminal con el foco del espacio. Las
// carpetas se abren al clic y un archivo se abre en Kyu. A la derecha, la letra de git
// (M, A, ?…) y en naranja lo que ha tocado Claude en esta conversación.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, File, FilePlus, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { useKyu } from "../lib/estado";
import { ARRASTRE_RUTA, carpetaDelEspacio, useClaude } from "../lib/claude";
import { arbolListar, crearArchivo, gitEstado, renombrarArchivo, type NodoArbol } from "../lib/nucleo";
import { abrirMenuArbol, borrarDelArbol, type EditarArbol } from "../lib/menus";
import { editores } from "../lib/editores";

/** Carpetas abiertas de cada pestaña de árbol (sobreviven a mover o dividir el panel). */
const abiertasDe = new Map<string, Set<string>>();

const SIN_CAMBIOS: Record<string, string | null> = {};
const clave = (ruta: string) => ruta.replace(/[\\/]+$/, "").toLowerCase();
const nombreDe = (ruta: string) => ruta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ruta;

/** Tras renombrar: las pestañas y editores abiertos de `viejo` (o de dentro, si es carpeta) pasan a `nuevo`. */
function moverRutas(viejo: string, nuevo: string) {
  const v = clave(viejo);
  const base = viejo.replace(/[\\/]+$/, "");
  const cambia = (r: string) => {
    const k = clave(r);
    if (k === v) return nuevo;
    if (k.startsWith(v + "\\") || k.startsWith(v + "/")) return nuevo + r.slice(base.length);
    return null;
  };
  useKyu.setState((s) => ({
    items: Object.fromEntries(
      Object.entries(s.items).map(([id, it]) => {
        const r = it.tipo === "archivo" ? cambia(it.ruta) : null;
        return [id, r && it.tipo === "archivo" ? { ...it, ruta: r } : it];
      }),
    ),
  }));
  for (const e of editores.values()) {
    const r = cambia(e.ruta);
    if (r) e.ruta = r;
  }
  return cambia;
}

/** Caja para el nombre (archivo nuevo o renombrar), en la línea del árbol. */
function CajaNombre({
  inicial,
  sangria,
  carpeta,
  alAceptar,
  alCancelar,
}: {
  inicial: string;
  sangria: number;
  carpeta: boolean;
  alAceptar: (nombre: string) => Promise<string | null>;
  alCancelar: () => void;
}) {
  const [fallo, setFallo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const aceptar = async (valor: string) => {
    if (ocupado) return;
    const v = valor.trim();
    if (!v || v === inicial) return alCancelar();
    setOcupado(true);
    const error = await alAceptar(v);
    setOcupado(false);
    setFallo(error);
  };
  return (
    <div style={{ paddingLeft: 8 + sangria * 16 }} className="pr-2.5">
      <div className="flex h-6 items-center gap-1.5">
        <span className="w-3 flex-none" />
        {carpeta ? <Folder size={13} strokeWidth={1.8} className="flex-none text-muy" /> : <File size={13} strokeWidth={1.8} className="flex-none text-muy" />}
        <input
          autoFocus
          defaultValue={inicial}
          spellCheck={false}
          onFocus={(e) => {
            // Sin la extensión, como en VS Code.
            const punto = carpeta ? -1 : e.currentTarget.value.lastIndexOf(".");
            e.currentTarget.setSelectionRange(0, punto > 0 ? punto : e.currentTarget.value.length);
          }}
          onChange={() => setFallo(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void aceptar(e.currentTarget.value);
            if (e.key === "Escape") alCancelar();
          }}
          onBlur={(e) => (fallo ? alCancelar() : void aceptar(e.currentTarget.value))}
          className={`h-[20px] min-w-0 flex-1 rounded bg-fondo px-1 text-[12.5px] text-texto outline-none ring-1 ${fallo ? "ring-mal/70" : "ring-acento/50"}`}
        />
      </div>
      {fallo && <p className="ml-[38px] pb-1 text-[11px] text-mal">{fallo}</p>}
    </div>
  );
}

export default function VistaArbol({ item }: { item: string }) {
  const espacio = useKyu((s) => s.activo);
  const raiz = useKyu(() => carpetaDelEspacio(espacio));
  const cid = useClaude((s) => s.ultimas[espacio] ?? "");
  const antesDe = useClaude((s) => s.conversaciones[cid]?.antesDe ?? SIN_CAMBIOS);
  const enCurso = useClaude((s) => s.conversaciones[cid]?.tocados ?? SIN_CAMBIOS);
  const [abiertas, setAbiertas] = useState<Set<string>>(() => abiertasDe.get(item) ?? new Set());
  const [listas, setListas] = useState<Record<string, NodoArbol[]>>({});
  const [git, setGit] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<EditarArbol | null>(null);

  const cargar = useCallback(async () => {
    if (!raiz) return;
    const dentro = [...abiertas].filter((a) => clave(a).startsWith(clave(raiz)));
    const carpetas = [raiz, ...dentro];
    const resultados = await Promise.all(carpetas.map((c) => arbolListar(c).then((l) => [c, l] as const, () => [c, null] as const)));
    const nuevas: Record<string, NodoArbol[]> = {};
    for (const [c, l] of resultados) if (l) nuevas[clave(c)] = l;
    setError(nuevas[clave(raiz)] ? null : "No se puede leer esta carpeta");
    setListas(nuevas);
    const estado = await gitEstado(raiz).catch(() => ({}) as Record<string, string>);
    const porClave: Record<string, string> = {};
    for (const [r, letra] of Object.entries(estado)) porClave[clave(r)] = letra;
    setGit(porClave);
  }, [raiz, abiertas]);

  // Al cambiar de carpeta o abrir una, y cada 3 s mientras se ve (lo que va creando Claude o git).
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 3000);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    abiertasDe.set(item, abiertas);
  }, [item, abiertas]);

  const deClaude = useMemo(() => new Set([...Object.keys(antesDe), ...Object.keys(enCurso)].map(clave)), [antesDe, enCurso]);

  /** Del menú o de F2: abre la caja (para uno nuevo, abre antes su carpeta). */
  const editar = (e: EditarArbol) => {
    if (e.tipo === "nuevo" && raiz && clave(e.ruta) !== clave(raiz)) setAbiertas((a) => new Set(a).add(e.ruta));
    setEditando(e);
  };

  const crear = async (carpeta: string, nombre: string) => {
    try {
      const ruta = await crearArchivo(carpeta, nombre);
      setEditando(null);
      await cargar();
      useKyu.getState().abrirArchivo(ruta, 1, 1);
      return null;
    } catch (e) {
      return String(e);
    }
  };

  const renombrar = async (ruta: string, nombre: string) => {
    try {
      const nueva = await renombrarArchivo(ruta, nombre);
      const cambia = moverRutas(ruta, nueva);
      setAbiertas((a) => new Set([...a].map((r) => cambia(r) ?? r)));
      setEditando(null);
      await cargar();
      return null;
    } catch (e) {
      return String(e);
    }
  };

  const cajaNueva = (carpeta: string, nivel: number) =>
    editando?.tipo === "nuevo" && clave(editando.ruta) === clave(carpeta) ? (
      <CajaNombre inicial="" sangria={nivel} carpeta={false} alAceptar={(n) => crear(carpeta, n)} alCancelar={() => setEditando(null)} />
    ) : null;

  const alternar = (ruta: string) =>
    setAbiertas((a) => {
      const n = new Set(a);
      if (n.has(ruta)) n.delete(ruta);
      else n.add(ruta);
      return n;
    });

  /** Marca de una carpeta: hay algo de Claude o de git dentro. */
  const marcaCarpeta = (ruta: string) => {
    const k = clave(ruta) + "\\";
    const k2 = clave(ruta) + "/";
    const dentro = (r: string) => r.startsWith(k) || r.startsWith(k2);
    if ([...deClaude].some(dentro)) return "claude";
    if (Object.keys(git).some(dentro)) return "git";
    return null;
  };

  const fila = (n: NodoArbol, nivel: number): React.ReactNode => {
    const k = clave(n.ruta);
    const abierta = n.carpeta && abiertas.has(n.ruta);
    const letra = git[k];
    const claude = deClaude.has(k);
    const marca = n.carpeta ? marcaCarpeta(n.ruta) : null;
    if (editando?.tipo === "renombrar" && clave(editando.ruta) === k) {
      return (
        <div key={n.ruta}>
          <CajaNombre
            inicial={n.nombre}
            sangria={nivel}
            carpeta={n.carpeta}
            alAceptar={(nombre) => renombrar(n.ruta, nombre)}
            alCancelar={() => setEditando(null)}
          />
          {abierta && (listas[k] ?? []).map((h) => fila(h, nivel + 1))}
        </div>
      );
    }
    return (
      <div key={n.ruta}>
        <button
          type="button"
          title={n.ruta}
          draggable
          // Soltado en Claude queda como @ruta.
          onDragStart={(e) => {
            e.dataTransfer.setData(ARRASTRE_RUTA, n.carpeta ? `${n.ruta.replace(/[\\/]+$/, "")}\\` : n.ruta);
            e.dataTransfer.setData("text/plain", n.ruta);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => (n.carpeta ? alternar(n.ruta) : useKyu.getState().abrirArchivo(n.ruta, 1, 1))}
          onContextMenu={(e) => {
            e.preventDefault();
            if (raiz) abrirMenuArbol(n.ruta, n.carpeta, raiz, claude, e.clientX, e.clientY, editar);
          }}
          onKeyDown={(e) => {
            if (e.key === "F2") (e.preventDefault(), editar({ tipo: "renombrar", ruta: n.ruta }));
            if (e.key === "Delete" && !n.carpeta) (e.preventDefault(), void borrarDelArbol(n.ruta));
          }}
          className="flex h-6 w-full min-w-0 items-center gap-1.5 pr-2.5 text-left text-[12.5px] text-tenue hover:bg-hover hover:text-texto"
          style={{ paddingLeft: 8 + nivel * 16 }}
        >
          <span className="grid w-3 flex-none place-items-center text-muy">
            {n.carpeta && (abierta ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          </span>
          {n.carpeta ? (
            abierta ? (
              <FolderOpen size={13} strokeWidth={1.8} className="flex-none text-muy" />
            ) : (
              <Folder size={13} strokeWidth={1.8} className="flex-none text-muy" />
            )
          ) : (
            <File size={13} strokeWidth={1.8} className="flex-none text-muy" />
          )}
          <span className={`min-w-0 flex-1 truncate ${claude ? "text-claude2" : letra === "?" || letra === "A" ? "text-ok/90" : ""}`}>
            {n.nombre}
          </span>
          {!n.carpeta && (claude || letra) && (
            <span
              title={claude ? "Lo ha cambiado Claude en esta conversación" : `git: ${letra}`}
              className={`flex-none font-mono text-[11px] ${claude ? "text-claude2" : letra === "?" || letra === "A" ? "text-ok" : letra === "D" ? "text-mal" : "text-aviso"}`}
            >
              {letra === "?" ? "U" : letra ?? "●"}
            </span>
          )}
          {marca && (
            <span className={`size-1.5 flex-none rounded-full ${marca === "claude" ? "bg-claude2" : "bg-aviso/80"}`} />
          )}
        </button>
        {abierta && cajaNueva(n.ruta, nivel + 1)}
        {abierta && (listas[k] ?? []).map((h) => fila(h, nivel + 1))}
        {abierta && listas[k]?.length === 0 && !cajaNueva(n.ruta, nivel + 1) && (
          <p className="h-6 text-[11.5px] italic text-muy" style={{ paddingLeft: 8 + (nivel + 1) * 16 + 18 }}>
            vacía
          </p>
        )}
      </div>
    );
  };

  if (!raiz) {
    return <p className="p-4 text-[12.5px] text-tenue">Abre un terminal en este espacio para ver su carpeta.</p>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-8 flex-none items-center gap-1 border-b border-borde pl-3 pr-1.5 text-[11px] uppercase tracking-wider text-muy">
        <span className="min-w-0 flex-1 truncate" title={raiz}>
          {nombreDe(raiz)}
        </span>
        <button
          type="button"
          title="Nuevo archivo"
          onClick={() => editar({ tipo: "nuevo", ruta: raiz })}
          className="grid size-6 place-items-center rounded hover:bg-hover hover:text-texto"
        >
          <FilePlus size={13} />
        </button>
        <button type="button" title="Plegar todo" onClick={() => setAbiertas(new Set())} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-texto">
          <ChevronsDownUp size={13} />
        </button>
        <button type="button" title="Actualizar" onClick={() => void cargar()} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-texto">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? (
          <p className="p-3 text-[12px] text-mal">{error}</p>
        ) : (
          <>
            {cajaNueva(raiz, 0)}
            {(listas[clave(raiz)] ?? []).map((n) => fila(n, 0))}
          </>
        )}
      </div>
    </div>
  );
}
