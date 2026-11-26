// Qué sale en el menú de clic derecho de cada zona (terminal, cajas de texto y el resto).
import {
  ClipboardPaste,
  Code,
  Columns2,
  Copy,
  Eraser,
  ExternalLink,
  FolderOpen,
  Globe,
  Plus,
  Command,
  RotateCcw,
  Rows2,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  TextSelect,
  Undo2,
} from "lucide-react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { limpiarSeparadores, opcion, separador, useMenu, type Elemento, type Rapida } from "./menu";
import { duracion, textoBloque, textoSeleccion, type Bloque } from "./bloques";
import { espacioDeItem } from "./actividad";
import { adjuntar, nuevaConversacion } from "./claude";
import { paneles, useKyu } from "./estado";
import { escribirPty } from "./nucleo";
import { preguntarPorSeleccion } from "./seleccion";
import { sesion, type Sesion } from "./terminales";

const URL_SOLA = /^https?:\/\/\S+$/;

/** El bloque (orden) en la fila `y` del terminal: el último que empieza en ella o antes. */
function bloqueEn(s: Sesion, clientY: number): Bloque | null {
  const pantalla = s.term.element?.querySelector(".xterm-screen");
  if (!pantalla) return null;
  const r = pantalla.getBoundingClientRect();
  const fila = Math.floor(((clientY - r.top) / r.height) * s.term.rows);
  if (fila < 0 || fila >= s.term.rows) return null;
  const linea = s.term.buffer.active.viewportY + fila;
  let elegido: Bloque | null = null;
  for (const b of s.bloques.lista) if (b.inicio.line >= 0 && b.inicio.line <= linea) elegido = b;
  return elegido;
}

function panelDe(item: string): string | undefined {
  const k = useKyu.getState();
  for (const e of k.espacios) {
    const p = paneles(e.raiz).find((x) => x.items.includes(item));
    if (p) return p.id;
  }
  return undefined;
}

/**
 * Menú de la terminal: fila rápida (Copiar, Pegar, Buscar, Limpiar), lo seleccionado, la
 * orden que hay bajo el puntero y lo del panel. Con texto seleccionado el clic derecho ya
 * copia directo; aquí se llega sin selección o con Mayús.
 */
export function abrirMenuTerminal(item: string, x: number, y: number) {
  const s = sesion(item);
  if (!s) return;
  const { term, bloques } = s;
  const k = useKyu.getState();
  const it = k.items[item];
  const perfil = it?.tipo === "terminal" ? it.perfil : "";
  const espacio = espacioDeItem(item) ?? k.activo;
  const sel = term.hasSelection() ? textoSeleccion(term, bloques).replace(/\s+$/g, "") : "";

  const rapidas: Rapida[] = [
    { icono: Copy, texto: "Copiar", desactivada: !sel, hacer: () => void writeText(sel).then(() => term.clearSelection()) },
    { icono: ClipboardPaste, texto: "Pegar", hacer: () => void readText().then((t) => t && (term.paste(t), term.focus())) },
    { icono: Search, texto: "Buscar", hacer: () => k.ponerBuscando(item) },
    { icono: Eraser, texto: "Limpiar", hacer: () => (term.clear(), term.focus()) },
  ];

  const elementos: Elemento[] = [];
  if (sel) {
    const una = sel.trim();
    elementos.push(opcion(Sparkles, "Preguntar a Claude sobre esto", () => void preguntarPorSeleccion(), { atajo: "Alt+K", estilo: "claude" }));
    if (URL_SOLA.test(una)) elementos.push(opcion(ExternalLink, "Abrir el enlace", () => void openUrl(una)));
    if (una.length <= 200 && !una.includes("\n")) {
      elementos.push(opcion(Globe, "Buscar en la web", () => void openUrl(`https://www.google.com/search?q=${encodeURIComponent(una)}`)));
    }
    elementos.push(separador);
  }

  const b = bloqueEn(s, y);
  const acabada = b && (b.estado === "ok" || b.estado === "mal") && b.orden;
  let contexto;
  if (acabada) {
    const orden = b.orden!;
    contexto = {
      icono: SquareTerminal,
      texto: orden.length > 40 ? `${orden.slice(0, 39)}…` : orden,
      detalle: `${b.estado === "ok" ? "✓" : "✗"}${b.durMs !== undefined ? ` ${duracion(b.durMs)}` : ""}`,
      color: b.estado === "ok" ? ("ok" as const) : ("mal" as const),
    };
    // Volver a ejecutar solo con el prompt vacío: si hay algo escrito, se mezclaría.
    const libre = s.ptyId !== null && bloques.entradaActual() === "";
    elementos.push(
      opcion(Copy, "Copiar la orden", () => void writeText(orden)),
      opcion(Code, "Copiar la salida", () => {
        const t = textoBloque(term, b);
        if (t) void writeText(t.salida);
      }),
      opcion(RotateCcw, "Volver a ejecutar", () => (void escribirPty(s.ptyId!, `${orden}\r`), term.focus()), { desactivada: !libre }),
      opcion(Sparkles, "Explicar con Claude", () => {
        const t = textoBloque(term, b);
        if (t) adjuntar(espacio, t);
      }, { estilo: "claude" }),
      separador,
    );
  }

  const panel = panelDe(item);
  const carpeta = [...bloques.lista].reverse().find((x) => x.ruta)?.ruta ?? (it?.tipo === "terminal" ? it.carpeta : null);
  elementos.push(
    opcion(TextSelect, "Seleccionar todo", () => term.selectAll(), { atajo: "Ctrl+A" }),
    separador,
    opcion(Columns2, "Dividir a la derecha", () => k.dividir("horizontal", perfil, panel), { atajo: "Ctrl+Mayús+D" }),
    opcion(Rows2, "Dividir abajo", () => k.dividir("vertical", perfil, panel), { atajo: "Ctrl+Mayús+E" }),
  );
  if (carpeta) elementos.push(opcion(FolderOpen, "Mostrar la carpeta en el Explorador", () => void revealItemInDir(carpeta)));

  useMenu.getState().abrir({ x, y, rapidas, contexto, elementos: limpiarSeparadores(elementos), foco: null });
}

/** Cajas de texto (la de Claude, Ajustes, el editor): lo de siempre, con el estilo de Kyu. */
export function abrirMenuTexto(campo: HTMLElement, x: number, y: number) {
  const esCampo = campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement;
  const soloLectura = esCampo && (campo.readOnly || campo.disabled);
  const haySeleccion = esCampo
    ? (campo.selectionStart ?? 0) !== (campo.selectionEnd ?? 0)
    : !!window.getSelection()?.toString();
  // execCommand sigue siendo la forma de tocar el texto sin romper el deshacer del campo.
  const hacer = (orden: string) => () => document.execCommand(orden);
  const elementos: Elemento[] = [
    opcion(Undo2, "Deshacer", hacer("undo"), { atajo: "Ctrl+Z", desactivada: soloLectura }),
    separador,
    opcion(Scissors, "Cortar", hacer("cut"), { atajo: "Ctrl+X", desactivada: !haySeleccion || soloLectura }),
    opcion(Copy, "Copiar", hacer("copy"), { atajo: "Ctrl+C", desactivada: !haySeleccion }),
    opcion(ClipboardPaste, "Pegar", () => void readText().then((t) => t && document.execCommand("insertText", false, t)), {
      atajo: "Ctrl+V",
      desactivada: soloLectura,
    }),
    opcion(TextSelect, "Seleccionar todo", hacer("selectAll"), { atajo: "Ctrl+A" }),
  ];
  useMenu.getState().abrir({ x, y, elementos, foco: campo });
}

/** Cualquier otro sitio: lo que se puede abrir. */
export function abrirMenuGeneral(x: number, y: number, perfil: string) {
  const k = useKyu.getState();
  useMenu.getState().abrir({
    x,
    y,
    elementos: [
      opcion(Plus, "Nueva terminal", () => k.nuevaPestana(perfil), { atajo: "Ctrl+Mayús+T" }),
      opcion(Sparkles, "Nueva conversación con Claude", () => nuevaConversacion(k.activo), { atajo: "Ctrl+Mayús+K", estilo: "claude" }),
      separador,
      opcion(Command, "Paleta de comandos", () => k.ponerPaleta(true), { atajo: "Ctrl+Mayús+P" }),
      opcion(SlidersHorizontal, "Ajustes", () => k.ponerAjustes(true), { atajo: "Ctrl+," }),
    ],
  });
}

/** Copia lo seleccionado en la terminal (clic derecho con selección). */
export function copiarSeleccionTerminal(item: string) {
  const s = sesion(item);
  if (!s?.term.hasSelection()) return false;
  void writeText(textoSeleccion(s.term, s.bloques));
  s.term.clearSelection();
  return true;
}

