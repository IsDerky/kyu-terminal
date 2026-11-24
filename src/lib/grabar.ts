// Grabar la sesión a GIF (Ctrl+Mayús+G): el núcleo fotografía la ventana y recorta el
// panel con el foco (src-tauri/src/grabar.rs). Aquí, el estado para la barra de título.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useKyu } from "./estado";

type Estado =
  | { tipo: "parado" }
  | { tipo: "grabando"; desde: number }
  | { tipo: "guardando" }
  | { tipo: "hecho"; ruta: string }
  | { tipo: "error"; texto: string };

export const useGrabar = create<{ estado: Estado }>(() => ({ estado: { tipo: "parado" } }));

const poner = (estado: Estado) => useGrabar.setState({ estado });
let limpiar: number | undefined;
const durante = (estado: Estado, ms: number) => {
  poner(estado);
  clearTimeout(limpiar);
  limpiar = window.setTimeout(() => poner({ tipo: "parado" }), ms);
};

const dos = (n: number) => String(n).padStart(2, "0");
function nombre() {
  const d = new Date();
  return `kyu-${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

/** Empieza a grabar el panel con el foco (o la zona de los paneles si no se encuentra). */
export async function empezarGrabacion() {
  const k = useKyu.getState();
  const esp = k.espacios.find((e) => e.id === k.activo);
  const el =
    (esp && document.querySelector<HTMLElement>(`[data-panel="${esp.foco}"]`)) ||
    document.querySelector<HTMLElement>("[data-panel]")?.parentElement;
  if (!el) return;
  const r = el.getBoundingClientRect();
  try {
    clearTimeout(limpiar);
    await invoke("grabar_empezar", {
      recorte: { x: r.left, y: r.top, ancho: r.width, alto: r.height, escala: window.devicePixelRatio },
      nombre: nombre(),
    });
    poner({ tipo: "grabando", desde: Date.now() });
    // El núcleo para solo al minuto; aquí se recoge el resultado.
    window.setTimeout(() => {
      const e = useGrabar.getState().estado;
      if (e.tipo === "grabando" && Date.now() - e.desde >= 59_000) void pararGrabacion();
    }, 60_500);
  } catch (e) {
    durante({ tipo: "error", texto: String(e) }, 6000);
  }
}

export async function pararGrabacion() {
  if (useGrabar.getState().estado.tipo !== "grabando") return;
  poner({ tipo: "guardando" });
  try {
    const ruta = await invoke<string>("grabar_parar");
    durante({ tipo: "hecho", ruta }, 8000);
  } catch (e) {
    durante({ tipo: "error", texto: String(e) }, 6000);
  }
}

export const alternarGrabacion = () =>
  useGrabar.getState().estado.tipo === "grabando" ? pararGrabacion() : empezarGrabacion();
