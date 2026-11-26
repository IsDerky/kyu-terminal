// Menú «Más» de la cabecera del panel (servidores MCP, permisos guardados, memoria, exportar,
// entrar en la cuenta del agente) y sus paneles flotantes; pie con el plan del agente.
import { useEffect, useRef, useState } from "react";
import { BookText, Download, KeyRound, LogIn, MoreHorizontal, Plug, RefreshCw, ShieldCheck, X } from "lucide-react";
import {
  abrirMemoria,
  exportar,
  nombreAgente,
  ponerFlotante,
  servidoresMcp,
  useFlotante,
  type Conversacion,
  type ServidorMcp,
} from "../lib/claude";
import { acpEntrar, permisosLeer, permisosQuitar, type ReglaPermiso } from "../lib/nucleo";

/** Cierra al pulsar fuera de `caja` (salvo en lo marcado con `data-<marca>`). */
function useFuera(caja: React.RefObject<HTMLDivElement | null>, marca: string, alCerrar: () => void) {
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!caja.current?.contains(t) && !t.closest(`[data-${marca}]`)) alCerrar();
    };
    window.addEventListener("mousedown", fuera);
    return () => window.removeEventListener("mousedown", fuera);
  }, [caja, marca, alCerrar]);
}

function Opcion({ icono, texto, ayuda, onClick }: { icono: React.ReactNode; texto: string; ayuda?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:bg-hover">
      <span className="flex-none text-tenue">{icono}</span>
      <span className="flex-1 text-texto">{texto}</span>
      {ayuda && <span className="flex-none font-mono text-[10.5px] text-muy">{ayuda}</span>}
    </button>
  );
}

/** Botón «…» de la cabecera con lo que en Claude Code son /mcp, /permissions, /memory y /export. */
export function MenuMas({ cid, c, boton }: { cid: string; c: Conversacion; boton: (onClick: () => void) => React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useFuera(caja, "boton-mas", () => setAbierto(false));
  const hacer = (f: () => void) => () => {
    setAbierto(false);
    f();
  };
  return (
    <span data-boton-mas className="relative">
      {boton(() => setAbierto((v) => !v))}
      {abierto && (
        <div ref={caja} className="absolute right-0 top-8 z-40 w-[250px] rounded-lg border border-borde2 bg-tarjeta py-1 shadow-[0_12px_32px_-12px_#000]">
          {!c.agente && (
            <>
              <Opcion icono={<Plug size={13} strokeWidth={1.8} />} texto="Servidores MCP" ayuda="/mcp" onClick={hacer(() => ponerFlotante(cid, "mcp"))} />
              <Opcion icono={<ShieldCheck size={13} strokeWidth={1.8} />} texto="Permisos guardados" ayuda="/permissions" onClick={hacer(() => ponerFlotante(cid, "permisos"))} />
              <Opcion icono={<BookText size={13} strokeWidth={1.8} />} texto="Memoria del proyecto" ayuda="/memory" onClick={hacer(() => void abrirMemoria(cid))} />
            </>
          )}
          {c.agente && (
            <Opcion icono={<LogIn size={13} strokeWidth={1.8} />} texto={`Entrar en ${nombreAgente(c)}`} onClick={hacer(() => void acpEntrar(c.agente!))} />
          )}
          <Opcion icono={<Download size={13} strokeWidth={1.8} />} texto="Exportar conversación" ayuda="/export" onClick={hacer(() => void exportar(cid))} />
        </div>
      )}
    </span>
  );
}

const COLOR_MCP: Record<string, string> = {
  connected: "text-ok",
  failed: "text-mal",
  "needs-auth": "text-aviso",
  pending: "text-tenue",
  disabled: "text-muy",
};
const NOMBRE_MCP: Record<string, string> = {
  connected: "conectado",
  failed: "falla",
  "needs-auth": "pide entrar",
  pending: "arrancando",
  disabled: "desactivado",
};

function Flotante({ cid, titulo, accion, children }: { cid: string; titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = () => ponerFlotante(cid, null);
  useFuera(caja, "boton-mas", cerrar);
  return (
    <div
      ref={caja}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), cerrar())}
      className="absolute right-2 top-12 z-30 flex max-h-[min(440px,70%)] w-[340px] flex-col rounded-lg border border-borde2 bg-tarjeta shadow-[0_12px_32px_-12px_#000]"
    >
      <div className="flex items-center gap-2 border-b border-borde px-3 py-2">
        <span className="flex-1 text-[12.5px] font-semibold">{titulo}</span>
        {accion}
        <button type="button" title="Cerrar" onClick={cerrar} className="grid size-6 place-items-center rounded-md text-muy hover:bg-hover hover:text-texto">
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">{children}</div>
    </div>
  );
}

function PanelMcp({ cid, c }: { cid: string; c: Conversacion }) {
  const [lista, setLista] = useState<ServidorMcp[] | null | "error">(null);
  const cargar = () => {
    setLista(null);
    servidoresMcp(cid).then(
      (l) => setLista(l ?? []),
      () => setLista("error"),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [cid, c.claudeId]);
  return (
    <Flotante
      cid={cid}
      titulo="Servidores MCP"
      accion={
        <button type="button" title="Volver a mirar" onClick={cargar} className="grid size-6 place-items-center rounded-md text-muy hover:bg-hover hover:text-texto">
          <RefreshCw size={12} />
        </button>
      }
    >
      {c.claudeId === null ? (
        <p className="px-2.5 py-2 text-[12px] text-muy">Empieza la conversación para ver sus servidores.</p>
      ) : lista === null ? (
        <p className="px-2.5 py-2 text-[12px] text-muy">Preguntando a Claude…</p>
      ) : lista === "error" ? (
        <p className="px-2.5 py-2 text-[12px] text-mal">Claude no ha contestado.</p>
      ) : !lista.length ? (
        <p className="px-2.5 py-2 text-[12px] text-muy">Esta conversación no tiene servidores MCP.</p>
      ) : (
        lista.map((s) => (
          <div key={s.name} className="rounded-md px-2.5 py-1.5" title={s.error}>
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-texto">{s.name}</span>
              <span className={`flex-none text-[11px] ${COLOR_MCP[s.status] ?? "text-tenue"}`}>{NOMBRE_MCP[s.status] ?? s.status}</span>
            </div>
            {(s.error || s.scope || s.serverInfo?.version) && (
              <div className="truncate text-[11px] text-muy">{s.error ?? [s.scope, s.serverInfo?.version].filter(Boolean).join(" · ")}</div>
            )}
          </div>
        ))
      )}
    </Flotante>
  );
}

const TIPO: Record<string, [string, string]> = {
  allow: ["Permitir", "text-ok"],
  ask: ["Preguntar", "text-aviso"],
  deny: ["Denegar", "text-mal"],
};
const AMBITO: Record<string, string> = {
  local: "Este proyecto, solo tú (.claude/settings.local.json)",
  proyecto: "Este proyecto, compartido (.claude/settings.json)",
  usuario: "Todos tus proyectos (settings.json de usuario)",
};

function PanelPermisos({ cid, carpeta }: { cid: string; carpeta: string | null }) {
  const [lista, setLista] = useState<ReglaPermiso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = () => {
    permisosLeer(carpeta).then(setLista, () => setLista([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [carpeta]);
  const quitar = (r: ReglaPermiso) => {
    setError(null);
    permisosQuitar(r.archivo, r.tipo, r.regla).then(cargar, (e) => setError(String(e)));
  };
  const ambitos = ["local", "proyecto", "usuario"] as const;
  return (
    <Flotante cid={cid} titulo="Permisos guardados">
      {lista === null && <p className="px-2.5 py-2 text-[12px] text-muy">Leyendo…</p>}
      {lista?.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muy">No hay reglas guardadas. «Siempre» en un permiso las añade.</p>}
      {error && <p className="px-2.5 py-1 text-[12px] text-mal">{error}</p>}
      {ambitos.map((a) => {
        const filas = lista?.filter((r) => r.ambito === a) ?? [];
        if (!filas.length) return null;
        return (
          <div key={a} className="mb-1">
            <p className="px-2.5 pb-1 pt-2 text-[10.5px] uppercase tracking-wider text-muy" title={filas[0].archivo}>
              {AMBITO[a]}
            </p>
            {filas.map((r) => (
              <div key={`${r.archivo}|${r.tipo}|${r.regla}`} className="group flex items-center gap-2 rounded-md px-2.5 py-1 hover:bg-hover">
                <KeyRound size={11} strokeWidth={1.8} className="flex-none text-muy" />
                <span className={`w-16 flex-none text-[11px] ${TIPO[r.tipo]?.[1] ?? ""}`}>{TIPO[r.tipo]?.[0] ?? r.tipo}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-texto" title={r.regla}>
                  {r.regla}
                </span>
                <button
                  type="button"
                  title="Quitar esta regla"
                  onClick={() => quitar(r)}
                  className="grid size-5 flex-none place-items-center rounded text-muy opacity-0 hover:text-mal group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </Flotante>
  );
}

/** El panel flotante que toque (/mcp o /permissions) de esta conversación. */
export function FlotantesClaude({ cid, c, carpeta }: { cid: string; c: Conversacion; carpeta: string | null }) {
  const f = useFlotante((s) => s.por[cid] ?? null);
  if (f === "mcp") return <PanelMcp cid={cid} c={c} />;
  if (f === "permisos") return <PanelPermisos cid={cid} carpeta={carpeta} />;
  return null;
}

/** En el pie de una conversación con otro agente: su plan y entrar en la cuenta. */
export function PieAgente({ c }: { c: Conversacion }) {
  if (!c.agente) return null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {c.planAgente && (
        <span
          title={`${c.planAgente.nombre}${c.planAgente.enlace ? ` · mejorarlo en ${c.planAgente.enlace}` : ""}`}
          className="min-w-0 truncate"
        >
          {/* «Antigravity Starter Quota» → «Starter Quota»: el agente ya se ve en la cabecera. */}
          {c.planAgente.nombre.replace(new RegExp(`^${nombreAgente(c)}\\s+`, "i"), "")}
        </span>
      )}
      <button
        type="button"
        onClick={() => void acpEntrar(c.agente!)}
        title={`Abre el inicio de sesión de ${nombreAgente(c)} (cuenta de Google)`}
        className="flex-none rounded px-1 text-acento2 hover:bg-hover"
      >
        Entrar
      </button>
    </span>
  );
}

export const IconoMas = () => <MoreHorizontal size={14} strokeWidth={1.8} />;
