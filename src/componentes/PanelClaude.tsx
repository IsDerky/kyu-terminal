import BarraRunbook from "./BarraRunbook";
import { useEffect, useState } from "react";
import { AtSign, FolderOpen, History, ImageIcon, Loader2, SquarePen } from "lucide-react";
import { añadirImagenes, nombreAgente, ARRASTRE_RUTA, insertarEnCaja, mencionDe, conversacionEnPanel, marcarUltima, cargarCatalogo, carpetaDelEspacio, limiteContexto, pendiente, refrescarContexto, responder, siguienteModo, useClaude, vacia, ponerAgente, type Conversacion } from "../lib/claude";
import { type Comando } from "../lib/claudeOpciones";
import { DesgloseContexto, LimiteCuenta, SelectorCuenta, SelectorCuentaAntigravity } from "./ControlesClaude";
import { FlotantesClaude, IconoMas, MenuMas, PieAgente } from "./MasClaude";
import { ListaSesiones } from "./AdjuntosClaude";
import { imagenesDe, type ImagenAdjunta } from "../lib/imagenes";
import { useKyu } from "../lib/estado";
import { IconoAgente } from "./iconos";
import { corto, useGasto } from "../lib/gasto";
import { ListaEntradas } from "./EntradasClaude";
import { CajaEntrada } from "./CajaClaude";

export const SIN_COMANDOS: Comando[] = [];

export const SIN_IMAGENES: ImagenAdjunta[] = [];

export const nombreCarpeta = (ruta: string | null) => (ruta ? ruta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ruta : "~");

const dolares = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }) + " $";

const segundos = (ms: number) => (ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: ms < 10_000 ? 1 : 0 }) + " s";

/**
 * Una conversación con Claude, como pestaña de un panel (al lado de terminales y archivos).
 */
export default function PanelClaude({
  espacio: espacioReal,
  conversacion: cid,
  conFoco = false,
}: {
  /** Espacio de trabajo donde vive la pestaña. */
  espacio: string;
  /** Id de la conversación («espacio~pN»). */
  conversacion: string;
  /** Su panel tiene el foco (entonces el cursor va a la caja y pasa a ser la última usada). */
  conFoco?: boolean;
}) {
  // Desde aquí, `espacio` es el id de la conversación (las funciones de Claude trabajan con él);
  // `espacioReal` es el espacio de trabajo.
  const espacio = cid;
  const conv = useClaude((s) => s.conversaciones[espacio]);
  const prefs = useClaude((s) => s.prefs);
  const verContexto = useClaude((s) => s.verContexto === espacio);
  const ponerVerContexto = (v: boolean) => useClaude.setState({ verContexto: v ? espacio : null });
  // Antes de arrancar, la carpeta que se usará (sigue al terminal con el foco).
  const carpetaFoco = useKyu(() => carpetaDelEspacio(espacioReal));
  const c: Conversacion = conv ?? vacia(prefs);
  const carpeta = c.claudeId !== null || c.estado === "cerrado" || c.reanudar ? c.carpeta : carpetaFoco;
  const [verSesiones, setVerSesiones] = useState(false);
  const [soltando, setSoltando] = useState<"imagen" | "ruta" | null>(null);
  const limite = limiteContexto(c);
  const porcentaje = Math.min(100, Math.round((c.tokens / limite) * 100));
  const permiso = pendiente(conv);
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";

  // La primera vez que se abre, comandos y modelos para los menús.
  useEffect(() => {
    void cargarCatalogo(carpetaFoco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con el foco en su panel pasa a ser «la última»: ahí van Ctrl+Mayús+C, Alt+K y compañía.
  useEffect(() => {
    if (conFoco) marcarUltima(espacio);
  }, [conFoco, espacio]);

  // Mayús+Tab cambia de modo (como en `claude` y en VS Code). Con un permiso pendiente y el
  // foco en el panel: Intro permite, Esc deniega. La caja de texto lo resuelve antes (con
  // texto, Intro deniega y se lo dice a Claude).
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented) {
      e.preventDefault();
      siguienteModo(espacio);
      return;
    }
    if (!permiso || e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.target instanceof HTMLButtonElement && e.key === "Enter") return;
    if (e.key === "Escape") {
      e.preventDefault();
      void responder(espacio, permiso.id, "denegar");
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      // Unas preguntas no se aprueban con Intro: se contesta eligiendo.
      if (permiso.herramienta === "AskUserQuestion") return;
      e.preventDefault();
      void responder(espacio, permiso.id, "permitir", undefined, permiso.herramienta === "ExitPlanMode" ? "acceptEdits" : undefined);
    }
  };

  return (
    <section
      onKeyDown={teclas}
      // Soltar imágenes (y archivos desde la pestaña Archivos) en cualquier parte del panel.
      // Las pestañas de archivo solo sobre la caja: en el resto del panel se mueven, como siempre.
      onDragOver={(e) => {
        const tipos = e.dataTransfer.types;
        const ruta = tipos.includes(ARRASTRE_RUTA) && !tipos.includes("text/kyu-item");
        if (!ruta && ![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setSoltando(ruta ? "ruta" : "imagen");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setSoltando(null);
      }}
      onDrop={(e) => {
        const ruta = e.dataTransfer.types.includes("text/kyu-item") ? "" : e.dataTransfer.getData(ARRASTRE_RUTA);
        if (ruta) {
          e.preventDefault();
          setSoltando(null);
          insertarEnCaja(espacio, mencionDe(ruta, carpeta) + " ");
          return;
        }
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setSoltando(null);
        void imagenesDe(e.dataTransfer.files).then((l) => añadirImagenes(espacio, l));
      }}
      className="group/claude relative flex h-full w-full flex-col overflow-hidden bg-panel"
    >
      <header className="flex h-11 flex-none items-center gap-2 border-b border-borde pl-3.5 pr-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <IconoAgente agente={c.agente} alto={15} />
          {c.agente && <span className="text-[12px] font-medium text-tenue">{nombreAgente(c)}</span>}
        </span>
        <span
          title={carpeta ?? "Carpeta personal"}
          className="flex min-w-0 items-center gap-1.5 rounded-md border border-borde bg-tarjeta px-2 py-0.5 text-[11.5px] text-tenue"
        >
          <FolderOpen size={12} strokeWidth={1.8} className="flex-none" />
          <span className="truncate">{nombreCarpeta(carpeta)}</span>
        </span>
        <button
          type="button"
          data-boton-contexto
          title={`Contexto: ${c.tokens.toLocaleString("es-ES")} de ${limite.toLocaleString("es-ES")} tokens${c.agente ? "" : " · clic para el desglose"}`}
          onClick={() => {
            // El desglose lo da Claude (get_context_usage); los agentes por ACP solo dicen el total.
            if (c.agente) return;
            ponerVerContexto(!verContexto);
            if (!verContexto) void refrescarContexto(espacio);
          }}
          className={`ml-auto flex h-7 flex-none items-center gap-1.5 rounded-md px-1.5 text-[11px] text-tenue hover:bg-hover ${verContexto ? "bg-hover" : ""}`}
        >
          <span className="h-[5px] w-9 overflow-hidden rounded-full bg-hover">
            <span className="block h-full rounded-full bg-claude" style={{ width: `${porcentaje}%` }} />
          </span>
          {porcentaje} %
        </button>
        <span data-boton-sesiones>
          <BotonCabecera titulo="Conversaciones anteriores" onClick={() => setVerSesiones((v) => !v)}>
            <History size={14} strokeWidth={1.8} />
          </BotonCabecera>
        </span>
        <BotonCabecera titulo={`Otra conversación con ${nombreAgente(c)} en una pestaña de este panel`} onClick={() => nuevaIgual(espacioReal, c.agente)}>
          <SquarePen size={14} strokeWidth={1.8} />
        </BotonCabecera>
        <MenuMas
          cid={espacio}
          c={c}
          boton={(onClick) => (
            <BotonCabecera titulo={c.agente ? "Más: entrar, exportar" : "Más: servidores MCP, permisos, memoria, exportar"} onClick={onClick}>
              <IconoMas />
            </BotonCabecera>
          )}
        />
      </header>

      {verSesiones && (
        <ListaSesiones espacio={espacio} carpeta={carpeta} actual={c.sesion} agente={c.agente} alCerrar={() => setVerSesiones(false)} />
      )}
      {soltando && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center border-2 border-dashed border-claude/60 bg-panel/80">
          <span className="flex items-center gap-2 text-[13px] text-texto">
            {soltando === "ruta" ? (
              <>
                <AtSign size={15} strokeWidth={1.8} /> Suelta para añadirlo como @ruta
              </>
            ) : (
              <>
                <ImageIcon size={15} strokeWidth={1.8} /> Suelta las imágenes para {nombreAgente(c)}
              </>
            )}
          </span>
        </div>
      )}

      {verContexto && <DesgloseContexto espacio={espacio} c={c} alCerrar={() => ponerVerContexto(false)} />}
      <FlotantesClaude cid={espacio} c={c} carpeta={carpeta} />

      <ListaEntradas espacio={espacio} c={c} carpeta={carpeta} grande />

      <BarraRunbook cid={espacio} c={c} />
      <CajaEntrada enfocar={conFoco} grande espacio={espacio} c={c} carpeta={carpeta} ocupado={ocupado} permiso={permiso?.id ?? null} esPlan={permiso?.herramienta === "ExitPlanMode"} esPregunta={permiso?.herramienta === "AskUserQuestion"} />

      <footer className="relative flex h-7 flex-none items-center gap-2 border-t border-borde px-3.5 text-[11px] text-muy">
        <EstadoTurno c={c} />
        <span className="ml-auto" />
        {!c.agente && <SelectorCuenta espacio={espacio} c={c} />}
        {c.agente === "antigravity" && <SelectorCuentaAntigravity espacio={espacio} c={c} />}
        {!c.agente && <LimiteCuenta c={c} />}
        <PieAgente c={c} />
        {!c.agente && <BarraGasto />}
        {c.coste > 0 && <span title="Coste de la conversación">{dolares(c.coste)}</span>}
      </footer>
    </section>
  );
}

/** Lo de hoy frente al límite diario (si hay límite): ámbar desde el 80 %, rojo al pasarlo. */
/** Conversación nueva en este panel con el mismo agente (o Claude) que la que se está viendo. */
function nuevaIgual(espacio: string, agente: string | null) {
  const cid = conversacionEnPanel(espacio);
  if (agente) ponerAgente(cid, agente);
}

function BarraGasto() {
  const limite = useGasto((s) => s.limite);
  const hoy = useGasto((s) => s.hoy);
  if (!limite) return null;
  const p = hoy / limite;
  const color = p >= 1 ? "var(--color-mal)" : p >= 0.8 ? "var(--color-aviso)" : "var(--color-claude2)";
  return (
    <span
      className="flex flex-none items-center gap-1.5"
      title={`Hoy ${hoy.toLocaleString("es-ES")} tokens de salida de ${limite.toLocaleString("es-ES")} (límite diario, en Ajustes)`}
    >
      <span style={{ color: p >= 0.8 ? color : undefined }}>
        Hoy {corto(hoy)} / {corto(limite)}
      </span>
      <span className="h-[5px] w-12 overflow-hidden rounded-full bg-hover">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, p * 100)}%`, background: color }} />
      </span>
    </span>
  );
}

function BotonCabecera({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      className="grid size-7 flex-none place-items-center rounded-md text-muy hover:bg-hover hover:text-texto"
    >
      {children}
    </button>
  );
}

function EstadoTurno({ c }: { c: Conversacion }) {
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  const [, tic] = useState(0);
  useEffect(() => {
    if (!ocupado) return;
    const t = setInterval(() => tic((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ocupado]);

  if (ocupado) {
    return (
      <span className="flex items-center gap-1.5 text-claude2">
        <Loader2 size={11} className="animate-spin" />
        {c.compactando ? "Compactando" : c.estado === "arrancando" ? "Arrancando" : "Pensando"} · {segundos(Date.now() - c.desde)}
      </span>
    );
  }
  if (c.estado === "listo") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-ok" />
        Listo{c.duracion > 0 && ` · ${segundos(c.duracion)}`}
      </span>
    );
  }
  if (c.estado === "cerrado") return <span>Cerrado</span>;
  return <span className="min-w-0 truncate">Intro envía · Mayús+Intro, nueva línea · / comandos</span>;
}
