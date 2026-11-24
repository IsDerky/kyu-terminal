// Aviso de Windows cuando termina una orden larga y no estás mirando Kyu (ventana sin foco
// o minimizada). El umbral sale de `aviso_segundos` en kyu.toml (10 por defecto; 0 = nunca).
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { duracion, type Bloque } from "./bloques";

let permiso: boolean | null = null;

async function puedoAvisar() {
  if (permiso !== null) return permiso;
  permiso = await isPermissionGranted().catch(() => false);
  if (!permiso) permiso = (await requestPermission().catch(() => "denied")) === "granted";
  return permiso;
}

/** Se llama al terminar cada orden. */
export async function avisarSiToca(b: Bloque, umbralSegundos: number) {
  if (umbralSegundos <= 0 || !b.orden || b.durMs === undefined || b.durMs < umbralSegundos * 1000) return;
  const ventana = getCurrentWindow();
  const delante = (await ventana.isFocused().catch(() => true)) && !(await ventana.isMinimized().catch(() => false));
  if (delante || !(await puedoAvisar())) return;
  const bien = b.estado === "ok";
  const orden = b.orden.length > 80 ? `${b.orden.slice(0, 79)}…` : b.orden;
  sendNotification({
    title: bien ? `Terminada · ${duracion(b.durMs)}` : `Ha fallado (código ${b.codigo}) · ${duracion(b.durMs)}`,
    body: `${orden}${b.hoja ? `\nen ${b.hoja}` : ""}`,
  });
}
