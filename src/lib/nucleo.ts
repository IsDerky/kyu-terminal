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

export interface Perfil {
  nombre: string;
  /** #rrggbb */
  color: string;
  /** powershell, bash, linux, cmd, servidor, terminal */
  icono: string;
}

export interface ConfigVista {
  /** Lista de familias para CSS, la primera que esté instalada gana. */
  fuente: string;
  tema: Tema;
  /** El primero es el predeterminado. */
  perfiles: Perfil[];
}

export const leerConfig = () => invoke<ConfigVista>("config");

/** Abre una shell del perfil en un PTY; la salida llega a `alRecibir` en bytes crudos. */
export async function abrirPty(
  perfil: string,
  carpeta: string | null,
  columnas: number,
  filas: number,
  alRecibir: (datos: Uint8Array) => void,
): Promise<number> {
  const salida = new Channel<ArrayBuffer | number[]>();
  salida.onmessage = (d) => alRecibir(d instanceof ArrayBuffer ? new Uint8Array(d) : Uint8Array.from(d));
  return invoke<number>("pty_abrir", { perfil, carpeta, columnas, filas, salida });
}

export const escribirPty = (id: number, datos: string) => invoke("pty_escribir", { id, datos });

export const redimensionarPty = (id: number, columnas: number, filas: number) =>
  invoke("pty_redimensionar", { id, columnas, filas });

export const cerrarPty = (id: number) => invoke("pty_cerrar", { id });

/** Al arrancar la ventana: cierra las shells que quedaran de antes de recargarla. */
export const cerrarTodasPty = () => invoke("pty_cerrar_todas");

/** Carpeta actual de la shell (solo si su prompt la apunta: PowerShell con el prompt de Kyu). */
export const carpetaPty = (id: number) => invoke<string | null>("pty_carpeta", { id });

/** Avisa cuando la shell `id` termina (el usuario escribió `exit`, se cerró…). */
export const alTerminarPty = (alTerminar: (id: number) => void): Promise<UnlistenFn> =>
  listen<number>("pty:fin", (e) => alTerminar(e.payload));

export interface Ram {
  /** bytes */
  usada: number;
  total: number;
}

/** RAM del equipo; null si no se puede leer. */
export const leerRam = () => invoke<Ram | null>("ram_uso");

/** Ruta absoluta si existe el archivo (las relativas, desde `base`). */
export const resolverArchivo = (ruta: string, base: string | null) =>
  invoke<string | null>("archivo_resolver", { ruta, base });

export const leerArchivo = (ruta: string) => invoke<string>("archivo_leer", { ruta });

export const guardarArchivo = (ruta: string, contenido: string) =>
  invoke("archivo_guardar", { ruta, contenido });

// ---------- Claude Code ----------

export type EventoClaude =
  | { tipo: "iniciado"; modelo: string; sesion: string }
  | { tipo: "parcial"; texto: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "herramienta"; id: string; nombre: string; resumen: string }
  | { tipo: "resultadoHerramienta"; id: string; error: boolean }
  | { tipo: "permiso"; idPeticion: string; herramienta: string; resumen: string; input: unknown }
  | { tipo: "contexto"; tokens: number }
  | { tipo: "fin"; coste: number; error: boolean; duracion: number }
  | { tipo: "error"; texto: string }
  | { tipo: "cerrado" };

/** Arranca Claude Code en `carpeta` (null = carpeta personal); devuelve su id. */
export function abrirClaude(carpeta: string | null, alEvento: (e: EventoClaude) => void): Promise<number> {
  const eventos = new Channel<EventoClaude>();
  eventos.onmessage = alEvento;
  return invoke<number>("claude_abrir", { carpeta, eventos });
}

export const enviarClaude = (id: number, texto: string) => invoke("claude_enviar", { id, texto });

/** Al denegar, `mensaje` le dice a Claude qué hacer en su lugar. */
export const responderClaude = (
  id: number,
  idPeticion: string,
  respuesta: "permitir" | "siempre" | "denegar",
  mensaje?: string,
) => invoke("claude_responder", { id, idPeticion, respuesta, mensaje: mensaje ?? null });

export const pararClaude = (id: number) => invoke("claude_parar", { id });

export const cerrarClaude = (id: number) => invoke("claude_cerrar", { id });

export const cerrarTodasClaude = () => invoke("claude_cerrar_todas");
