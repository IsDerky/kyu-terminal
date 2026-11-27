// Registro de editores: cada pestaña de archivo tiene aquí su CodeMirror.
// Como los terminales, vive fuera de React para que el texto sin guardar no se pierda
// al dividir o mover un panel. CodeMirror en sí está en editorCodigo.ts, que solo se carga
// al abrir el primer archivo (para no pagar su memoria si no se usa).
import type { EditorView } from "@codemirror/view";
import type { Compartment } from "@codemirror/state";
import { leerArchivo } from "./nucleo";

export interface Editor {
  vista: EditorView;
  elemento: HTMLDivElement;
  ruta: string;
  /** Texto tal como está en disco, para saber si hay cambios. */
  guardado: string;
  error: string | null;
  cargado: Promise<void>;
  lenguaje: string;
  /** Hueco para las marcas de cambios (unifiedMergeView). */
  comparacion: Compartment;
  /** Alias de ssh si el archivo es de un servidor. */
  host?: string;
}

export const editores = new Map<string, Editor>();

/** Fuente y tamaño de los editores (los lee editorCodigo.ts al crear cada uno). */
export const estiloEditores = { fuente: "monospace", tamano: 14 };

export function configurarEditores(familias: string, tam: number) {
  estiloEditores.fuente = familias;
  estiloEditores.tamano = tam;
}

export const editor = (item: string) => editores.get(item);

/** Vuelve a leer del disco los editores de `ruta` que no tengan cambios sin guardar. */
export function recargarRuta(ruta: string) {
  const r = ruta.toLowerCase();
  for (const e of editores.values()) {
    if (e.host || e.ruta.toLowerCase() !== r) continue;
    void e.cargado.then(async () => {
      if (e.vista.state.doc.toString() !== e.guardado) return;
      const texto = await leerArchivo(e.ruta).catch(() => null);
      if (texto === null || texto === e.guardado) return;
      e.guardado = texto;
      e.vista.dispatch({ changes: { from: 0, to: e.vista.state.doc.length, insert: texto } });
    });
  }
}

export function destruirEditor(item: string) {
  const e = editores.get(item);
  if (!e) return;
  editores.delete(item);
  e.vista.destroy();
  e.elemento.remove();
}
