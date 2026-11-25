// Nombres en español e iconos de las herramientas de Claude Code (panel y avisos).
import { Bot, FilePen, FileText, Globe, ListTodo, MessageCircleQuestion, Search, Terminal, Wrench, type LucideIcon } from "lucide-react";

const HERRAMIENTAS: Record<string, [string, LucideIcon]> = {
  Read: ["Leer", FileText],
  Write: ["Escribir", FilePen],
  Edit: ["Editar", FilePen],
  MultiEdit: ["Editar", FilePen],
  NotebookEdit: ["Editar", FilePen],
  Bash: ["Ejecutar", Terminal],
  PowerShell: ["Ejecutar", Terminal],
  Grep: ["Buscar", Search],
  Glob: ["Buscar archivos", Search],
  WebFetch: ["Abrir web", Globe],
  WebSearch: ["Buscar en la web", Globe],
  Agent: ["Agente", Bot],
  Task: ["Agente", Bot],
  TodoWrite: ["Tareas", ListTodo],
  ExitPlanMode: ["Plan", ListTodo],
  AskUserQuestion: ["Pregunta", MessageCircleQuestion],
  Skill: ["Habilidad", Wrench],
  Monitor: ["Vigilar", Terminal],
  TaskStop: ["Parar tarea", Terminal],
  ToolSearch: ["Cargar herramientas", Wrench],
  mcp__kyu__ejecutar_en_panel: ["Ejecutar en Kyu", Terminal],
  mcp__kyu__leer_panel: ["Leer panel", FileText],
  mcp__kyu__listar_paneles: ["Ver paneles", Terminal],
};

export const herramienta = (nombre: string): [string, LucideIcon] => HERRAMIENTAS[nombre] ?? [nombre, Wrench];

const DE_ARCHIVO = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Para las herramientas de archivos: [nombre del archivo, carpeta]; si no, null. */
export function partirRuta(nombre: string, resumen: string): [string, string] | null {
  if (!DE_ARCHIVO.has(nombre)) return null;
  const corte = Math.max(resumen.lastIndexOf("\\"), resumen.lastIndexOf("/"));
  return [resumen.slice(corte + 1), corte > 0 ? resumen.slice(0, corte) : ""];
}

/** Ruta relativa a la carpeta de la conversación, si está dentro. */
export function relativa(texto: string, carpeta: string | null) {
  if (!carpeta) return texto;
  const base = carpeta.replace(/[\\/]+$/, "").toLowerCase();
  const t = texto.toLowerCase();
  return t.startsWith(base + "\\") || t.startsWith(base + "/") ? texto.slice(base.length + 1) : texto;
}
