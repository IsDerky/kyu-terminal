// Qué sale en el menú de clic derecho de cada zona. La terminal no tiene: allí el clic
// derecho copia (con selección) o pega, como en cualquier terminal (ver terminales.ts).
import {
  ArrowDownToLine,
  ArrowRightToLine,
  AtSign,
  Bot,
  ClipboardPaste,
  Code,
  Columns2,
  Command,
  Copy,
  CopyPlus,
  Diff,
  FilePlus,
  FileSearch,
  FileText,
  FolderOpen,
  Palette,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Rows2,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  TextSelect,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { useSelectorEstilo } from "./estiloPestana";
import { cabecera, limpiarSeparadores, opcion, separador, useMenu, type Elemento } from "./menu";
import { agenteDestino, carpetaDelEspacio, insertarEnCaja, nombreAgente, irAClaude, mencionDe, nuevaConversacion, useClaude, verCambios } from "./claude";
import { destinoDe, esDeShell, nombreDestino, usarCodigo } from "./comandoClaude";
import { nuevoId, paneles, useKyu, type Item } from "./estado";
import { cerrarItem } from "./acciones";
import { borrarArchivo } from "./nucleo";
import { destruir, perfilesConfigurados, sesion } from "./terminales";

/** Carpeta en la que está ahora una terminal (la última que mandó su prompt). */
function carpetaDeTerminal(item: string): string | null {
  const it = useKyu.getState().items[item];
  const s = sesion(item);
  const ruta = s ? [...s.bloques.lista].reverse().find((b) => b.ruta)?.ruta : undefined;
  return ruta ?? (it?.tipo === "terminal" ? it.carpeta : null);
}

function relativaA(ruta: string, raiz: string | null): string {
  const base = raiz?.replace(/[\\/]+$/, "");
  if (base && ruta.toLowerCase().startsWith(base.toLowerCase()) && /[\\/]/.test(ruta[base.length] ?? "")) {
    return ruta.slice(base.length + 1);
  }
  return ruta;
}

/** Pestaña de la barra de arriba: lo de la pestaña y, si es una terminal, lo de su shell. */
export function abrirMenuPestana(item: string, panel: string, x: number, y: number) {
  const k = useKyu.getState();
  const it = k.items[item];
  if (!it) return;
  const esp = k.espacios.find((e) => paneles(e.raiz).some((p) => p.id === panel));
  const p = esp ? paneles(esp.raiz).find((q) => q.id === panel) : undefined;
  const hermanas = p?.items ?? [];
  const derecha = hermanas.slice(hermanas.indexOf(item) + 1);

  const elementos: Elemento[] = [];
  if (it.tipo === "terminal") {
    const carpeta = carpetaDeTerminal(item);
    elementos.push(
      opcion(Pencil, "Renombrar", () => window.dispatchEvent(new CustomEvent("kyu-renombrar", { detail: item }))),
      opcion(Palette, "Color e icono…", () => useSelectorEstilo.getState().abrir(item, x, y)),
      opcion(CopyPlus, "Duplicar", () => k.nuevaPestana(it.perfil, panel, carpeta)),
      opcion(RotateCcw, "Reiniciar la terminal", () => {
        const nueva: Item = { id: nuevoId("t"), tipo: "terminal", perfil: it.perfil, titulo: it.perfil, carpeta, ...(it.nombre ? { nombre: it.nombre } : {}), ...(it.color ? { color: it.color } : {}), ...(it.icono ? { icono: it.icono } : {}) };
        destruir(item);
        useKyu.getState().reemplazarItem(item, nueva);
      }),
    );
    if (carpeta) {
      elementos.push(
        separador,
        opcion(Copy, "Copiar la carpeta", () => void writeText(carpeta)),
        opcion(FolderOpen, "Mostrar la carpeta en el Explorador", () => void revealItemInDir(carpeta)),
        opcion(Code, "Abrir la carpeta en VS Code", () => abrirEnVSCode(carpeta)),
      );
    }
  } else if (it.tipo === "archivo") {
    elementos.push(
      opcion(Copy, "Copiar la ruta", () => void writeText(it.ruta)),
      opcion(FolderOpen, "Mostrar en el Explorador", () => void revealItemInDir(it.ruta)),
      opcion(Code, "Abrir en VS Code", () => abrirEnVSCode(it.ruta)),
      opcionMencionar(() => mencionar(it.ruta)),
    );
  }
  if (hermanas.length > 1) {
    elementos.push(
      separador,
      opcion(ArrowRightToLine, "Mover a un panel a la derecha", () => k.moverItem(item, panel, "derecha")),
      opcion(ArrowDownToLine, "Mover a un panel abajo", () => k.moverItem(item, panel, "abajo")),
    );
  }
  elementos.push(
    separador,
    opcion(X, "Cerrar", () => void cerrarItem(item), { atajo: "Ctrl+Mayús+W" }),
    opcion(X, "Cerrar las demás", () => void cerrarVarias(hermanas.filter((i) => i !== item)), { desactivada: hermanas.length < 2 }),
    opcion(X, "Cerrar las de la derecha", () => void cerrarVarias(derecha), { desactivada: !derecha.length }),
  );
  useMenu.getState().abrir({ x, y, elementos: limpiarSeparadores(elementos) });
}

/** Una tras otra: si una pregunta (archivo sin guardar) se espera la respuesta. */
async function cerrarVarias(items: string[]) {
  for (const i of items) await cerrarItem(i);
}

/** «Mencionar a …» con el nombre de quien contesta en la conversación a la que irá. */
function opcionMencionar(hacer: () => void) {
  const agente = agenteDestino(useKyu.getState().activo);
  return opcion(AtSign, `Mencionar a ${nombreAgente({ agente })}`, hacer, agente ? {} : { estilo: "claude" });
}

/** @ruta en la caja de la conversación del espacio (la abre si no hay). */
function mencionar(ruta: string) {
  const espacio = useKyu.getState().activo;
  const cid = irAClaude(espacio);
  if (!cid) return;
  const carpeta = carpetaDeTerminal(useKyu.getState().espacios.find((e) => e.id === espacio)?.foco ?? "") ?? null;
  // La caja puede estar naciendo (conversación nueva): un momento para que escuche.
  setTimeout(() => insertarEnCaja(cid, `${mencionDe(ruta, carpeta)} `), 120);
}

/**
 * Mensaje de Claude. Sobre un bloque de código, lo del bloque (ejecutar o preparar en la
 * terminal que toca, copiar); siempre, lo del mensaje (copiar y volver a este punto).
 */
export function abrirMenuMensaje(cid: string, entrada: number, objetivo: HTMLElement, contenedor: HTMLElement, x: number, y: number) {
  const c = useClaude.getState().conversaciones[cid];
  const e = c?.entradas.find((x) => x.id === entrada);
  if (!c || !e || e.tipo !== "claude") return;
  const elementos: Elemento[] = [];

  const sel = window.getSelection();
  const seleccionado = sel && !sel.isCollapsed && contenedor.contains(sel.anchorNode) ? sel.toString() : "";
  if (seleccionado) elementos.push(opcion(Copy, "Copiar", () => void writeText(seleccionado), { atajo: "Ctrl+C" }), separador);

  const bloque = objetivo.closest<HTMLElement>("[data-codigo]");
  if (bloque) {
    const codigo = bloque.dataset.codigo ?? "";
    const lenguaje = bloque.dataset.lenguaje ?? "";
    elementos.push(cabecera("Bloque de código"));
    if (esDeShell(lenguaje)) {
      const donde = e.texto.indexOf(codigo);
      const destino = destinoDe(lenguaje, donde >= 0 ? e.texto.slice(0, donde) : "") ?? { tipo: "powershell" as const };
      const nombre = nombreDestino(destino);
      elementos.push(
        opcion(Play, `Ejecutar en ${nombre}`, () => void usarCodigo(cid, entrada, codigo, destino, true)),
        opcion(SquareTerminal, `Preparar en ${nombre} (Tab)`, () => void usarCodigo(cid, entrada, codigo, destino, false)),
      );
    }
    elementos.push(opcion(Copy, "Copiar el código", () => void writeText(codigo)), separador);
  }

  // Volver a este punto = a antes del mensaje tuyo que vino después (lo hace su botón ↺).
  const siguiente = c.entradas.find((x) => x.id > entrada && x.tipo === "tu");
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  elementos.push(
    cabecera("Mensaje"),
    opcion(FileText, "Copiar el mensaje", () => void writeText(contenedor.innerText.trim())),
    opcion(Code, "Copiar como Markdown", () => void writeText(e.texto)),
  );
  if (siguiente && siguiente.tipo === "tu" && siguiente.uuid) {
    elementos.push(
      opcion(RotateCcw, "Volver a este punto", () => window.dispatchEvent(new CustomEvent("kyu-volver", { detail: { cid, entrada: siguiente.id } })), {
        desactivada: ocupado,
      }),
    );
  }
  useMenu.getState().abrir({ x, y, elementos: limpiarSeparadores(elementos) });
}

/** Fila del árbol de archivos. `deClaude`: lo ha cambiado Claude en esta conversación. */
export function abrirMenuArbol(
  ruta: string,
  carpeta: boolean,
  raiz: string,
  deClaude: boolean,
  x: number,
  y: number,
  editar: (e: EditarArbol) => void,
) {
  const k = useKyu.getState();
  const cid = useClaude.getState().ultimas[k.activo] ?? null;
  const dirDe = carpeta ? ruta.replace(/[\\/]+$/, "") : ruta.replace(/[\\/][^\\/]*$/, "");
  const perfil = (() => {
    const f = k.espacios.find((e) => e.id === k.activo);
    const panel = f ? paneles(f.raiz).find((p) => p.id === f.foco) : undefined;
    const it = panel?.activo ? k.items[panel.activo] : undefined;
    return it?.tipo === "terminal" ? it.perfil : perfilesConfigurados()[0]?.nombre ?? "";
  })();
  const elementos: Elemento[] = [];
  if (!carpeta) elementos.push(opcion(FileText, "Abrir", () => k.abrirArchivo(ruta, 1, 1)));
  elementos.push(
    opcion(Code, "Abrir en VS Code", () => abrirEnVSCode(ruta)),
    opcion(FolderOpen, "Mostrar en el Explorador", () => void revealItemInDir(ruta)),
  );
  if (!carpeta && deClaude && cid) {
    const quien = nombreAgente(useClaude.getState().conversaciones[cid]);
    elementos.push(opcion(Diff, `Ver lo que cambió ${quien}`, () => void verCambios(cid, ruta)));
  }
  elementos.push(
    opcionMencionar(() => mencionar(carpeta ? `${ruta.replace(/[\\/]+$/, "")}\\` : ruta)),
    separador,
    opcion(Copy, "Copiar la ruta", () => void writeText(ruta)),
    opcion(Copy, "Copiar la ruta relativa", () => void writeText(relativaA(ruta, raiz).replace(/\\/g, "/"))),
    opcion(SquareTerminal, "Abrir una terminal aquí", () => k.nuevaPestana(perfil, undefined, dirDe)),
  );
  elementos.push(
    separador,
    opcion(FilePlus, carpeta ? "Nuevo archivo aquí" : "Nuevo archivo", () => editar({ tipo: "nuevo", ruta: dirDe })),
    opcion(Pencil, "Renombrar", () => editar({ tipo: "renombrar", ruta }), { atajo: "F2" }),
  );
  if (!carpeta) elementos.push(opcion(Trash2, "Borrar", () => void borrarDelArbol(ruta), { estilo: "peligro", atajo: "Supr" }));
  useMenu.getState().abrir({ x, y, elementos: limpiarSeparadores(elementos) });
}

/** Lo que pide el menú al árbol: una caja para el nombre (archivo nuevo en `ruta`, o renombrar `ruta`). */
export interface EditarArbol {
  tipo: "nuevo" | "renombrar";
  ruta: string;
}

/** En VS Code (por su enlace `vscode://file/…`, el mismo que usa el editor). */
export const abrirEnVSCode = (ruta: string) => void openUrl(`vscode://file/${ruta.replace(/\\/g, "/")}`);

export async function borrarDelArbol(ruta: string) {
  const nombre = ruta.split(/[\\/]/).pop();
  const seguro = await ask(`¿Borrar ${nombre}? No va a la papelera.`, {
    title: "Kyu",
    kind: "warning",
    okLabel: "Borrar",
    cancelLabel: "Cancelar",
  });
  if (!seguro) return;
  await borrarArchivo(ruta).catch((e) => window.alert(String(e)));
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

/** Hueco vacío (fondo, barra sin pestaña debajo): lo que se puede abrir. */
export function abrirMenuGeneral(x: number, y: number, perfil: string) {
  const k = useKyu.getState();
  useMenu.getState().abrir({
    x,
    y,
    elementos: [
      opcion(Plus, "Nueva terminal", () => k.nuevaPestana(perfil), { atajo: "Ctrl+Mayús+T" }),
      opcion(Columns2, "Dividir a la derecha", () => k.dividir("horizontal", perfil), { atajo: "Ctrl+Mayús+D" }),
      opcion(Rows2, "Dividir abajo", () => k.dividir("vertical", perfil), { atajo: "Ctrl+Mayús+E" }),
      opcion(Sparkles, "Nueva conversación con Claude", () => nuevaConversacion(k.activo), { atajo: "Ctrl+Mayús+K", estilo: "claude" }),
      opcion(Bot, "Nueva conversación con Antigravity", () => nuevaConversacion(k.activo, "antigravity")),
      opcion(FileSearch, "Visor de archivos", () => k.abrirVisor(carpetaDelEspacio(k.activo))),
      separador,
      opcion(Command, "Paleta de comandos", () => k.ponerPaleta(true), { atajo: "Ctrl+Mayús+P" }),
      opcion(SlidersHorizontal, "Ajustes", () => k.ponerAjustes(true), { atajo: "Ctrl+," }),
    ],
  });
}
