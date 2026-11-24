// Crear editores (CodeMirror con sus lenguajes, colores y el diff de cambios de Claude).
// Se carga solo al abrir el primer archivo; el registro está en editores.ts.
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";
import { rust } from "@codemirror/lang-rust";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { unifiedMergeView } from "@codemirror/merge";
import { guardarArchivo, leerArchivo } from "./nucleo";
import { useKyu } from "./estado";
import { editores, estiloEditores, type Editor } from "./editores";

function lenguajeDe(ruta: string): [string, Extension] {
  const ext = ruta.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "rs": return ["Rust", rust()];
    case "ts": return ["TypeScript", javascript({ typescript: true })];
    case "tsx": return ["TypeScript", javascript({ typescript: true, jsx: true })];
    case "js": case "mjs": case "cjs": return ["JavaScript", javascript()];
    case "jsx": return ["JavaScript", javascript({ jsx: true })];
    case "css": return ["CSS", css()];
    case "html": case "htm": return ["HTML", html()];
    case "json": return ["JSON", json()];
    case "md": return ["Markdown", markdown()];
    case "py": return ["Python", python()];
    case "yml": case "yaml": return ["YAML", yaml()];
    default: return ["Texto", []];
  }
}

// Colores del aspecto «Sobrio», los mismos que el terminal.
const resaltado = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier], color: "#c4b5fd" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#86efac" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#55555e", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "#93c5fd" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "#fbbf24" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#fca5a5" },
  { tag: [t.propertyName, t.attributeName], color: "#67e8f9" },
  { tag: [t.heading], color: "#ececf1", fontWeight: "600" },
  { tag: [t.link, t.url], color: "#60a5fa", textDecoration: "underline" },
  { tag: [t.invalid], color: "#f87171" },
]);

const tema = () =>
  EditorView.theme(
    {
      "&": { height: "100%", backgroundColor: "#0b0b0d", color: "#ececf1", fontSize: `${estiloEditores.tamano - 0.5}px` },
      ".cm-scroller": { fontFamily: estiloEditores.fuente, lineHeight: "1.6" },
      ".cm-content": { caretColor: "#4ade80", padding: "6px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#4ade80", borderLeftWidth: "2px" },
      ".cm-gutters": { backgroundColor: "#0b0b0d", color: "#55555e", border: "none" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 10px", minWidth: "44px" },
      ".cm-activeLine": { backgroundColor: "#ffffff06" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#ececf1" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#3b3552 !important" },
      ".cm-matchingBracket": { backgroundColor: "#a78bfa33", outline: "none" },
      ".cm-searchMatch": { backgroundColor: "#fbbf2433", outline: "1px solid #fbbf2477" },
      ".cm-searchMatch-selected": { backgroundColor: "#fbbf24", color: "#1a1200" },
      ".cm-panels": { backgroundColor: "#151518", color: "#ececf1", borderColor: "#2a2a30" },
      ".cm-panels input, .cm-panels button": { fontFamily: "inherit" },
      ".cm-textfield": { backgroundColor: "#0b0b0d", border: "1px solid #2a2a30", borderRadius: "5px", color: "#ececf1" },
      ".cm-button": { backgroundImage: "none", backgroundColor: "#18181c", border: "1px solid #2a2a30", borderRadius: "5px", color: "#ececf1" },
      ".cm-tooltip": { backgroundColor: "#151518", border: "1px solid #2a2a30" },
      ".cm-linea-salto": { backgroundColor: "#a78bfa14", transition: "background-color 1.5s" },
      // Cambios de Claude (unifiedMergeView): verde lo puesto, rojo lo quitado.
      "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": { backgroundColor: "#4ade8012 !important" },
      "&.cm-merge-b .cm-changedText": { background: "#4ade8030 !important", textDecoration: "none" },
      ".cm-deletedChunk": { backgroundColor: "#f8717112 !important", paddingLeft: "0" },
      ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": { background: "#f8717130 !important", textDecoration: "none" },
      ".cm-deletedChunk .cm-deletedLine": { opacity: "0.75" },
      ".cm-changeGutter": { width: "3px", paddingLeft: "0" },
      "&.cm-merge-b .cm-changedLineGutter": { background: "#4ade80" },
      ".cm-deletedLineGutter": { background: "#f87171" },
    },
    { dark: true },
  );

/** Crea (si no existe) el editor de la pestaña `item` y carga el archivo. */
export function obtenerEditor(item: string, ruta: string): Editor {
  const ya = editores.get(item);
  if (ya) return ya;
  const elemento = document.createElement("div");
  elemento.className = "h-full w-full";
  const [nombreLenguaje, lenguaje] = lenguajeDe(ruta);
  const soloLectura = new Compartment();
  const comparacion = new Compartment();

  const guardar = () => {
    const e = editores.get(item);
    if (!e) return true;
    const texto = e.vista.state.doc.toString();
    void guardarArchivo(e.ruta, texto).then(
      () => {
        e.guardado = texto;
        useKyu.getState().marcarSucio(item, false);
        // Guardar da los cambios por revisados.
        useKyu.getState().quitarDiff(item);
      },
      (err) => window.alert(`No se pudo guardar ${e.ruta}: ${err}`),
    );
    return true;
  };

  const vista = new EditorView({
    parent: elemento,
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        keymap.of([{ key: "Mod-s", run: guardar, preventDefault: true }, indentWithTab]),
        lenguaje,
        syntaxHighlighting(resaltado),
        tema(),
        soloLectura.of(EditorState.readOnly.of(true)),
        comparacion.of([]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const e = editores.get(item);
          if (e) useKyu.getState().marcarSucio(item, u.state.doc.toString() !== e.guardado);
        }),
      ],
    }),
  });

  const e: Editor = { vista, elemento, ruta, guardado: "", error: null, cargado: Promise.resolve(), lenguaje: nombreLenguaje, comparacion };
  e.cargado = leerArchivo(ruta).then(
    (texto) => {
      e.guardado = texto;
      vista.dispatch({
        changes: { from: 0, to: vista.state.doc.length, insert: texto },
        effects: soloLectura.reconfigure(EditorState.readOnly.of(false)),
      });
    },
    (err) => {
      e.error = String(err);
    },
  );
  editores.set(item, e);
  return e;
}

/**
 * Marca lo que cambió respecto a `antes` (null = archivo nuevo, todo puesto) o, con
 * undefined, quita las marcas.
 */
export async function ponerDiff(item: string, antes: string | null | undefined) {
  const e = editores.get(item);
  if (!e) return;
  await e.cargado;
  e.vista.dispatch({
    effects: e.comparacion.reconfigure(
      antes === undefined
        ? []
        : unifiedMergeView({ original: antes ?? "", mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true }),
    ),
  });
}

/** Lleva el cursor a `linea:columna` y la centra en pantalla. */
export async function saltar(item: string, linea: number, columna: number) {
  const e = editores.get(item);
  if (!e) return;
  await e.cargado;
  const doc = e.vista.state.doc;
  const l = doc.line(Math.min(Math.max(1, linea), doc.lines));
  const pos = Math.min(l.from + Math.max(0, columna - 1), l.to);
  e.vista.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  e.vista.focus();
}
