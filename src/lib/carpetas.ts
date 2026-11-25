// Espacios por carpeta: «Abrir carpeta…» crea un espacio fijo en ella; Kyu recuerda la
// última y las recientes (localStorage) para arrancar ya ahí y para la paleta.
import { open } from "@tauri-apps/plugin-dialog";
import { arbolListar } from "./nucleo";
import { useKyu } from "./estado";

const CLAVE = "kyu:carpetas";
const MAX = 8;

const normal = (r: string) => r.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

/** Las abiertas con «Abrir carpeta…», la última primero. */
export function recientes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function apuntar(ruta: string) {
  const lista = [ruta, ...recientes().filter((r) => normal(r) !== normal(ruta))].slice(0, MAX);
  localStorage.setItem(CLAVE, JSON.stringify(lista));
}

export function olvidar(ruta: string) {
  localStorage.setItem(CLAVE, JSON.stringify(recientes().filter((r) => normal(r) !== normal(ruta))));
}

const existe = (ruta: string) => arbolListar(ruta).then(() => true, () => false);

/** Va al espacio de esa carpeta o abre uno nuevo en ella. */
export async function abrirEnCarpeta(ruta: string, perfil: string): Promise<boolean> {
  if (!(await existe(ruta))) {
    olvidar(ruta);
    return false;
  }
  const k = useKyu.getState();
  const ya = k.espacios.find((e) => e.carpeta && normal(e.carpeta) === normal(ruta));
  if (ya) k.cambiarEspacio(ya.id);
  else k.nuevoEspacio(perfil, ruta, true);
  apuntar(ruta);
  return true;
}

/** Diálogo de Windows para elegir carpeta y abrirla como espacio. */
export async function abrirCarpeta(perfil: string) {
  const ruta = await open({ directory: true, multiple: false, title: "Abrir carpeta en Kyu", defaultPath: recientes()[0] });
  if (typeof ruta === "string") await abrirEnCarpeta(ruta, perfil);
}

/** Al arrancar sin sesión que restaurar: la última carpeta abierta, si sigue ahí. */
export async function arrancarEnUltima(perfil: string): Promise<boolean> {
  const ultima = recientes()[0];
  return ultima ? abrirEnCarpeta(ultima, perfil) : false;
}
