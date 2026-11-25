// Bloques: cada orden con su título, resultado y duración.
//
// La shell marca los bloques con OSC 133 (el estándar de «shell integration»):
//   A = empieza el prompt (aquí va el título), B = empieza lo que escribes,
//   C = la orden empieza a ejecutarse, D;código = la orden ha terminado
//   (con «;kyu-dur=ms» si la shell sabe lo que tardó).
// Además manda OSC 7701 con un JSON: carpeta, rama y cambios de git.
// La hora y lo que tarda la orden las mide Kyu; la RAM la da el núcleo.
import type { IMarker, Terminal } from "@xterm/xterm";
import { leerRam, type Ram } from "./nucleo";
import { leerProblemas, type Problema } from "./problemas";

export type Estado = "escribiendo" | "corre" | "ok" | "mal" | "vacio";

export interface Bloque {
  id: number;
  /** Línea del título. */
  inicio: IMarker;
  /** Línea donde quedó el cursor al terminar (la salida acaba en la anterior). */
  fin?: IMarker;
  /** Dónde empieza lo que escribes (marca B): línea y columna. */
  entrada?: { marca: IMarker; x: number };
  /** La orden tal como se ejecutó (se lee al llegar C). */
  orden?: string;
  /** Carpeta completa donde se ejecutó (si la shell la manda). */
  ruta: string | null;
  padre: string;
  hoja: string;
  rama: string | null;
  cambios: number;
  ram: Ram | null;
  hora: string;
  estado: Estado;
  tInicio?: number;
  durMs?: number;
  codigo?: number;
  /** Direcciones locales que han salido en la salida (servidores de desarrollo). */
  locales?: string[];
  /** Puerto que la orden no pudo usar porque ya estaba ocupado (EADDRINUSE y parecidos). */
  ocupado?: number;
  /** Lo que ya se avisó mientras corría (una vez por tipo). */
  vigilado?: Set<Vigia>;
  /** Errores y avisos de compiladores y linters que salieron (al acabar). */
  problemas?: Problema[];
}

export type Vigia = "listo" | "error";

interface DatosShell {
  ruta?: string;
  padre?: string;
  hoja?: string;
  rama?: string | null;
  cambios?: number;
}

const horaAhora = () =>
  new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

export class Bloques {
  lista: Bloque[] = [];
  private siguiente = 0;
  private versionActual = 0;
  private oyentes = new Set<() => void>();
  private reloj: number | undefined;

  /** Se llama en cada prompt con la carpeta actual de la shell. */
  alCambiarCarpeta: ((ruta: string, hoja: string) => void) | null = null;
  /** Se llama cuando termina una orden (para el historial de Kyu). */
  alTerminarOrden: ((b: Bloque) => void) | null = null;
  /** Empieza a correr una orden / acaba (también sin orden leída). Para la pestaña. */
  alEmpezar: ((b: Bloque) => void) | null = null;
  alAcabar: ((b: Bloque) => void) | null = null;
  /** Mientras corre, la salida dice que ya está listo o que algo ha fallado (una vez por tipo). */
  alVer: ((b: Bloque, tipo: Vigia, linea: string) => void) | null = null;

  constructor(private term: Terminal) {
    term.parser.registerOscHandler(133, (d) => this.marca(d));
    term.parser.registerOscHandler(7701, (d) => this.datos(d));
    // cls / clear borran también el historial (CSI 3J): los bloques de antes ya no
    // existen. Solo «borrar pantalla» (CSI 2J) no cuenta: ConPTY lo manda al cambiar
    // de tamaño para repintar, y los bloques siguen ahí.
    // Se devuelve false para que xterm borre igualmente.
    term.parser.registerCsiHandler({ final: "J" }, (params) => {
      if (params[0] === 3) this.vaciar();
      return false;
    });
  }

  private vaciar() {
    const viejos = this.lista;
    this.lista = [];
    viejos.forEach((b) => {
      b.inicio.dispose();
      b.fin?.dispose();
    });
    this.avisar();
  }

  suscribir = (oyente: () => void) => {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  };

  version = () => this.versionActual;

  private avisar() {
    this.versionActual++;
    this.oyentes.forEach((o) => o());
  }

  private get ultimo(): Bloque | undefined {
    return this.lista[this.lista.length - 1];
  }

  private marca(datos: string): boolean {
    const [tipo, arg, ...extra] = datos.split(";");
    const ultimo = this.ultimo;
    switch (tipo) {
      case "A": {
        // Un prompt que se abandonó (Intro vacío, Ctrl+C) queda como bloque vacío.
        if (ultimo?.estado === "escribiendo") ultimo.estado = "vacio";
        const inicio = this.term.registerMarker(0);
        if (!inicio) return true;
        const bloque: Bloque = {
          id: this.siguiente++,
          inicio,
          ruta: null,
          padre: "",
          hoja: "",
          rama: null,
          cambios: 0,
          ram: null,
          hora: horaAhora(),
          estado: "escribiendo",
        };
        inicio.onDispose(() => {
          this.lista = this.lista.filter((b) => b !== bloque);
          this.avisar();
        });
        this.lista.push(bloque);
        void leerRam().then((r) => {
          if (!r || r.total === 0) return;
          bloque.ram = r;
          this.avisar();
        });
        break;
      }
      case "B":
        if (ultimo?.estado === "escribiendo" && !ultimo.entrada) {
          const marca = this.term.registerMarker(0);
          if (marca) ultimo.entrada = { marca, x: this.term.buffer.active.cursorX };
        }
        break;
      case "C":
        if (ultimo?.estado === "escribiendo") {
          ultimo.orden = this.leerEntrada(ultimo)?.trim() || undefined;
          ultimo.estado = "corre";
          ultimo.tInicio = performance.now();
          this.arrancarReloj();
          this.alEmpezar?.(ultimo);
        }
        break;
      case "D":
        if (ultimo?.estado === "corre") {
          const codigo = Number(arg ?? 0) || 0;
          ultimo.codigo = codigo;
          ultimo.estado = codigo === 0 ? "ok" : "mal";
          // La shell sabe lo que tardó de verdad; si no lo manda, vale lo medido aquí
          // (que incluye lo que tarda el prompt siguiente en aparecer).
          const dur = extra.find((e) => e.startsWith("kyu-dur="));
          ultimo.durMs = dur
            ? Number(dur.slice(8))
            : performance.now() - (ultimo.tInicio ?? performance.now());
          ultimo.fin = this.term.registerMarker(0);
          ultimo.locales = undefined;
          const salida = this.textoSalida(ultimo);
          ultimo.ocupado = codigo !== 0 ? puertoOcupado(salida) ?? undefined : undefined;
          const problemas = leerProblemas(salida);
          ultimo.problemas = problemas.length ? problemas : undefined;
          if (ultimo.orden) this.alTerminarOrden?.(ultimo);
          this.alAcabar?.(ultimo);
        }
        break;
    }
    this.avisar();
    return true;
  }

  /**
   * Lo escrito desde la marca B: hasta el cursor (`hastaCursor`) o, si no, la línea
   * entera con sus continuaciones. null si no hay marca.
   */
  private leerEntrada(b: Bloque, hastaCursor = false): string | null {
    if (!b.entrada || b.entrada.marca.line < 0) return null;
    const buf = this.term.buffer.active;
    const y0 = b.entrada.marca.line;
    const yC = buf.baseY + buf.cursorY;
    let texto = "";
    for (let y = y0; ; y++) {
      const l = buf.getLine(y);
      if (!l) break;
      if (y > y0 && !l.isWrapped && !(hastaCursor && y <= yC)) break;
      const desde = y === y0 ? b.entrada.x : 0;
      const hasta = hastaCursor && y === yC ? buf.cursorX : undefined;
      texto += l.translateToString(!hastaCursor || y !== yC, desde, hasta);
      if (hastaCursor && y >= yC) break;
    }
    return texto;
  }

  /**
   * Lo que se está escribiendo ahora, si el cursor está al final (sin nada escrito
   * detrás). null si no hay prompt esperando o se está editando por en medio.
   */
  entradaActual(): string | null {
    const b = this.ultimo;
    if (!b || b.estado !== "escribiendo" || !b.entrada) return null;
    const buf = this.term.buffer.active;
    if (buf.type !== "normal") return null;
    const yC = buf.baseY + buf.cursorY;
    if (yC < b.entrada.marca.line) return null;
    // Detrás del cursor no puede haber texto (en esa línea ni en continuaciones).
    const linea = buf.getLine(yC);
    // (Espacios sí: PSReadLine los escribe de verdad para borrar, y xterm solo recorta
    // las celdas vacías.)
    if (linea && linea.translateToString(true, buf.cursorX).trim().length > 0) return null;
    const sig = buf.getLine(yC + 1);
    if (sig?.isWrapped && sig.translateToString(true).trim().length > 0) return null;
    return this.leerEntrada(b, true);
  }

  private datos(json: string): boolean {
    const ultimo = this.ultimo;
    if (!ultimo) return true;
    try {
      const d = JSON.parse(json) as DatosShell;
      ultimo.ruta = d.ruta ?? null;
      ultimo.padre = d.padre ?? "";
      ultimo.hoja = d.hoja ?? "";
      ultimo.rama = d.rama || null;
      ultimo.cambios = d.cambios ?? 0;
      if (d.ruta) this.alCambiarCarpeta?.(d.ruta, ultimo.hoja);
      this.avisar();
    } catch {
      // Datos mal formados: el título sale sin carpeta, no se rompe nada.
    }
    return true;
  }

  /** Mientras alguna orden corre, refresca cada segundo para que avance «ejecutando · N s». */
  private arrancarReloj() {
    if (this.reloj !== undefined) return;
    this.reloj = window.setInterval(() => {
      this.lista.forEach((b) => b.estado === "corre" && this.buscarLocales(b));
      if (!this.lista.some((b) => b.estado === "corre")) {
        window.clearInterval(this.reloj);
        this.reloj = undefined;
      }
      this.avisar();
    }, 1000);
  }

  /** Las últimas 400 filas de salida del bloque, con las líneas partidas ya unidas. */
  private textoSalida(b: Bloque): string {
    if (b.inicio.line < 0) return "";
    const buf = this.term.buffer.normal;
    const hasta = b.fin && b.fin.line >= 0 ? b.fin.line : buf.baseY + buf.cursorY + 1;
    const desde = Math.max(b.inicio.line + 2, hasta - 400);
    let texto = "";
    for (let y = desde; y < hasta; y++) {
      const l = buf.getLine(y);
      if (l) texto += (l.isWrapped ? "" : "\n") + l.translateToString(true);
    }
    return texto;
  }

  /** Mientras corre: direcciones locales con puerto y, si sale, el puerto ocupado. */
  private buscarLocales(b: Bloque) {
    const texto = this.textoSalida(b);
    const nuevas = direccionesLocales(texto);
    if (nuevas.join() !== (b.locales ?? []).join()) b.locales = nuevas.length ? nuevas : undefined;
    b.ocupado = puertoOcupado(texto) ?? undefined;
    // Lo de los primeros 3 s no se avisa: si acaba enseguida, ya avisa el final.
    if (this.alVer && b.tInicio !== undefined && performance.now() - b.tInicio > 3000) {
      for (const [tipo, linea] of vigilar(texto)) {
        if (b.vigilado?.has(tipo)) continue;
        (b.vigilado ??= new Set()).add(tipo);
        this.alVer(b, tipo, linea);
      }
    }
  }

  dispose() {
    if (this.reloj !== undefined) window.clearInterval(this.reloj);
    this.oyentes.clear();
  }
}

// http(s)://localhost:3000/…, 127.0.0.1, 0.0.0.0, [::1], [::] y también «localhost:3000» sin esquema.
const LOCAL = /(?<![\w.@-])(?:(https?):\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d{2,5}))(\/[^\s'"<>()`]*)?/gi;

/**
 * Direcciones locales con puerto de un texto, listas para abrir en el navegador: sin
 * repetir puerto (la primera gana), con 0.0.0.0 y [::] cambiados por localhost.
 */
export function direccionesLocales(texto: string): string[] {
  const vistos = new Map<string, string>();
  for (const m of texto.matchAll(LOCAL)) {
    const [, esquema, host, puerto, ruta] = m;
    if (!puerto || Number(puerto) > 65535) continue;
    const anfitrion = /^(0\.0\.0\.0|\[::\])$/.test(host) ? "localhost" : host.toLowerCase();
    const clave = puerto;
    if (vistos.has(clave)) continue;
    // Sin esquema solo vale si va suelto (no «user@localhost:22» ni dentro de otra palabra).
    if (!esquema && /[@\w.-]$/.test(texto.slice(Math.max(0, m.index - 1), m.index))) continue;
    vistos.set(clave, `${esquema?.toLowerCase() ?? "http"}://${anfitrion}:${puerto}${(ruta ?? "/").replace(/[.,;:]+$/, "")}`);
  }
  return [...vistos.values()].slice(0, 3);
}

// Cómo dicen los programas que el puerto está cogido (el número, en el primer grupo).
const OCUPADO = [
  /EADDRINUSE\b[^\n]*?[:\s](\d{2,5})\b/, // Node: listen EADDRINUSE: address already in use :::3000
  /:(\d{2,5}):?\s*bind: address already in use/i, // Go: listen tcp :8080: bind: address already in use
  /address already in use[^\n]*?(?:port\s+|[:\s])(\d{2,5})\b/i, // Python, uvicorn, Rust…
  /\bport (\d{2,5}) is (?:already )?in use/i, // Next, Vite, Astro, Angular
  /(?:puerto|port) (\d{2,5})[^\n]*(?:ya está en uso|already in use|ocupado)/i,
];

/** El puerto que una salida dice que está ocupado, o null. */
export function puertoOcupado(texto: string): number | null {
  for (const re of OCUPADO) {
    const m = texto.match(re);
    const n = m ? Number(m[1]) : 0;
    if (n > 0 && n <= 65535) return n;
  }
  return null;
}

// Frases de «ya está» de los servidores y herramientas de desarrollo más comunes.
const LISTO = /\b(ready\b|compiled successfully|compiled\b.*\bin \d|listening (?:on|at)\b|server (?:is )?(?:running|started|listening)|running on https?:\/\/|local:\s+https?:\/\/|watching for (?:file )?changes|started server on)/i;
// Errores de verdad (no «0 errors» ni «no errors found»): «error:», «error TS2322:»,
// «error[E0308]:», «npm ERR!», FAILED, panics, trazas de Python…
const ERROR = /(?:^|\s)(?:error(?:\s?[A-Z]+\d+|\[\w+\])?[:!]|err!)|\bFAILED\b|\bfailed to\b|panicked at|Traceback \(most recent call last\)|Unhandled (?:exception|rejection)|\bFATAL\b/i;
const NO_ERROR = /\b(?:0|no) errors?\b/i;

/** Primera línea de «listo» y de «error» que haya en el texto. */
export function vigilar(texto: string): [Vigia, string][] {
  const r: [Vigia, string][] = [];
  const lineas = texto.split("\n");
  const listo = lineas.find((l) => LISTO.test(l));
  if (listo) r.push(["listo", listo.trim()]);
  const error = lineas.find((l) => ERROR.test(l) && !NO_ERROR.test(l));
  if (error) r.push(["error", error.trim()]);
  return r;
}

/** Lo que se le manda a Claude de un bloque terminado. */
export interface TextoBloque {
  orden: string;
  salida: string;
  /** Líneas de salida que había (aunque se recorte). */
  lineas: number;
  recortada: boolean;
  codigo: number;
  ruta: string | null;
}

const MAX_LINEAS = 300;
const MAX_CARACTERES = 24_000;

/**
 * La orden y su salida, leídas del buffer de xterm. Debajo del título va la línea de la
 * orden (dos espacios + lo que escribiste, que puede ocupar varias filas) y luego la
 * salida hasta donde quedó el cursor al terminar. null si el bloque no ha terminado o
 * ya no está en el historial.
 */
/** El título de un bloque en texto: «Aleks ~\Documents (main ±2)». */
export function tituloEnTexto(b: Bloque) {
  const rama = b.rama ? ` (${b.rama}${b.cambios > 0 ? ` ±${b.cambios}` : ""})` : "";
  return `${b.hoja || "…"}${b.padre ? ` ${b.padre.replace(/[\\/]$/, "")}` : ""}${rama}`;
}

/**
 * Lo seleccionado en el terminal tal como se ve: el título de cada bloque (que es una capa
 * encima, en la línea en blanco que deja el prompt) y la flecha «›» delante de cada orden.
 * Sin bloques en la selección es lo mismo que `term.getSelection()`.
 */
export function textoSeleccion(term: Terminal, bloques: Bloques): string {
  const pos = term.getSelectionPosition();
  const buf = term.buffer.active;
  if (!pos || buf.type !== "normal") return term.getSelection();
  const titulos = new Map<number, Bloque>();
  const prompts = new Map<number, number>();
  for (const b of bloques.lista) {
    if (b.inicio.line >= 0) titulos.set(b.inicio.line, b);
    if (b.entrada && b.entrada.marca.line >= 0) prompts.set(b.entrada.marca.line, b.entrada.x);
  }
  const lineas: string[] = [];
  for (let y = pos.start.y; y <= pos.end.y; y++) {
    const l = buf.getLine(y);
    if (!l) continue;
    const desde = y === pos.start.y ? pos.start.x : 0;
    const hasta = y === pos.end.y ? pos.end.x : undefined;
    let t = l.translateToString(true, desde, hasta);
    const b = titulos.get(y);
    if (b && !t.trim()) t = tituloEnTexto(b);
    const x = prompts.get(y);
    // Los espacios donde Kyu pinta la flecha pasan a «› ».
    if (x !== undefined && desde < x && !l.translateToString(false, 0, x).trim()) {
      t = `› ${l.translateToString(true, x, hasta)}`;
    }
    if (l.isWrapped && lineas.length) lineas[lineas.length - 1] += t;
    else lineas.push(t);
  }
  return lineas.join("\n");
}

export function textoBloque(term: Terminal, b: Bloque): TextoBloque | null {
  if ((b.estado !== "ok" && b.estado !== "mal") || !b.fin || b.inicio.line < 0 || b.fin.line < 0) return null;
  const buf = term.buffer.normal;
  const filas: { texto: string; seguida: boolean }[] = [];
  for (let y = b.inicio.line + 1; y < b.fin.line; y++) {
    const l = buf.getLine(y);
    if (l) filas.push({ texto: l.translateToString(true), seguida: l.isWrapped });
  }
  // Une las filas partidas por el ancho del terminal en líneas lógicas.
  const lineas: string[] = [];
  for (const f of filas) {
    if (f.seguida && lineas.length) lineas[lineas.length - 1] += f.texto;
    else lineas.push(f.texto);
  }
  const orden = (lineas.shift() ?? "").trim();
  while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop();
  const total = lineas.length;
  let salida = lineas.slice(-MAX_LINEAS).join("\n");
  if (salida.length > MAX_CARACTERES) salida = salida.slice(-MAX_CARACTERES);
  return {
    orden,
    salida,
    lineas: total,
    recortada: total > MAX_LINEAS || salida.length >= MAX_CARACTERES,
    codigo: b.codigo ?? 0,
    ruta: b.ruta,
  };
}

/** «56 % 17,9/31,9 GB» */
export function textoRam({ usada, total }: Ram): string {
  const gb = (b: number) => (b / 1024 ** 3).toFixed(1).replace(".", ",");
  return `${Math.round((usada / total) * 100)} % ${gb(usada)}/${gb(total)} GB`;
}

/** 0,2 s · 1 min 12 s · 1 h 3 min (como el prompt antiguo). */
export function duracion(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace(".", ",")} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${Math.floor(s % 60)} s`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
