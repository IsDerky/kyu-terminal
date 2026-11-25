// Autocompletado propio de Kyu: una sugerencia en gris detrás del cursor, sin menú.
//   Tab    acepta la sugerencia entera        Ctrl+→  palabra a palabra
//   ↓ / ↑  siguiente / anterior sugerencia    Esc     la quita
// Por orden: lo del historial usado en esta carpeta; luego lo que sale de aquí (scripts
// del package.json, ramas, carpetas y archivos de la última palabra), y al final el resto
// del historial (otras carpetas o importado), que puede no tener sentido aquí.
// Lo que se escribe lo sabe Kyu por la marca B del prompt (ver bloques.ts).
import type { Terminal } from "@xterm/xterm";
import type { Bloques } from "./bloques";
import { buscarEnHistorial } from "./historial";
import { leerArchivo, listarCarpeta, ramasGit } from "./nucleo";

const CACHE_MS = 5000;
const cache = new Map<string, { t: number; valor: Promise<unknown> }>();

/** Guarda unos segundos lo que cuesta pedir (carpetas, ramas, package.json). */
function conCache<T>(clave: string, pedir: () => Promise<T>): Promise<T> {
  const ya = cache.get(clave);
  if (ya && Date.now() - ya.t < CACHE_MS) return ya.valor as Promise<T>;
  const valor = pedir().catch(() => [] as unknown as T);
  cache.set(clave, { t: Date.now(), valor });
  return valor;
}

const unir = (carpeta: string, rel: string) =>
  rel ? `${carpeta.replace(/[\\/]+$/, "")}${carpeta.includes("/") && !carpeta.includes("\\") ? "/" : "\\"}${rel}` : carpeta;

async function scripts(carpeta: string): Promise<string[]> {
  return conCache(`scripts:${carpeta}`, async () => {
    const json = JSON.parse(await leerArchivo(unir(carpeta, "package.json"))) as { scripts?: Record<string, string> };
    return Object.keys(json.scripts ?? {});
  });
}

const RE_SCRIPT = /^(?:pnpm(?: run)?|npm run|yarn(?: run)?|bun run)\s+(\S*)$/;
const RE_RAMA = /^git\s+(?:checkout|switch|merge|rebase|diff|log|branch\s+-[dDm]|push\s+\S+|pull\s+\S+|cherry-pick)\s+(?:-\S+\s+)*(\S*)$/;
const RE_SOLO_CARPETAS = /^(?:cd|pushd|Set-Location|sl|z)\s/i;

/** Todas las sugerencias para `texto` (líneas completas que empiezan por él), sin repetir. */
export async function sugerir(texto: string, carpeta: string | null, bash: boolean): Promise<string[]> {
  if (!texto.trim()) return [];
  const salida: string[] = [];
  const poner = (s: string) => {
    if (s.length > texto.length && s.startsWith(texto) && !salida.includes(s)) salida.push(s);
  };
  const historial = buscarEnHistorial(texto, carpeta);
  historial.filter((h) => h.aqui).forEach((h) => poner(h.o));
  const resto = () => historial.filter((h) => !h.aqui).forEach((h) => poner(h.o));
  if (!carpeta) return (resto(), salida);

  const script = RE_SCRIPT.exec(texto);
  if (script) {
    const base = texto.slice(0, texto.length - script[1].length);
    (await scripts(carpeta)).filter((s) => s.startsWith(script[1])).forEach((s) => poner(base + s));
  }
  const rama = RE_RAMA.exec(texto);
  if (rama) {
    const base = texto.slice(0, texto.length - rama[1].length);
    const ramas = await conCache(`ramas:${carpeta}`, () => ramasGit(carpeta));
    ramas.filter((r) => r.startsWith(rama[1])).forEach((r) => poner(base + r));
  }

  // Carpetas y archivos de la última palabra (si ya hay una orden delante).
  const corte = texto.lastIndexOf(" ");
  if (corte > 0) {
    const palabra = texto.slice(corte + 1);
    if (!palabra.startsWith("-") && !palabra.includes("$") && !/^["']/.test(palabra)) {
      const barra = Math.max(palabra.lastIndexOf("/"), palabra.lastIndexOf("\\"));
      const dir = barra >= 0 ? palabra.slice(0, barra + 1) : "";
      const prefijo = palabra.slice(barra + 1);
      const absoluta = /^([a-zA-Z]:[\\/]|[\\/]|~)/.test(dir);
      if (!absoluta && (prefijo || dir)) {
        const dondeRel = dir.replace(/[\\/]+$/, "").replace(/\//g, carpeta.includes("\\") ? "\\" : "/");
        const donde = dondeRel ? unir(carpeta, dondeRel) : carpeta;
        const entradas = await conCache(`dir:${donde}:${prefijo.toLowerCase()}`, () => listarCarpeta(donde, prefijo));
        const soloCarpetas = RE_SOLO_CARPETAS.test(texto);
        const sep = dir.includes("/") || bash ? "/" : "\\";
        for (const e of entradas) {
          if (soloCarpetas && !e.carpeta) continue;
          if (e.nombre.includes(" ")) continue; // haría falta comillas delante
          // Lo escrito puede diferir en mayúsculas: solo vale si empieza igual.
          if (!e.nombre.startsWith(prefijo)) continue;
          poner(texto.slice(0, corte + 1) + dir + e.nombre + (e.carpeta ? sep : ""));
        }
      }
    }
  }
  resto();
  return salida;
}

export interface Fantasma {
  /** Lo que falta por escribir (lo que se pinta en gris). */
  resto: string;
  indice: number;
  total: number;
}

/** Una por terminal: sigue lo que se escribe, pide sugerencias y atiende las teclas. */
export class Autocompletado {
  private texto: string | null = null;
  private opciones: string[] = [];
  private indice = 0;
  /** Texto para el que se pulsó Esc: no se sugiere nada hasta que cambie. */
  private oculto: string | null = null;
  private peticion = 0;
  private cuadro = 0;
  private versionActual = 0;
  private oyentes = new Set<() => void>();

  constructor(
    term: Terminal,
    private bloques: Bloques,
    private carpeta: () => string | null,
    private bash: () => boolean,
    private escribir: (datos: string) => void,
  ) {
    const mirar = () => {
      cancelAnimationFrame(this.cuadro);
      this.cuadro = requestAnimationFrame(() => this.revisar());
    };
    term.onRender(mirar);
    term.onCursorMove(mirar);
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

  fantasma(): Fantasma | null {
    const texto = this.texto;
    const opcion = this.opciones[this.indice];
    if (texto === null || !opcion || this.oculto === texto) return null;
    return { resto: opcion.slice(texto.length), indice: this.indice, total: this.opciones.length };
  }

  private revisar() {
    const texto = this.bloques.entradaActual();
    if (texto === this.texto) return;
    this.texto = texto;
    if (this.oculto !== null && this.oculto !== texto) this.oculto = null;
    // Mientras llegan las nuevas, vale la que sigue encajando con lo escrito.
    const sigue = texto !== null && this.opciones[this.indice]?.startsWith(texto) ? this.opciones[this.indice] : null;
    this.opciones = sigue && sigue.length > (texto?.length ?? 0) ? [sigue] : [];
    this.indice = 0;
    this.avisar();
    if (!texto || !texto.trim()) return;
    const yo = ++this.peticion;
    void sugerir(texto, this.carpeta(), this.bash()).then((lista) => {
      if (yo !== this.peticion || this.texto !== texto) return;
      // Manda el orden nuevo aunque cambie la que se veía: al escribir «git checkout »
      // las ramas de aquí tienen que ganar a lo que sugería el historial con «git ch».
      this.opciones = lista;
      this.indice = 0;
      this.avisar();
    });
  }

  /** Teclas del autocompletado; devuelve true si se la queda Kyu. */
  tecla(e: KeyboardEvent): boolean {
    if (e.type !== "keydown") return false;
    const f = this.fantasma();
    if (!f) return false;
    const sin = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    // Tab acepta la sugerencia; sin sugerencia, Tab sigue siendo el completado de la shell.
    if (e.key === "Tab" && sin) {
      this.aceptar(f.resto);
      return true;
    }
    if (e.key === "ArrowRight" && e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Hasta el final de la siguiente palabra (con su espacio o barra).
      const m = /^[\s\\/]*[^\s\\/]*[\s\\/]?/.exec(f.resto);
      this.aceptar(m && m[0] ? m[0] : f.resto);
      return true;
    }
    if (e.key === "ArrowDown" && sin && f.total > 1) {
      this.indice = (this.indice + 1) % f.total;
      this.avisar();
      return true;
    }
    if (e.key === "ArrowUp" && sin && this.indice > 0) {
      this.indice--;
      this.avisar();
      return true;
    }
    if (e.key === "Escape" && sin) {
      this.oculto = this.texto;
      this.avisar();
      return true;
    }
    return false;
  }

  private aceptar(trozo: string) {
    if (!trozo) return;
    this.escribir(trozo);
  }

  dispose() {
    cancelAnimationFrame(this.cuadro);
    this.oyentes.clear();
  }
}
