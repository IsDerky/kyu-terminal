// Enlaces a archivos en la salida del terminal: `src/pty.rs:82:13`, `C:\x\y.ts(12,4)`,
// `./README.md`… Solo se marcan si el archivo existe (lo comprueba el núcleo).
//   Ctrl+Clic  → se abre en Kyu, en esa línea
//   Mayús+Clic → se abre en VS Code
import type { ILink, Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resolverArchivo } from "./nucleo";
import { esCommit, resumenGit, type ResumenGit } from "./git";
import { useKyu } from "./estado";

// Ruta (con al menos una barra o una extensión) + :línea[:columna] o (línea,columna) opcionales.
const RUTA =
  /(?<![\w/\\.:-])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@-]+[\\/])*[\w@-][\w.@-]*\.[A-Za-z0-9]{1,10})(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))?/g;

/** Pista que sale al pasar el ratón por un enlace. */
let pista: HTMLDivElement | null = null;
function mostrarPista(e: MouseEvent) {
  if (!pista) {
    pista = document.createElement("div");
    pista.className =
      "pointer-events-none fixed z-50 rounded-md border border-borde2 bg-tarjeta px-2 py-0.5 text-[11.5px] text-tenue shadow-lg";
    pista.innerHTML =
      '<b class="font-mono font-normal text-texto">Ctrl+Clic</b> abrir en Kyu · <b class="font-mono font-normal text-texto">Mayús+Clic</b> abrir en VS Code';
    document.body.appendChild(pista);
  }
  pista.style.left = `${e.clientX + 12}px`;
  pista.style.top = `${e.clientY + 16}px`;
  pista.style.display = "block";
}
const ocultarPista = () => pista && (pista.style.display = "none");

export function registrarEnlaces(term: Terminal, item: string) {
  term.registerLinkProvider({
    provideLinks(y, devolver) {
      const linea = term.buffer.active.getLine(y - 1);
      if (!linea) return devolver(undefined);
      const texto = linea.translateToString(true);
      const it = useKyu.getState().items[item];
      const base = it?.tipo === "terminal" ? it.carpeta : null;

      const candidatos = [...texto.matchAll(RUTA)].filter((m) => {
        const antes = texto.slice(Math.max(0, m.index - 3), m.index);
        return !antes.endsWith("://") && !/^\d+(\.\d+)+$/.test(m[1]); // ni URLs ni versiones «1.2.3»
      });
      if (!candidatos.length) return devolver(undefined);

      void Promise.all(
        candidatos.map(async (m) => {
          const ruta = await resolverArchivo(m[1], base).catch(() => null);
          if (!ruta) return null;
          const lineaN = Number(m[2] ?? m[4] ?? 1) || 1;
          const columna = Number(m[3] ?? m[5] ?? 1) || 1;
          const enlace: ILink = {
            range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
            text: m[0],
            decorations: { underline: true, pointerCursor: true },
            activate(e) {
              ocultarPista();
              if (e.ctrlKey) useKyu.getState().abrirArchivo(ruta, lineaN, columna);
              else if (e.shiftKey)
                void openUrl(`vscode://file/${ruta.replace(/\\/g, "/")}:${lineaN}:${columna}`);
            },
            hover: (e) => mostrarPista(e),
            leave: () => ocultarPista(),
          };
          return enlace;
        }),
      ).then((lista) => {
        const validos = lista.filter((l): l is ILink => l !== null);
        devolver(validos.length ? validos : undefined);
      });
    },
  });
}

// ---------- Commits y #números de GitHub ----------
//   Ctrl+Clic en un hash de commit del repo o en «#12» → se abre en GitHub.

const HASH = /(?<![\w/.-])([0-9a-f]{7,40})(?![\w/-])/g;
const NUMERO = /(?<![\w&/#])#(\d{1,6})\b/g;

/** Repo de cada carpeta (raíz y «dueño/repo»), guardado un rato para no preguntar a git cada vez. */
const repos = new Map<string, { cuando: number; r: Promise<ResumenGit | null> }>();
function repoDe(carpeta: string) {
  const ya = repos.get(carpeta);
  if (ya && Date.now() - ya.cuando < 60_000) return ya.r;
  const r = resumenGit(carpeta).catch(() => null);
  repos.set(carpeta, { cuando: Date.now(), r });
  return r;
}
const commits = new Map<string, Promise<boolean>>();
function esCommitCacheado(raiz: string, hash: string) {
  const k = `${raiz}|${hash}`;
  if (!commits.has(k)) commits.set(k, esCommit(raiz, hash).catch(() => false));
  return commits.get(k)!;
}

let pistaGh: HTMLDivElement | null = null;
function mostrarPistaGh(e: MouseEvent, que: string) {
  if (!pistaGh) {
    pistaGh = document.createElement("div");
    pistaGh.className =
      "pointer-events-none fixed z-50 rounded-md border border-borde2 bg-tarjeta px-2 py-0.5 text-[11.5px] text-tenue shadow-lg";
    document.body.appendChild(pistaGh);
  }
  pistaGh.innerHTML = `<b class="font-mono font-normal text-texto">Ctrl+Clic</b> abre ${que} en GitHub`;
  pistaGh.style.left = `${e.clientX + 12}px`;
  pistaGh.style.top = `${e.clientY + 16}px`;
  pistaGh.style.display = "block";
}
const ocultarPistaGh = () => pistaGh && (pistaGh.style.display = "none");

export function registrarEnlacesGithub(term: Terminal, item: string) {
  term.registerLinkProvider({
    provideLinks(y, devolver) {
      const linea = term.buffer.active.getLine(y - 1);
      const it = useKyu.getState().items[item];
      const carpeta = it?.tipo === "terminal" ? it.carpeta : null;
      if (!linea || !carpeta) return devolver(undefined);
      const texto = linea.translateToString(true);
      // Hash: con al menos una letra (no números sueltos). #número: solo si hay repo de GitHub.
      const hashes = [...texto.matchAll(HASH)].filter((m) => /[a-f]/.test(m[1]));
      const numeros = [...texto.matchAll(NUMERO)];
      if (!hashes.length && !numeros.length) return devolver(undefined);
      void repoDe(carpeta).then(async (r) => {
        if (!r?.github) return devolver(undefined);
        const enlace = (m: RegExpMatchArray, url: string, que: string): ILink => ({
          range: { start: { x: m.index! + 1, y }, end: { x: m.index! + m[0].length, y } },
          text: m[0],
          decorations: { underline: true, pointerCursor: true },
          activate(e) {
            ocultarPistaGh();
            if (e.ctrlKey) void openUrl(url);
          },
          hover: (e) => mostrarPistaGh(e, que),
          leave: () => ocultarPistaGh(),
        });
        const deHash = await Promise.all(
          hashes.map(async (m) =>
            (await esCommitCacheado(r.raiz, m[1])) ? enlace(m, `https://github.com/${r.github}/commit/${m[1]}`, `el commit ${m[1].slice(0, 7)}`) : null,
          ),
        );
        // GitHub redirige /issues/N a /pull/N si es un PR.
        const deNumero = numeros.map((m) => enlace(m, `https://github.com/${r.github}/issues/${m[1]}`, `el #${m[1]}`));
        const todos = [...deHash.filter((l): l is ILink => l !== null), ...deNumero];
        devolver(todos.length ? todos : undefined);
      });
    },
  });
}
