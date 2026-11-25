// Panel de problemas: los errores y avisos de compiladores y linters que salen en un bloque
// (tsc, eslint, cargo/rustc, next build y el formato `ruta:línea:col: error:`), para
// abrirlos en su línea. Se lee de la salida al acabar la orden; nada se ejecuta aparte.
import { create } from "zustand";

export interface Problema {
  ruta: string;
  linea: number;
  columna: number;
  nivel: "error" | "aviso";
  mensaje: string;
  /** Código o regla: TS2322, E0308, no-unused-vars… */
  codigo?: string;
}

const EXT = String.raw`[\w./\\@~-]+\.(?:tsx?|jsx?|mjs|cjs|mts|cts|vue|svelte|astro|rs|go|py|c|cc|cpp|h|hpp|cs|java|kt|rb|php|css|scss|json|toml|ya?ml)`;
const nivelDe = (t: string): Problema["nivel"] => (/warn|aviso/i.test(t) ? "aviso" : "error");

/** Problemas que hay en una salida (sin repetir). */
export function leerProblemas(texto: string): Problema[] {
  const lineas = texto.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const r: Problema[] = [];
  const poner = (p: Problema) => {
    if (!r.some((x) => x.ruta === p.ruta && x.linea === p.linea && x.columna === p.columna && x.mensaje === p.mensaje)) r.push(p);
  };

  // tsc: «src/a.ts(3,5): error TS2322: …»
  const tscParen = new RegExp(String.raw`^\s*(${EXT})\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$`, "i");
  // tsc --pretty y genérico: «src/a.ts:3:5 - error TS2322: …» / «a.c:3:5: error: …» / «./a.tsx:3:5: Type error: …»
  const conDos = new RegExp(String.raw`^\s*(${EXT}):(\d+):(\d+)(?::|\s+-)\s*(?:Type\s+)?(error|warning)(?:\s+(TS\d+))?:?\s*(.+)$`, "i");
  // rustc / cargo: «error[E0308]: …» y unas líneas más abajo «  --> src/main.rs:4:5»
  const rustCab = /^(error|warning)(?:\[(\w+)\])?:\s*(.+)$/;
  const rustDonde = new RegExp(String.raw`^\s*-->\s*(${EXT}):(\d+):(\d+)`);
  // next build: «./src/app/page.tsx:12:7» y en la siguiente «Type error: …»
  const soloRuta = new RegExp(String.raw`^\s*(\.?[\\/]?${EXT}):(\d+):(\d+)\s*$`);
  // eslint (stylish): ruta sola en una línea y debajo «  3:5  error  mensaje  regla»
  const eslintRuta = new RegExp(String.raw`^((?:[A-Za-z]:)?[\\/]?${EXT})\s*$`);
  const eslintLinea = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([@\w/-]+))?\s*$/;

  let rust: { nivel: Problema["nivel"]; mensaje: string; codigo?: string } | null = null;
  let eslint: string | null = null;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    let m: RegExpMatchArray | null;

    if ((m = l.match(tscParen))) {
      poner({ ruta: m[1], linea: +m[2], columna: +m[3], nivel: nivelDe(m[4]), codigo: m[5], mensaje: m[6].trim() });
      continue;
    }
    if ((m = l.match(conDos))) {
      poner({ ruta: m[1], linea: +m[2], columna: +m[3], nivel: nivelDe(m[4]), codigo: m[5], mensaje: m[6].trim() });
      continue;
    }
    if ((m = l.match(rustCab)) && !/^(error|warning): (could not compile|aborting|build failed)|generated \d+ warnings?/i.test(l)) {
      rust = { nivel: nivelDe(m[1]), codigo: m[2], mensaje: m[3].trim() };
      continue;
    }
    if (rust && (m = l.match(rustDonde))) {
      poner({ ruta: m[1], linea: +m[2], columna: +m[3], ...rust });
      rust = null;
      continue;
    }
    if ((m = l.match(soloRuta))) {
      const sig = lineas[i + 1]?.match(/^\s*(Type error|Error|error|Warning|warning):\s*(.+)$/);
      if (sig) {
        poner({ ruta: m[1], linea: +m[2], columna: +m[3], nivel: nivelDe(sig[1]), mensaje: sig[2].trim() });
        i++;
        continue;
      }
    }
    if ((m = l.match(eslintRuta))) {
      eslint = m[1];
      continue;
    }
    if (eslint && (m = l.match(eslintLinea))) {
      poner({ ruta: eslint, linea: +m[1], columna: +m[2], nivel: nivelDe(m[3]), mensaje: m[4].trim(), codigo: m[5] });
      continue;
    }
    if (eslint && l.trim() === "") eslint = null;
  }
  return r.slice(0, 500);
}

/** Órdenes que compilan o revisan: si no dejan problemas, el panel dice «sin problemas». */
export const esDeProblemas = (orden: string) =>
  /\b(tsc|eslint|biome|next\s+build|vite\s+build|cargo\s+(build|check|clippy|test)|rustc|go\s+(build|vet)|mypy|ruff|pyright|(pnpm|npm|yarn|bun)\s+(run\s+)?(build|lint|typecheck|check))\b/i.test(orden);

export interface Resultado {
  orden: string;
  carpeta: string | null;
  hora: string;
  lista: Problema[];
}

interface Tienda {
  /** Por espacio: lo último que dejó un bloque. */
  porEspacio: Record<string, Resultado>;
  poner: (espacio: string, r: Resultado) => void;
}

export const useProblemas = create<Tienda>((set) => ({
  porEspacio: {},
  poner: (espacio, r) => set((s) => ({ porEspacio: { ...s.porEspacio, [espacio]: r } })),
}));
