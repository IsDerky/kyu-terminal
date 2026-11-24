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

export type Estado = "escribiendo" | "corre" | "ok" | "mal" | "vacio";

export interface Bloque {
  id: number;
  /** Línea del título. */
  inicio: IMarker;
  /** Línea donde quedó el cursor al terminar (la salida acaba en la anterior). */
  fin?: IMarker;
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
}

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
      case "C":
        if (ultimo?.estado === "escribiendo") {
          ultimo.estado = "corre";
          ultimo.tInicio = performance.now();
          this.arrancarReloj();
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
        }
        break;
    }
    this.avisar();
    return true;
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
      if (!this.lista.some((b) => b.estado === "corre")) {
        window.clearInterval(this.reloj);
        this.reloj = undefined;
      }
      this.avisar();
    }, 1000);
  }

  dispose() {
    if (this.reloj !== undefined) window.clearInterval(this.reloj);
    this.oyentes.clear();
  }
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
