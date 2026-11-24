// Historial de órdenes de Kyu, común a todas las shells: cada orden con la carpeta donde
// se usó por última vez, si salió bien, cuándo y cuántas veces. Vive en el almacén de la
// ventana (localStorage). La primera vez se rellena con los historiales que ya hay en el
// equipo (PSReadLine y bash) para que sugiera desde el primer día.
import { appDataDir, homeDir, join } from "@tauri-apps/api/path";
import { leerArchivo } from "./nucleo";

export interface Orden {
  /** La orden tal cual. */
  o: string;
  /** Carpeta de la última vez (null si viene de un historial importado). */
  c: string | null;
  /** Código de salida de la última vez. */
  k: number;
  /** Cuándo (ms). */
  t: number;
  /** Veces. */
  n: number;
}

const CLAVE = "kyu:historial";
const MAXIMO = 3000;

let lista: Orden[] = [];
let cargado = false;

function guardar() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    // Almacén lleno: se recorta a la mitad y se reintenta en la próxima orden.
    lista = lista.slice(-MAXIMO / 2);
  }
}

/** Carga el historial; la primera vez importa los del equipo. */
export async function cargarHistorial() {
  if (cargado) return;
  cargado = true;
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado) {
      lista = JSON.parse(guardado) as Orden[];
      return;
    }
  } catch {
    lista = [];
  }
  const importadas: string[] = [];
  const leer = async (ruta: Promise<string>) => {
    try {
      importadas.push(...(await leerArchivo(await ruta)).split(/\r?\n/));
    } catch {
      // No existe: nada que importar.
    }
  };
  const datos = await appDataDir().catch(() => null); // …\AppData\Roaming\<app>
  if (datos) {
    const roaming = datos.replace(/[\\/][^\\/]+[\\/]?$/, "");
    await leer(join(roaming, "Microsoft", "Windows", "PowerShell", "PSReadLine", "ConsoleHost_history.txt"));
  }
  await leer(homeDir().then((h) => join(h, ".bash_history")));
  const vistas = new Map<string, Orden>();
  let t = Date.now() - importadas.length * 1000; // orden aproximado, las últimas más recientes
  for (const linea of importadas) {
    const o = linea.trim();
    t += 1000;
    if (!o || o.length > 500 || o.startsWith("#")) continue;
    const ya = vistas.get(o);
    if (ya) (ya.n++, (ya.t = t));
    else vistas.set(o, { o, c: null, k: 0, t, n: 1 });
  }
  lista = [...vistas.values()].sort((a, b) => a.t - b.t).slice(-MAXIMO);
  guardar();
}

/** Apunta una orden terminada. */
export function apuntar(o: string, carpeta: string | null, codigo: number) {
  o = o.trim();
  if (!o || o.length > 500) return;
  const i = lista.findIndex((x) => x.o === o);
  const n = i >= 0 ? lista[i].n + 1 : 1;
  if (i >= 0) lista.splice(i, 1);
  lista.push({ o, c: carpeta, k: codigo, t: Date.now(), n });
  if (lista.length > MAXIMO) lista = lista.slice(-MAXIMO);
  guardar();
}

/**
 * Órdenes que empiezan por `texto`, las mejores primero: las que salieron bien antes
 * que las que fallaron; luego las usadas en esta carpeta, y luego las más recientes
 * (con un empujón a las que se usan mucho).
 */
export function buscarEnHistorial(texto: string, carpeta: string | null): { o: string; aqui: boolean }[] {
  if (!texto) return [];
  const misma = (c: string | null) => !!c && !!carpeta && c.toLowerCase() === carpeta.toLowerCase();
  const ahora = Date.now();
  return lista
    .filter((x) => x.o.length > texto.length && x.o.startsWith(texto))
    .map((x) => {
      const dias = (ahora - x.t) / 86_400_000;
      const nota = (x.k === 0 ? 1000 : 0) + (misma(x.c) ? 100 : 0) - Math.min(dias, 60) + Math.log2(x.n) * 3;
      return { o: x.o, nota, aqui: misma(x.c) };
    })
    .sort((a, b) => b.nota - a.nota)
    .map(({ o, aqui }) => ({ o, aqui }));
}
