// Herramientas MCP de Kyu para el Claude del panel (el servidor está en src-tauri/src/mcp.rs).
// Llega `mcp:llamada` con la conversación (id de Claude), la herramienta y sus argumentos;
// aquí se hace el trabajo sobre los terminales y se contesta con `mcp_responder`.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { duracion, textoBloque } from "./bloques";
import { espacioDe as espacioDeConversacion, ultimaDe, useClaude } from "./claude";
import { paneles, useKyu } from "./estado";
import { escribirPty } from "./nucleo";
import { sesion } from "./terminales";

interface Llamada {
  id: number;
  claude: number;
  herramienta: string;
  argumentos: Record<string, unknown> | null;
}

type Resultado = { texto: string; error?: boolean };

/** Terminal «Claude» de cada espacio (donde se ejecutan sus órdenes). */
const terminalesClaude = new Map<string, string>();

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espacio de la conversación con ese proceso de Claude. */
function espacioDe(claude: number): string | null {
  const conv = Object.entries(useClaude.getState().conversaciones).find(([, c]) => c.claudeId === claude);
  return conv ? espacioDeConversacion(conv[0]) : null;
}

function terminalesDe(espacio: string) {
  const s = useKyu.getState();
  const esp = s.espacios.find((e) => e.id === espacio);
  if (!esp) return [];
  return paneles(esp.raiz).flatMap((p) =>
    p.items.flatMap((id) => {
      const it = s.items[id];
      return it?.tipo === "terminal" ? [{ it, foco: p.id === esp.foco && p.activo === id }] : [];
    }),
  );
}

function listar(espacio: string): Resultado {
  const lista = terminalesDe(espacio).map(({ it, foco }) => {
    const ultimo = sesion(it.id)?.bloques.lista.at(-1);
    const estado =
      ultimo?.estado === "corre" ? "ejecutando una orden"
      : ultimo?.estado === "ok" || ultimo?.estado === "mal" ? `esperando (la última salió con código ${ultimo.codigo})`
      : "esperando";
    return {
      id: it.id,
      titulo: it.titulo,
      carpeta: it.carpeta,
      shell: it.perfil,
      foco,
      claude: terminalesClaude.get(espacio) === it.id,
      estado,
    };
  });
  return { texto: JSON.stringify(lista, null, 2) };
}

function leer(espacio: string, args: Record<string, unknown>): Resultado {
  const terms = terminalesDe(espacio);
  const id = typeof args.panel === "string" && args.panel ? args.panel : terms.find((t) => t.foco)?.it.id ?? terms[0]?.it.id;
  const s = id ? sesion(id) : undefined;
  if (!id || !s || !terms.some((t) => t.it.id === id)) return { texto: `No hay ningún terminal «${args.panel ?? ""}» en este espacio.`, error: true };
  const n = Math.min(1000, Math.max(1, Number(args.lineas) || 120));
  const buf = s.term.buffer.normal;
  const lineas: string[] = [];
  for (let y = 0; y < buf.length; y++) {
    const l = buf.getLine(y);
    if (!l) continue;
    const t = l.translateToString(true);
    if (l.isWrapped && lineas.length) lineas[lineas.length - 1] += t;
    else lineas.push(t);
  }
  while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop();
  return { texto: lineas.slice(-n).join("\n") || "(el terminal está vacío)" };
}

/** El terminal «Claude» del espacio, listo para recibir una orden (lo abre si hace falta). */
async function terminalClaude(espacio: string): Promise<string> {
  const k = useKyu.getState();
  let id = terminalesClaude.get(espacio);
  if (!id || !k.items[id] || !terminalesDe(espacio).some((t) => t.it.id === id)) {
    const conv = useClaude.getState().conversaciones[ultimaDe(espacio) ?? ""];
    const perfil = terminalesDe(espacio)[0]?.it.perfil ?? "";
    id = k.terminalAlLado(espacio, perfil, conv?.carpeta ?? null, "Claude", true) ?? undefined;
    if (!id) throw new Error("no se pudo abrir el panel «Claude»");
    terminalesClaude.set(espacio, id);
  }
  // Espera a que la shell haya arrancado y enseñe su prompt (hasta 20 s).
  for (let i = 0; i < 200; i++) {
    const s = sesion(id);
    const ultimo = s?.bloques.lista.at(-1);
    if (s?.ptyId != null && ultimo?.estado === "escribiendo" && ultimo.entrada) return id;
    if (s?.ptyId != null && ultimo?.estado === "corre") throw new Error("el panel «Claude» está ocupado con otra orden; espera o usa leer_panel");
    await esperar(100);
  }
  throw new Error("el panel «Claude» no ha arrancado a tiempo");
}

async function ejecutar(espacio: string, args: Record<string, unknown>): Promise<Resultado> {
  const orden = typeof args.orden === "string" ? args.orden.trim() : "";
  if (!orden) return { texto: "Falta la orden.", error: true };
  if (orden.includes("\n")) return { texto: "La orden tiene que ir en una sola línea.", error: true };
  const espera = Math.min(600, Math.max(1, Number(args.espera_segundos) || 60)) * 1000;
  const id = await terminalClaude(espacio);
  const s = sesion(id)!;
  const antes = s.bloques.lista.at(-1);
  // Si el usuario ha dejado algo escrito en ese panel, no se pisa.
  if (s.bloques.entradaActual()?.trim()) {
    return { texto: "El panel «Claude» tiene algo escrito a medias por el usuario; no lo piso. Pídele que lo borre.", error: true };
  }
  await escribirPty(s.ptyId!, orden + "\r");
  const inicio = Date.now();
  while (Date.now() - inicio < espera) {
    await esperar(150);
    // El bloque de la orden es el que había (el prompt donde se escribió).
    if (antes && (antes.estado === "ok" || antes.estado === "mal")) {
      const t = textoBloque(s.term, antes);
      if (t) {
        const cabecera = `${antes.estado === "ok" ? "Bien" : `Falló con código ${antes.codigo}`} · ${duracion(antes.durMs ?? 0)}`;
        const recorte = t.recortada ? ` (últimas líneas de ${t.lineas})` : "";
        return { texto: `${cabecera}${recorte}\n\n${t.salida || "(sin salida)"}`, error: antes.estado === "mal" };
      }
    }
  }
  const parcial = leer(espacio, { panel: id, lineas: 60 }).texto;
  return {
    texto: `Sigue ejecutándose en el panel «Claude» tras ${Math.round(espera / 1000)} s. Lo último que se ve:\n\n${parcial}\n\n(Usa leer_panel con panel «${id}» para ver cómo sigue.)`,
  };
}

async function atender(ll: Llamada): Promise<Resultado> {
  const espacio = espacioDe(ll.claude);
  if (!espacio) return { texto: "Esta conversación ya no tiene espacio en Kyu.", error: true };
  const args = ll.argumentos ?? {};
  switch (ll.herramienta) {
    case "listar_paneles":
      return listar(espacio);
    case "leer_panel":
      return leer(espacio, args);
    case "ejecutar_en_panel":
      return ejecutar(espacio, args);
    default:
      return { texto: `Herramienta desconocida: ${ll.herramienta}`, error: true };
  }
}

/** Empieza a atender las llamadas del MCP de Kyu. */
export function escucharMcp(): Promise<UnlistenFn> {
  return listen<Llamada>("mcp:llamada", (e) => {
    const ll = e.payload;
    void atender(ll)
      .catch((err: unknown) => ({ texto: err instanceof Error ? err.message : String(err), error: true }))
      .then((r) => invoke("mcp_responder", { id: ll.id, texto: r.texto, error: !!r.error }));
  });
}
