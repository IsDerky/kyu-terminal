// Actualizaciones desde las releases de GitHub (tauri-plugin-updater). Se busca a los 15 s de
// abrir y cada 6 h; si hay versión nueva sale un botón en la barra de título. Instalar cierra
// Kyu (el instalador de Windows lo necesita) y lo vuelve a abrir.
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

export type EstadoActualizar =
  | { tipo: "nada" }
  | { tipo: "buscando" }
  | { tipo: "al-dia" }
  | { tipo: "nueva"; version: string; notas: string }
  | { tipo: "bajando"; progreso: number | null }
  | { tipo: "error"; texto: string };

export const useActualizar = create<{ estado: EstadoActualizar }>(() => ({ estado: { tipo: "nada" } }));

const poner = (estado: EstadoActualizar) => useActualizar.setState({ estado });

let pendiente: Update | null = null;
let reloj: ReturnType<typeof setInterval> | null = null;

/** Mira si hay versión nueva. En silencio, un fallo (sin red, repo privado) no se enseña. */
export async function buscarActualizacion(manual = false) {
  const antes = useActualizar.getState().estado;
  if (antes.tipo === "buscando" || antes.tipo === "bajando") return;
  if (manual) poner({ tipo: "buscando" });
  try {
    const u = await check();
    pendiente = u;
    poner(u ? { tipo: "nueva", version: u.version, notas: u.body ?? "" } : { tipo: "al-dia" });
  } catch (e) {
    poner(manual ? { tipo: "error", texto: String(e) } : antes.tipo === "nueva" ? antes : { tipo: "nada" });
  }
}

/** Baja e instala la versión nueva y reabre Kyu (pregunta antes: se cierran los terminales). */
export async function instalarActualizacion() {
  if (!pendiente) return;
  const si = await ask(
    `Se va a instalar Kyu ${pendiente.version}. Kyu se cierra (y con él los terminales abiertos) y se vuelve a abrir; los espacios y las conversaciones vuelven como estaban.`,
    { title: "Actualizar Kyu", kind: "info", okLabel: "Actualizar", cancelLabel: "Ahora no" },
  );
  if (!si) return;
  let total = 0;
  let bajado = 0;
  poner({ tipo: "bajando", progreso: null });
  try {
    await pendiente.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      if (ev.event === "Progress") {
        bajado += ev.data.chunkLength;
        poner({ tipo: "bajando", progreso: total ? bajado / total : null });
      }
    });
    await relaunch();
  } catch (e) {
    poner({ tipo: "error", texto: String(e) });
  }
}

/** Desde la configuración: buscar al abrir y cada 6 h (no en desarrollo ni en la portable). */
export function vigilarActualizaciones(activo: boolean) {
  if (reloj) clearInterval(reloj);
  reloj = null;
  if (!activo || import.meta.env.DEV) return;
  setTimeout(() => void buscarActualizacion(), 15_000);
  reloj = setInterval(() => void buscarActualizacion(), 6 * 3600_000);
}
