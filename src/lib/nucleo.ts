// Órdenes al núcleo en Rust (src-tauri). Un sitio único para los nombres y los tipos.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Ventana } from "./limites";

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
  /** Sugerencia en gris mientras escribes. */
  autocompletado: boolean;
  /** Aviso de Windows al terminar una orden de al menos estos segundos (0 = nunca). */
  aviso_segundos: number;
  /** Al abrir, volver a lo que había la última vez. */
  restaurar_sesion: boolean;
  /** Límite diario de Claude en miles de tokens de salida (0 = sin límite). */
  limite_diario: number;
  /** Nombres de las cuentas de Claude de kyu.toml (vacío = solo la de siempre). */
  cuentas_claude: string[];
  /** Nombres de las cuentas de Antigravity de kyu.toml (vacío = solo la de siempre). */
  cuentas_antigravity: string[];
  /** Respuesta propuesta por Claude tras cada turno. */
  sugerencias_claude: boolean;
  /** Buscar versión nueva al abrir (false en la portable). */
  actualizaciones: boolean;
  portable: boolean;
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

/** Quién escucha en un puerto TCP (null si nadie o no se sabe). */
export const quienEnPuerto = (puerto: number) => invoke<{ pid: number; nombre: string } | null>("puerto_quien", { puerto });
export interface Variable { nombre: string; valor: string }
export interface Entorno {
  proceso: Variable[];
  path: { ruta: string; existe: boolean }[];
  ficheros: { nombre: string; variables: Variable[] }[];
}
/** Variables que heredan las shells y los .env* de `carpeta`. */
export const leerEntorno = (carpeta: string | null) => invoke<Entorno>("entorno_leer", { carpeta });

/** Cierra un proceso (en Windows, con sus hijos). */
export const matarProceso = (pid: number) => invoke<void>("proceso_matar", { pid });

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

export interface AjustesVista {
  ruta: string;
  existe: boolean;
  autocompletado: boolean;
  sin_prompt: boolean;
  aviso_segundos: number;
  restaurar_sesion: boolean;
  perfiles_ssh: boolean;
  limite_diario: number;
  sugerencias_claude: boolean;
  buscar_actualizaciones: boolean;
  portable: boolean;
  version: string;
  fuente: string | null;
  fuente_tamano: number;
  fuentes_conocidas: string[];
  claude: string | null;
  claude_encontrado: string | null;
  perfil_predeterminado: string | null;
  perfiles: { nombre: string; orden: string; color: string | null; icono: string | null }[];
  perfiles_propios: boolean;
}

export const leerAjustes = () => invoke<AjustesVista>("ajustes_leer");

/** Cambia una clave de kyu.toml; null la quita (valor por defecto). */
export const guardarAjuste = (clave: string, valor: unknown) => invoke("ajustes_guardar", { clave, valor: valor ?? null });

export interface EntradaCarpeta {
  nombre: string;
  carpeta: boolean;
}

/** Lo que hay en `carpeta` empezando por `prefijo` (carpetas primero). */
export const listarCarpeta = (carpeta: string, prefijo: string) =>
  invoke<EntradaCarpeta[]>("carpeta_listar", { carpeta, prefijo });

/** Ramas locales y remotas, las de commits más recientes primero. */
export const ramasGit = (carpeta: string) => invoke<string[]>("git_ramas", { carpeta });

// ---------- Claude Code ----------

export type EventoClaude =
  | { tipo: "iniciado"; modelo: string; sesion: string; modo: string }
  | { tipo: "estado"; estado: string | null }
  | { tipo: "compactado"; antes: number; despues: number }
  | { tipo: "parcial"; texto: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "parcialRazonamiento"; texto: string }
  | { tipo: "razonamiento"; texto: string }
  | { tipo: "herramienta"; id: string; nombre: string; resumen: string; ruta: string | null; antes: string | null; nuevo: boolean }
  | { tipo: "subherramienta"; padre: string; nombre: string; resumen: string }
  | { tipo: "eco"; uuid: string }
  | { tipo: "cadena"; uuid: string }
  | { tipo: "resultadoHerramienta"; id: string; error: boolean }
  | { tipo: "permiso"; idPeticion: string; herramienta: string; resumen: string; input: unknown }
  | { tipo: "contexto"; tokens: number; limite?: number }
  | { tipo: "opcionesAgente"; opciones: OpcionAgente[] }
  | { tipo: "comandos"; comandos: { name: string; description: string; argumentHint?: string }[] }
  | { tipo: "mensajeTuyo"; texto: string }
  | { tipo: "cargada" }
  | { tipo: "planAgente"; nombre: string; enlace: string | null }
  | { tipo: "titulo"; texto: string }
  | { tipo: "tareas"; tareas: Tarea[] }
  | { tipo: "tareaNueva"; herramienta: string; texto: string; activo: string | null }
  | { tipo: "tareaId"; herramienta: string; id: string }
  | { tipo: "tareaCambio"; id: string; estado: string | null; texto: string | null; activo: string | null }
  | { tipo: "segundoPlano"; tareas: { id: string; tipo: string; descripcion: string }[] }
  | { tipo: "tareaFondo"; id: string; herramienta: string | null; descripcion: string }
  | { tipo: "tareaFondoFin"; id: string; herramienta: string | null; estado: string; salida: string | null }
  | { tipo: "sugerencia"; texto: string }
  | { tipo: "limite"; estado: string; sesion: Ventana | null; semana: Ventana | null }
  | { tipo: "fin"; coste: number; error: boolean; duracion: number; resultado: string | null }
  | { tipo: "error"; texto: string }
  | { tipo: "cerrado" };

/** Una tarea de la lista del agente (TodoWrite de Claude, plan de ACP). */
export interface Tarea {
  texto: string;
  /** Cómo se dice mientras se hace («Escribiendo la migración»). */
  activo: string | null;
  estado: "pending" | "in_progress" | "completed" | string;
  /** TaskCreate: id que le dio Claude Code y la herramienta que la creó (hasta tener el id). */
  id?: string;
  herramienta?: string;
}

/** Sesión de Claude Code trabajando fuera de Kyu (escribió en su .jsonl hace poco). */
export interface SesionActiva {
  id: string;
  carpeta: string | null;
  titulo: string;
  herramienta: string | null;
  fecha: number;
  cuenta: string;
}

/** Conversación guardada de un agente ACP (session/list). */
export interface SesionAgente {
  id: string;
  titulo: string;
  carpeta: string | null;
  fecha: string | null;
}
export const acpSesiones = (agente: string, carpeta: string) => invoke<SesionAgente[]>("acp_sesiones", { agente, carpeta });
/** Abre una consola con el inicio de sesión del agente. */
export const acpEntrar = (agente: string, cuenta: string | null = null) =>
  invoke("acp_entrar", { agente, cuenta });

/** Regla de permiso guardada de Claude Code. */
export interface ReglaPermiso {
  archivo: string;
  ambito: "usuario" | "proyecto" | "local";
  tipo: "allow" | "ask" | "deny";
  regla: string;
}
export const permisosLeer = (carpeta: string | null) => invoke<ReglaPermiso[]>("permisos_leer", { carpeta });
export const permisosQuitar = (archivo: string, tipo: string, regla: string) => invoke("permisos_quitar", { archivo, tipo, regla });
/** Guarda la conversación en Documentos\Kyu\conversaciones; devuelve la ruta. */
export const exportarConversacion = (nombre: string, contenido: string) => invoke<string>("conversacion_exportar", { nombre, contenido });

/** Sesiones de Claude con actividad en los últimos 2 min, sin las de `excluir` (las de Kyu). */
export const claudeActivas = (excluir: string[]) => invoke<SesionActiva[]>("claude_activas", { excluir });

/** Opción de un agente ACP (modelo, razonamiento, modo…) con su valor actual. */
export interface OpcionAgente {
  id: string;
  nombre: string;
  categoria: string | null;
  actual: string;
  valores: { valor: string; nombre: string; ayuda: string | null }[];
}

/** Lo elegido en el panel antes de arrancar (`--model`, `--permission-mode`, `--effort`). */
export interface OpcionesClaude {
  modelo?: string | null;
  modo?: string | null;
  esfuerzo?: string | null;
  /** Id de una conversación guardada para seguirla (`--resume`). */
  reanudar?: string | null;
  /** Con `reanudar`: solo hasta esta pieza, en una copia (volver a un punto). */
  reanudarEn?: string | null;
  /** Cuenta de kyu.toml (`cuentas_claude`); null = la de siempre. */
  cuenta?: string | null;
  /** Otro agente por ACP («antigravity»); null = Claude Code. */
  agente?: string | null;
  /** ACP: opciones elegidas antes de empezar (id → valor). */
  ajustes?: Record<string, string>;
  /** ACP con `reanudar`: el panel ya tiene la conversación (que no la repita). */
  callado?: boolean;
}

export interface CuentaClaude {
  nombre: string;
  carpeta: string;
  principal: boolean;
  compartir: boolean;
  sesion: boolean;
  correo: string | null;
  plan: string | null;
}

/** Cuentas de kyu.toml con quién ha iniciado sesión en cada una (tarda ~1 s por cuenta). */
export const cuentasClaude = () => invoke<CuentaClaude[]>("claude_cuentas");
/** Abre una consola con `claude auth login` para esa cuenta. */
export const entrarCuenta = (nombre: string) => invoke("claude_cuenta_entrar", { nombre });
export const anadirCuenta = (nombre: string) => invoke("claude_cuenta_anadir", { nombre });
export const quitarCuenta = (nombre: string) => invoke("claude_cuenta_quitar", { nombre });

export interface CuentaAntigravity {
  nombre: string;
  principal: boolean;
  sesion: boolean;
  /** Su sesión es la que está ahora en Windows. */
  activa: boolean;
  /** Hay una conversación de Antigravity abierta con ella. */
  abierta: boolean;
}

export const cuentasAntigravity = () => invoke<CuentaAntigravity[]>("antigravity_cuentas");
export const entrarCuentaAntigravity = (nombre: string) => invoke("antigravity_cuenta_entrar", { nombre });
export const anadirCuentaAntigravity = (nombre: string) => invoke("antigravity_cuenta_anadir", { nombre });
export const quitarCuentaAntigravity = (nombre: string) => invoke("antigravity_cuenta_quitar", { nombre });

/** Imagen para Claude: tipo MIME y datos en base64 (sin el «data:…,» delante). */
export interface ImagenClaude {
  tipo: string;
  datos: string;
}

/** Arranca Claude Code en `carpeta` (null = carpeta personal); devuelve su id. */
export function abrirClaude(
  carpeta: string | null,
  opciones: OpcionesClaude,
  alEvento: (e: EventoClaude) => void,
): Promise<number> {
  const eventos = new Channel<EventoClaude>();
  eventos.onmessage = alEvento;
  return invoke<number>("claude_abrir", { carpeta, opciones, eventos });
}

/** Cambia una opción de un agente ACP (model, thought_level, mode…). */
export const opcionAgente = (id: number, clave: string, valor: string) => invoke("claude_opcion", { id, clave, valor });

export const enviarClaude = (id: number, texto: string, imagenes: ImagenClaude[] = []) =>
  invoke("claude_enviar", { id, texto, imagenes });

export interface SesionGuardada {
  id: string;
  titulo: string;
  /** Lo último que escribió el usuario. */
  ultimo: string | null;
  /** ms desde 1970 */
  fecha: number;
  bytes: number;
}

/** Conversaciones guardadas de Claude Code en `carpeta`, la más reciente primero. */
export const sesionesClaude = (carpeta: string) => invoke<SesionGuardada[]>("claude_sesiones", { carpeta });

export type Pasado =
  | { tipo: "tu"; texto: string; uuid: string | null; previo: string | null }
  | { tipo: "claude"; texto: string }
  | { tipo: "herramienta"; id: string; nombre: string; resumen: string; error: boolean }
  | { tipo: "aviso"; texto: string }
  | { tipo: "cadena"; uuid: string };

/** Lo que se ve de una conversación guardada (sus últimas 400 piezas). */
export const historialClaude = (carpeta: string, id: string) => invoke<Pasado[]>("claude_historial", { carpeta, id });

/** Archivos y carpetas (las carpetas acaban en «/») de `carpeta` que encajan con `consulta`. */
export const buscarArchivos = (carpeta: string, consulta: string) =>
  invoke<string[]>("archivos_buscar", { carpeta, consulta });

/** Orden de control de stream-json (`{subtype: "initialize"}`…); devuelve su `response`. */
export const controlClaude = <T = unknown>(id: number, peticion: Record<string, unknown>) =>
  invoke<T>("claude_control", { id, peticion });

/** Al denegar, `mensaje` le dice a Claude qué hacer en su lugar; al permitir, `modo` cambia
 *  también el modo de permisos (aprobar un plan). */
export const responderClaude = (
  id: number,
  idPeticion: string,
  respuesta: "permitir" | "siempre" | "denegar",
  mensaje?: string,
  modo?: string,
  respuestas?: Record<string, string>,
) => invoke("claude_responder", { id, idPeticion, respuesta, mensaje: mensaje ?? null, modo: modo ?? null, respuestas: respuestas ?? null });

export const pararClaude = (id: number) => invoke("claude_parar", { id });

export interface NodoArbol {
  nombre: string;
  ruta: string;
  carpeta: boolean;
}

/** Lo que hay en `carpeta` (sin bajar), respetando .gitignore: carpetas primero. */
export const arbolListar = (carpeta: string) => invoke<NodoArbol[]>("arbol_listar", { carpeta });

/** Archivos con cambios en git del repositorio de `carpeta`: ruta absoluta → M, A, D, R o ?. */
export const gitEstado = (carpeta: string) => invoke<Record<string, string>>("git_estado", { carpeta });

export const borrarArchivo = (ruta: string) => invoke("archivo_borrar", { ruta });

export const cerrarClaude = (id: number) => invoke("claude_cerrar", { id });

export const cerrarTodasClaude = () => invoke("claude_cerrar_todas");
