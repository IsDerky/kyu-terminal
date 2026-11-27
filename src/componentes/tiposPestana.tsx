// Qué es cada tipo de pestaña: su nombre, el texto al pasar por encima, el icono y lo que se
// ve dentro. Un tipo nuevo se añade aquí (y en estado.ts y restaurar.ts), no en cada sitio
// que pinta pestañas.
import { lazy, Suspense } from "react";
import { FileSearch, FolderTree, GitCommitHorizontal, ListX } from "lucide-react";
import type { Item } from "../lib/estado";
import type { ConfigVista, Perfil } from "../lib/nucleo";
import { espacioDe, nombreAgente, useClaude } from "../lib/claude";
import { colorDe, iconoDe } from "../lib/estiloPestana";
import { IconoAgente, IconoArchivo, IconoPerfil, Mascota } from "./iconos";
import VistaTerminal from "./VistaTerminal";
import VistaArbol from "./VistaArbol";
// CodeMirror y el panel de Claude se cargan al abrir la primera pestaña que los usa.
const VistaArchivo = lazy(() => import("./VistaArchivo"));
const PanelClaude = lazy(() => import("./PanelClaude"));
const VistaCambios = lazy(() => import("./VistaCambios"));
const VistaProblemas = lazy(() => import("./VistaProblemas"));
const VistaVisor = lazy(() => import("./VistaVisor"));

type Tipo = Item["tipo"];
type De<T extends Tipo> = Extract<Item, { tipo: T }>;

/** Lo que necesita una pestaña para pintarse. */
export interface Contexto {
  /** Espacio activo (el del panel). */
  espacio: string;
  conFoco: boolean;
  config: ConfigVista;
  /** Nombre de lo que corre en la terminal (actividad.ts). */
  actividad?: string;
}

interface Descriptor<T extends Tipo> {
  nombre: (it: De<T>, ctx: Contexto) => React.ReactNode;
  titulo: (it: De<T>) => string;
  icono: (it: De<T>, ctx: Contexto) => React.ReactNode;
  vista: (it: De<T>, ctx: Contexto) => React.ReactNode;
  /** Con cambios sin guardar: punto en la pestaña y pregunta al cerrar. */
  sucio?: (it: De<T>) => boolean;
}

const nombreArchivo = (ruta: string) => ruta.split(/[\\/]/).pop() ?? ruta;
const icono = (I: typeof FolderTree) => <I size={12} strokeWidth={1.8} className="flex-none" />;
const diferida = (n: React.ReactNode) => <Suspense fallback={null}>{n}</Suspense>;

const TIPOS: { [T in Tipo]: Descriptor<T> } = {
  terminal: {
    nombre: (it, ctx) => it.nombre ?? ctx.actividad ?? it.titulo,
    titulo: (it) => it.carpeta ?? it.perfil,
    icono: (it, ctx) =>
      it.deClaude ? (
        <span title="Panel donde ejecuta Claude">
          <Mascota alto={9} />
        </span>
      ) : (
        <IconoTerminal it={it} perfil={ctx.config.perfiles.find((p) => p.nombre === it.perfil)} />
      ),
    vista: (it, ctx) => <VistaTerminal key={it.id} item={it.id} conFoco={ctx.conFoco} config={ctx.config} />,
  },
  archivo: {
    nombre: (it) => nombreArchivo(it.ruta),
    titulo: (it) => it.ruta,
    icono: () => <IconoArchivo size={12} />,
    vista: (it, ctx) => diferida(<VistaArchivo key={it.id} archivo={it} conFoco={ctx.conFoco} />),
    sucio: (it) => it.sucio,
  },
  arbol: {
    nombre: () => "Archivos",
    titulo: () => "Archivos (Ctrl+Mayús+B)",
    icono: () => icono(FolderTree),
    vista: (it) => <VistaArbol key={it.id} item={it.id} />,
  },
  claude: {
    nombre: (it) => <NombreConversacion cid={it.cid} />,
    titulo: (it) => `Conversación con ${nombreAgente(useClaude.getState().conversaciones[it.cid])}`,
    icono: (it) => <IconoConversacion cid={it.cid} />,
    vista: (it, ctx) => diferida(<PanelClaude key={it.id} espacio={espacioDe(it.cid)} conversacion={it.cid} conFoco={ctx.conFoco} />),
  },
  cambios: {
    nombre: () => "Cambios",
    titulo: (it) => `Cambios sin commit en ${it.raiz}`,
    icono: () => icono(GitCommitHorizontal),
    vista: (it, ctx) => diferida(<VistaCambios key={it.id} raiz={it.raiz} espacio={ctx.espacio} />),
  },
  problemas: {
    nombre: () => "Problemas",
    titulo: () => "Errores y avisos del último build o lint",
    icono: () => icono(ListX),
    vista: (it, ctx) => diferida(<VistaProblemas key={it.id} espacio={ctx.espacio} />),
  },
  visor: {
    nombre: (it) => `${it.host ? `${it.host} · ` : ""}${it.ruta ? nombreArchivo(it.ruta) : "Visor de archivos"}`,
    titulo: (it) => `Visor de archivos · ${it.host ? `${it.host}:` : ""}${it.ruta ?? it.raiz ?? "carpeta del espacio"}`,
    icono: () => icono(FileSearch),
    vista: (it, ctx) => diferida(<VistaVisor key={it.id} visor={it} conFoco={ctx.conFoco} />),
    sucio: (it) => it.sucio,
  },
};

// TypeScript no relaciona `it.tipo` con la entrada de la tabla: se busca aquí una vez.
const de = (it: Item) => TIPOS[it.tipo] as unknown as Descriptor<Tipo>;

export const nombrePestana = (it: Item, ctx: Contexto) => de(it).nombre(it as never, ctx);
export const tituloPestana = (it: Item) => de(it).titulo(it as never);
export const iconoPestana = (it: Item, ctx: Contexto) => de(it).icono(it as never, ctx);
export const vistaPestana = (it: Item, ctx: Contexto) => de(it).vista(it as never, ctx);
export const pestanaSucia = (it: Item) => de(it).sucio?.(it as never) ?? false;

/** Icono de una terminal: el puesto a mano (con su color) o el del perfil. */
function IconoTerminal({ it, perfil }: { it: De<"terminal">; perfil: Perfil | undefined }) {
  const Icono = iconoDe(it.icono);
  const color = colorDe(it.color);
  if (!Icono) return <IconoPerfil perfil={perfil} size={12} color={color} />;
  return <Icono size={12} strokeWidth={1.8} className="flex-none" style={color ? { color } : undefined} />;
}

/** Icono de una conversación: el de quien contesta en ella. */
function IconoConversacion({ cid }: { cid: string }) {
  const agente = useClaude((s) => s.conversaciones[cid]?.agente);
  return <IconoAgente agente={agente} alto={9} />;
}

/** Nombre de una conversación: su título o primer mensaje, o quien contesta si está vacía. */
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
