// Órdenes al núcleo en Rust (src-tauri). Un sitio único para los nombres y los tipos.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Tema {
  fuente_tamano: number;
  fondo: string;
  texto: string;
  cursor: string;
  seleccion: string;
  /** 8 normales y 8 brillantes */
  ansi: string[];
}

export interface ConfigVista {
  /** Lista de familias para CSS, la primera que esté instalada gana. */
  fuente: string;
  tema: Tema;
  shell: string;
}

export const leerConfig = () => invoke<ConfigVista>("config");

/** Abre una shell en un PTY; la salida llega a `alRecibir` en bytes crudos. */
export async function abrirPty(
  columnas: number,
  filas: number,
  alRecibir: (datos: Uint8Array) => void,
): Promise<number> {
  const salida = new Channel<ArrayBuffer | number[]>();
  salida.onmessage = (d) => alRecibir(d instanceof ArrayBuffer ? new Uint8Array(d) : Uint8Array.from(d));
  return invoke<number>("pty_abrir", { columnas, filas, salida });
}

export const escribirPty = (id: number, datos: string) => invoke("pty_escribir", { id, datos });

export const redimensionarPty = (id: number, columnas: number, filas: number) =>
  invoke("pty_redimensionar", { id, columnas, filas });

export const cerrarPty = (id: number) => invoke("pty_cerrar", { id });

/** RAM del equipo en uso, en %; null si no se puede leer. */
export const leerRam = () => invoke<number | null>("ram_uso");

/** Avisa cuando la shell `id` termina (el usuario escribió `exit`, se cerró…). */
export const alTerminarPty = (alTerminar: (id: number) => void): Promise<UnlistenFn> =>
  listen<number>("pty:fin", (e) => alTerminar(e.payload));
