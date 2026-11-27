// Lo que Kyu hace por su cuenta: /mcp, /permissions, #nota y /memory, /export, /context.
import { create } from "zustand";
import { guardarArchivo as archivoGuardar, exportarConversacion, controlClaude, leerArchivo } from "../nucleo";
import { useKyu } from "../estado";
import { recargarRuta } from "../editores";
import { type UsoContexto } from "../claudeOpciones";
import { type Conversacion, nombreAgente, espacioDe, tituloDe, conversacion, cambiar, añadir } from "./estado";
import { carpetaDelEspacio } from "./sitios";

/** Para algo que Claude dejó en segundo plano (`stop_task`). */
export async function pararFondo(cid: string, tarea: string) {
  const c = conversacion(cid);
  if (c.claudeId === null || c.agente) return;
  try {
    await controlClaude(c.claudeId, { subtype: "stop_task", task_id: tarea });
  } catch (e) {
    añadir(cid, { tipo: "error", texto: `No se pudo parar: ${e}` });
  }
}

/** Estado de un servidor MCP de la conversación (`mcp_status`). */
export interface ServidorMcp {
  name: string;
  status: string;
  error?: string;
  scope?: string;
  serverInfo?: { name?: string; version?: string };
}

export async function servidoresMcp(cid: string): Promise<ServidorMcp[] | null> {
  const c = conversacion(cid);
  if (c.claudeId === null || c.agente) return null;
  const r = await controlClaude<{ mcpServers?: ServidorMcp[] }>(c.claudeId, { subtype: "mcp_status" });
  return r?.mcpServers ?? [];
}

/** Paneles flotantes de la conversación que abren /mcp y /permissions. */
export type Flotante = "mcp" | "permisos" | null;

export const useFlotante = create<{ por: Record<string, Flotante> }>(() => ({ por: {} }));

export const ponerFlotante = (cid: string, f: Flotante) => useFlotante.setState((s) => ({ por: { ...s.por, [cid]: f } }));

/** CLAUDE.md del proyecto de la conversación (su carpeta o la del terminal con el foco). */
function memoriaProyecto(cid: string): string | null {
  const c = conversacion(cid);
  const carpeta = c.carpeta ?? carpetaDelEspacio(espacioDe(cid));
  return carpeta ? `${carpeta.replace(/[\\/]+$/, "")}\\CLAUDE.md` : null;
}

/** «#nota»: la apunta al final del CLAUDE.md del proyecto (como el # de Claude Code). */
export async function apuntarMemoria(cid: string, nota: string) {
  const ruta = memoriaProyecto(cid);
  if (!ruta) return añadir(cid, { tipo: "error", texto: "No hay carpeta de proyecto donde apuntarlo" });
  const antes = await leerArchivo(ruta).catch(() => "");
  const salto = antes && !antes.endsWith("\n") ? "\n" : "";
  try {
    await archivoGuardar(ruta, `${antes}${salto}- ${nota}\n`);
    recargarRuta(ruta);
    añadir(cid, { tipo: "aviso", texto: `Apuntado en el CLAUDE.md del proyecto: «${nota}»` });
  } catch (e) {
    añadir(cid, { tipo: "error", texto: `No se pudo apuntar: ${e}` });
  }
}

/** /memory: abre el CLAUDE.md del proyecto (lo crea vacío si no hay). */
export async function abrirMemoria(cid: string) {
  const ruta = memoriaProyecto(cid);
  if (!ruta) return;
  const hay = await leerArchivo(ruta).then(() => true, () => false);
  if (!hay) await archivoGuardar(ruta, "").catch(() => {});
  useKyu.getState().abrirArchivo(ruta, 1, 1);
}

/** La conversación en Markdown: tus mensajes, las respuestas y cada herramienta en una línea. */
function comoMarkdown(c: Conversacion): string {
  const quien = nombreAgente(c);
  const partes = [`# ${c.titulo ?? tituloDe(c)}`, "", [quien, c.modelo, c.carpeta].filter(Boolean).join(" · "), ""];
  for (const e of c.entradas) {
    if (e.tipo === "tu") partes.push("## Tú", "", e.texto, "");
    else if (e.tipo === "claude") partes.push(`## ${quien}`, "", e.texto, "");
    else if (e.tipo === "herramienta") partes.push(`> ${e.nombre} ${e.resumen}`.trimEnd(), "");
    else if (e.tipo === "aviso" || e.tipo === "error") partes.push(`*${e.texto}*`, "");
  }
  return partes.join("\n");
}

/** /export: guarda la conversación como .md en Documentos\\Kyu\\conversaciones y la abre. */
export async function exportar(cid: string) {
  const c = conversacion(cid);
  if (!c.entradas.length) return;
  // Hora local (toISOString va en UTC).
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}-${dos(d.getMinutes())}`;
  try {
    const ruta = await exportarConversacion(`${fecha} ${tituloDe(c).replace(/…$/, "")}`, comoMarkdown(c));
    añadir(cid, { tipo: "aviso", texto: `Exportada en ${ruta}` });
    useKyu.getState().abrirArchivo(ruta, 1, 1);
  } catch (e) {
    añadir(cid, { tipo: "error", texto: `No se pudo exportar: ${e}` });
  }
}

/** Pide a Claude el desglose del contexto y lo guarda en la conversación. */
export async function refrescarContexto(espacio: string) {
  const c = conversacion(espacio);
  if (c.claudeId === null || c.agente) return;
  try {
    const u = await controlClaude<UsoContexto>(c.claudeId, { subtype: "get_context_usage" });
    cambiar(espacio, (x) => (x.claudeId === c.claudeId ? { contexto: u, tokens: u.totalTokens } : {}));
  } catch {
    // Sin desglose se queda la cifra de tokens del último mensaje.
  }
}
