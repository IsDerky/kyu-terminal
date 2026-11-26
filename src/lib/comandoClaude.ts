// El último comando de una respuesta de Claude, preparado en gris en la terminal donde va
// (PowerShell, WSL o un servidor por ssh). Nunca se ejecuta solo: Tab lo escribe e Intro
// lo lanza quien lo lee. Si no hay ninguna terminal que encaje, el panel ofrece abrirla.
import { create } from "zustand";
import { espacioDe, useClaude, type Conversacion } from "./claude";
import { paneles, useKyu, type Item } from "./estado";
import { escribirPty } from "./nucleo";
import { perfilesConfigurados, sesion, type Sesion } from "./terminales";

export type Destino = { tipo: "ssh"; host: string } | { tipo: "wsl" } | { tipo: "powershell" };

export interface Preparado {
  comando: string;
  destino: Destino;
  /** Terminal donde quedó en gris; null = no había ninguna que encajara. */
  item: string | null;
  /** Mensaje de Claude del que salió (al llegar otro, se quita). */
  entrada: number;
}

export const usePreparados = create<{ porConv: Record<string, Preparado> }>(() => ({ porConv: {} }));

const poner = (cid: string, p: Preparado | null) =>
  usePreparados.setState((s) => {
    const { [cid]: _, ...resto } = s.porConv;
    return { porConv: p ? { ...resto, [cid]: p } : resto };
  });

export const nombreDestino = (d: Destino) => (d.tipo === "ssh" ? `ssh ${d.host}` : d.tipo === "wsl" ? "WSL" : "PowerShell");

const SHELLS = new Set(["", "powershell", "ps1", "pwsh", "ps", "bash", "sh", "shell", "zsh", "console"]);

/** El último bloque de comando del texto y adónde va, o null si no está claro. */
export function comandoDe(texto: string): { comando: string; destino: Destino } | null {
  const bloques = [...texto.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)];
  const ultimo = bloques[bloques.length - 1];
  if (!ultimo || ultimo.index === undefined) return null;
  const lenguaje = ultimo[1].toLowerCase();
  if (!SHELLS.has(lenguaje)) return null;
  // Solo comandos de una línea: con varias, Intro en mitad del pegado lanzaría cada una.
  const lineas = ultimo[2].split("\n").map((l) => l.trim()).filter(Boolean);
  if (lineas.length !== 1) return null;
  const comando = lineas[0];

  // Lo que dice justo encima del bloque («En WSL:», «En el OptiPlex (`ssh servidor`):»…).
  const antes = texto.slice(0, ultimo.index).trimEnd().split("\n").filter((l) => l.trim()).slice(-2).join(" ");
  const ssh = /\bssh(?:\.exe)?\s+(?:-\S+\s+)*(?:[\w.-]+@)?([\w.-]+)/i.exec(antes);
  if (ssh) return { comando, destino: { tipo: "ssh", host: ssh[1] } };
  if (/\bWSL\b|\bUbuntu\b/i.test(antes)) return { comando, destino: { tipo: "wsl" } };
  if (/PowerShell|\bpwsh\b/i.test(antes)) return { comando, destino: { tipo: "powershell" } };
  if (lenguaje === "powershell" || lenguaje === "ps1" || lenguaje === "pwsh" || lenguaje === "ps") return { comando, destino: { tipo: "powershell" } };
  if (lenguaje === "bash" || lenguaje === "sh" || lenguaje === "zsh") return { comando, destino: { tipo: "wsl" } };
  return null;
}

type Terminal = Extract<Item, { tipo: "terminal" }>;

const esWsl = (perfil: string) => {
  const p = perfilesConfigurados().find((x) => x.nombre === perfil);
  return /ubuntu|wsl|debian|linux/i.test(perfil) || p?.icono === "linux";
};
const esPowershell = (perfil: string) => {
  const p = perfilesConfigurados().find((x) => x.nombre === perfil);
  return /powershell|pwsh/i.test(perfil) || p?.icono === "powershell";
};
const perfilSsh = (host: string) => `SSH · ${host}`;

/** Orden en marcha en la terminal (la del último bloque, si sigue corriendo). */
function enMarcha(s: Sesion | undefined): string | null {
  const ultimo = s?.bloques.lista[s.bloques.lista.length - 1];
  return ultimo?.estado === "corre" ? (ultimo.orden ?? "") : null;
}

function encaja(t: Terminal, d: Destino): boolean {
  const s = sesion(t.id);
  if (!s?.auto || s.ptyId === null) return false;
  const corre = enMarcha(s);
  if (d.tipo === "ssh") {
    if (t.perfil === perfilSsh(d.host)) return true;
    const re = new RegExp(`^ssh(?:\\.exe)?\\s+(?:-\\S+\\s+)*(?:[\\w.-]+@)?${d.host.replace(/[.]/g, "\\.")}(?:\\s|$)`, "i");
    return corre !== null && re.test(corre.trim());
  }
  // En local: la shell tiene que estar libre (con el prompt delante).
  if (corre !== null) return false;
  return d.tipo === "wsl" ? esWsl(t.perfil) : esPowershell(t.perfil);
}

/** Terminal donde va: primero en el espacio de la conversación, luego en cualquiera. */
function buscarTerminal(espacio: string, d: Destino): string | null {
  const k = useKyu.getState();
  const terminales = Object.values(k.items).filter((i): i is Terminal => i.tipo === "terminal" && encaja(i, d));
  if (!terminales.length) return null;
  const esp = k.espacios.find((e) => e.id === espacio);
  const delEspacio = new Set(esp ? paneles(esp.raiz).flatMap((p) => p.items) : []);
  return (terminales.find((t) => delEspacio.has(t.id)) ?? terminales[0]).id;
}

function preparar(cid: string, entrada: number, comando: string, destino: Destino) {
  const item = buscarTerminal(espacioDe(cid), destino);
  if (item) sesion(item)?.auto?.proponer(comando, destino.tipo !== "ssh");
  poner(cid, { comando, destino, item, entrada });
}

/** Espera a que la terminal se calle un momento (prompt listo) saltándose los de contraseña. */
function esperarPrompt(s: Sesion, maximo = 60_000): Promise<boolean> {
  return new Promise((listo) => {
    let t: number | undefined;
    const fin = window.setTimeout(() => acabar(false), maximo);
    const acabar = (ok: boolean) => {
      clearTimeout(t);
      clearTimeout(fin);
      quitar.dispose();
      listo(ok);
    };
    const mirar = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const b = s.term.buffer.active;
        const linea = b.getLine(b.baseY + b.cursorY)?.translateToString(true) ?? "";
        // Pidiendo frase o contraseña: aún no es el prompt.
        if (/passphrase|password|contraseña|\(yes\/no/i.test(linea)) return;
        acabar(true);
      }, 900);
    };
    const quitar = s.term.onWriteParsed(mirar);
    mirar();
  });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** «Abrir ssh servidor» / «Abrir WSL»: terminal nueva al lado, conectada, con el comando preparado. */
export async function abrirYPreparar(cid: string) {
  const p = usePreparados.getState().porConv[cid];
  if (!p) return;
  const perfiles = perfilesConfigurados().map((x) => x.nombre);
  const d = p.destino;
  let perfil: string | undefined;
  let conectar: string | null = null;
  if (d.tipo === "ssh") {
    perfil = perfiles.find((x) => x === perfilSsh(d.host));
    if (!perfil) {
      perfil = perfiles.find(esPowershell) ?? perfiles[0];
      conectar = `ssh ${d.host}`;
    }
  } else {
    perfil = perfiles.find(d.tipo === "wsl" ? esWsl : esPowershell);
  }
  if (!perfil) return;
  const item = useKyu.getState().terminalAlLado(espacioDe(cid), perfil, null, d.tipo === "ssh" ? d.host : perfil);
  if (!item) return;
  poner(cid, { ...p, item });
  // La sesión nace al montarse la vista: se espera a que exista y tenga shell.
  let s: Sesion | undefined;
  for (let i = 0; i < 100 && !(s = sesion(item))?.ptyId; i++) await esperar(100);
  if (!s) return;
  // En local basta con dejarlo: sale en gris en cuanto aparezca el prompt.
  if (d.tipo !== "ssh") return void s.auto?.proponer(p.comando, true);
  if (!(await esperarPrompt(s))) return;
  if (conectar && s.ptyId !== null) {
    await escribirPty(s.ptyId, `${conectar}\r`);
    await esperar(300);
    if (!(await esperarPrompt(s))) return;
  }
  if (usePreparados.getState().porConv[cid]?.entrada === p.entrada) s.auto?.proponer(p.comando, false);
}

/** Al acabar Claude un turno, prepara el último comando de su respuesta. */
export function vigilarComandos(): () => void {
  const hechos = new Set<string>();
  return useClaude.subscribe((s, antes) => {
    for (const [cid, c] of Object.entries(s.conversaciones)) {
      const previa: Conversacion | undefined = antes.conversaciones[cid];
      // Mensaje tuyo nuevo: lo preparado de antes ya no toca.
      const ultimaTuya = [...c.entradas].reverse().find((e) => e.tipo === "tu")?.id;
      const pre = usePreparados.getState().porConv[cid];
      if (pre && ultimaTuya !== undefined && ultimaTuya > pre.entrada) {
        if (pre.item) sesion(pre.item)?.auto?.quitarPropuesta();
        poner(cid, null);
      }
      // Solo un turno que acaba ahora (no lo restaurado al abrir Kyu).
      if (c.estado !== "listo" || (previa?.estado !== "pensando" && previa?.estado !== "arrancando")) continue;
      const ultima = [...c.entradas].reverse().find((e) => e.tipo === "claude");
      if (!ultima || ultima.tipo !== "claude" || (ultimaTuya !== undefined && ultima.id < ultimaTuya)) continue;
      const clave = `${cid}:${ultima.id}`;
      if (hechos.has(clave)) continue;
      hechos.add(clave);
      const r = comandoDe(ultima.texto);
      if (r) preparar(cid, ultima.id, r.comando, r.destino);
    }
  });
}
