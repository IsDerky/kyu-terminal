// Lo que se elige en el panel de Claude (modo, modelo, esfuerzo) y lo que Claude Code ofrece
// (comandos con barra, modelos), sacado de su `initialize` y guardado para la próxima vez.
import { ClipboardList, Hand, Pencil, Zap, type LucideIcon } from "lucide-react";

export interface Comando {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface Modelo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAutoMode?: boolean;
}

export interface Catalogo {
  commands: Comando[];
  models: Modelo[];
}

export interface Preferencias {
  /** Alias de `--model` (null = el predeterminado de Claude Code). */
  modelo: string | null;
  modo: string;
  /** null = el que decida Claude Code. */
  esfuerzo: string | null;
}

export interface CategoriaContexto {
  name: string;
  tokens: number;
  isDeferred?: boolean;
}

export interface UsoContexto {
  categories: CategoriaContexto[];
  totalTokens: number;
  maxTokens: number;
  percentage: number;
}

const CLAVE_CATALOGO = "kyu:claude-catalogo";
const CLAVE_PREFS = "kyu:claude-prefs";

function leer<T>(clave: string): T | null {
  try {
    const v = localStorage.getItem(clave);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export const catalogoGuardado = () => leer<Catalogo>(CLAVE_CATALOGO);

export function guardarCatalogo(c: Catalogo) {
  localStorage.setItem(CLAVE_CATALOGO, JSON.stringify({ commands: c.commands ?? [], models: c.models ?? [] }));
}

export const prefsGuardadas = (): Preferencias => ({ modelo: null, modo: "default", esfuerzo: null, ...leer<Preferencias>(CLAVE_PREFS) });

export const guardarPrefs = (p: Preferencias) => localStorage.setItem(CLAVE_PREFS, JSON.stringify(p));

export interface Modo {
  id: string;
  nombre: string;
  ayuda: string;
  Icono: LucideIcon;
  /** Clase de color del recuadro (vacía = gris). */
  color: string;
}

/** En el orden de Mayús+Tab. `auto` solo si el modelo lo admite. */
export const MODOS: Modo[] = [
  { id: "default", nombre: "Pedir permiso", ayuda: "Pregunta antes de editar archivos o ejecutar órdenes", Icono: Hand, color: "" },
  { id: "acceptEdits", nombre: "Editar sin preguntar", ayuda: "Edita archivos sin preguntar; las órdenes sí las pregunta", Icono: Pencil, color: "text-acento" },
  { id: "plan", nombre: "Planificar", ayuda: "Solo lee y propone un plan; no cambia nada hasta que lo apruebes", Icono: ClipboardList, color: "text-aviso" },
  { id: "auto", nombre: "Automático", ayuda: "Claude decide qué necesita permiso y qué no", Icono: Zap, color: "text-claude2" },
];

export const modo = (id: string) => MODOS.find((m) => m.id === id) ?? MODOS[0];

export function modosDisponibles(m: Modelo | undefined) {
  return MODOS.filter((x) => x.id !== "auto" || m?.supportsAutoMode);
}

/** El modelo del catálogo para un alias elegido (null = el predeterminado, el primero). */
export const modeloDe = (cat: Catalogo | null, valor: string | null) =>
  cat?.models.find((m) => m.value === (valor ?? "default")) ?? (valor ? undefined : cat?.models[0]);

export const ESFUERZOS: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

/** Niveles de esfuerzo del modelo; vacío si no admite elegirlo. */
export function esfuerzos(m: Modelo | undefined) {
  if (m && !m.supportsEffort) return [];
  return m?.supportedEffortLevels ?? ["low", "medium", "high"];
}

/** Las versiones con nombre completo (claude-opus-4-7…) son fijas; los alias (opus, sonnet…) siguen a la última. */
export const esVersionFija = (valor: string) => valor.startsWith("claude-");

const AYUDAS: Record<string, string> = {
  default: "El que recomienda Claude Code",
  opus: "Para trabajo complejo y el día a día",
  sonnet: "El más eficiente para tareas sencillas",
  fable: "Para lo más difícil y las tareas largas",
  haiku: "El más rápido, para respuestas rápidas",
};

/** Descripción corta en español; si no la hay, la de Claude Code (sin el nombre delante). */
export function ayudaModelo(m: Modelo) {
  const base = m.value.replace(/\[.*\]$/, "");
  const extra = /\[1m\]/i.test(m.value) ? " · contexto de 1 M" : "";
  return AYUDAS[base] ? AYUDAS[base] + extra : m.description.split("·").slice(1).join("·").trim() || m.description;
}

/** «Opus 4.7 · Most capable…» → «Opus 4.7». */
export const nombreModelo = (m: Modelo | undefined, id: string) =>
  m ? (m.value === "default" ? m.description.split("·")[0].trim() || m.displayName : m.displayName) : id.replace(/^claude-/, "");

const CATEGORIAS: Record<string, string> = {
  "System prompt": "Instrucciones del sistema",
  "System tools": "Herramientas del sistema",
  "MCP tools": "Herramientas MCP",
  "MCP server instructions": "Instrucciones de los MCP",
  "Custom agents": "Agentes propios",
  "Memory files": "Memoria (CLAUDE.md)",
  Skills: "Skills",
  Messages: "Mensajes",
  "Autocompact buffer": "Reserva para compactar",
  "Free space": "Libre",
};

export const nombreCategoria = (n: string) => CATEGORIAS[n] ?? n;

/** Descripción del comando sin la marca «(user)» / «(project)» del final. */
export function partirDescripcion(d: string): [string, string | null] {
  const m = d.match(/^(.*?)\s*\((user|project|plugin[^)]*|bundled)\)\s*$/s);
  return m ? [m[1], m[2] === "user" ? "tuyo" : m[2] === "project" ? "proyecto" : m[2]] : [d, null];
}
