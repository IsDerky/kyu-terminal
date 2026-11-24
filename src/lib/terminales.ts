// Registro de terminales: cada pestaña de terminal tiene aquí su xterm y su shell.
//
// Viven fuera de React a propósito: al dividir o mover un panel, React desmonta y
// vuelve a montar la vista, que solo «engancha» y «suelta» el elemento del terminal.
// La shell se cierra únicamente al cerrar la pestaña (destruir).
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { abrirPty, cerrarPty, escribirPty, redimensionarPty, type ConfigVista } from "./nucleo";
import { Bloques } from "./bloques";
import { Autocompletado } from "./autocompletado";
import { apuntar, cargarHistorial } from "./historial";
import { avisarSiToca } from "./avisos";
import { registrarEnlaces } from "./enlaces";
import { useKyu } from "./estado";

export interface Sesion {
  term: XTerm;
  elemento: HTMLDivElement;
  bloques: Bloques;
  ajuste: FitAddon;
  busqueda: SearchAddon;
  /** null si está apagado en kyu.toml. */
  auto: Autocompletado | null;
  ptyId: number | null;
  abierta: boolean;
}

const sesiones = new Map<string, Sesion>();
// Para las pruebas automáticas (Playwright por CDP); no existe en release.
if (import.meta.env.DEV) (window as unknown as { __kyuSesiones: typeof sesiones }).__kyuSesiones = sesiones;
let configuracion: ConfigVista | null = null;
let fuenteLista: Promise<void> | null = null;

export function configurar(config: ConfigVista) {
  configuracion = config;
  void cargarHistorial();
  const primera = config.fuente.split(",")[0].trim();
  fuenteLista = document.fonts
    .load(`${config.tema.fuente_tamano}px ${primera}`)
    .then(() => undefined)
    .catch(() => undefined);
}

const NOMBRES_ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

function temaXterm({ tema }: ConfigVista): ITheme {
  const t: ITheme = {
    background: tema.fondo,
    foreground: tema.texto,
    cursor: tema.cursor,
    cursorAccent: tema.fondo,
    selectionBackground: tema.seleccion,
  };
  NOMBRES_ANSI.forEach((n, i) => (t[n] = tema.ansi[i]));
  return t;
}

export const sesion = (item: string) => sesiones.get(item);

/** Crea (si no existe) la sesión de la pestaña `item`. La shell arranca al engancharla. */
export function obtener(item: string): Sesion {
  const ya = sesiones.get(item);
  if (ya) return ya;
  const config = configuracion!;
  const elemento = document.createElement("div");
  elemento.className = "h-full w-full";

  const term = new XTerm({
    fontFamily: config.fuente,
    fontSize: config.tema.fuente_tamano,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 10000,
    allowProposedApi: true,
    theme: temaXterm(config),
    macOptionIsMeta: false,
    // En Windows la shell va por ConPTY, que reajusta las líneas al cambiar de tamaño;
    // si xterm también lo hace, se pisan y se pierde texto al dividir paneles.
    ...(navigator.userAgent.includes("Windows")
      ? { windowsPty: { backend: "conpty" as const, buildNumber: 26300 } }
      : {}),
  });
  // Las marcas de bloque llegan desde el primer prompt: registrar antes de abrir la shell.
  const bloques = new Bloques(term);
  bloques.alCambiarCarpeta = (ruta, hoja) => useKyu.getState().ponerTitulo(item, hoja || ruta, ruta);
  bloques.alTerminarOrden = (b) => {
    apuntar(b.orden ?? "", b.ruta, b.codigo ?? 0);
    void avisarSiToca(b, configuracion?.aviso_segundos ?? 10);
  };
  const datosItem = () => {
    const it = useKyu.getState().items[item];
    return it?.tipo === "terminal" ? it : null;
  };
  const auto = config.autocompletado
    ? new Autocompletado(
        term,
        bloques,
        () => datosItem()?.carpeta ?? null,
        () => {
          const icono = config.perfiles.find((p) => p.nombre === datosItem()?.perfil)?.icono;
          return icono === "bash" || icono === "linux";
        },
        (d) => {
          const id = sesiones.get(item)?.ptyId;
          if (id !== null && id !== undefined) void escribirPty(id, d);
        },
      )
    : null;
  const ajuste = new FitAddon();
  const busqueda = new SearchAddon();
  term.loadAddon(ajuste);
  term.loadAddon(busqueda);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  term.loadAddon(new WebLinksAddon((_e, url) => void openUrl(url.replace(/^(https?:\/\/)(0\.0\.0\.0|\[::\])(?=[:/]|$)/i, "$1localhost"))));
  if (import.meta.env.DEV) (window as unknown as { __kyu: XTerm }).__kyu = term;

  // Ctrl+C copia si hay selección (si no, va a la shell); Ctrl+V pega.
  term.attachCustomKeyEventHandler((e) => {
    // →, Ctrl+→, ↓, ↑ y Esc son del autocompletado mientras hay sugerencia.
    if (auto?.tecla(e)) {
      e.preventDefault();
      return false;
    }
    if (e.type !== "keydown" || !e.ctrlKey || e.shiftKey || e.altKey) return true;
    const tecla = e.key.toLowerCase();
    if (tecla === "c" && term.hasSelection()) {
      void writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (tecla === "v") {
      e.preventDefault();
      void readText().then((t) => t && term.paste(t));
      return false;
    }
    return true;
  });

  // Clic derecho: copia si hay selección, pega si no (como Windows Terminal).
  elemento.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      void writeText(term.getSelection());
      term.clearSelection();
    } else {
      void readText().then((t) => t && term.paste(t));
    }
  });

  term.onTitleChange((t) => {
    // El título de PowerShell es la carpeta; si un programa pone otro, también vale.
    if (t.trim()) useKyu.getState().ponerTitulo(item, t.trim());
  });

  const s: Sesion = { term, elemento, bloques, ajuste, busqueda, auto, ptyId: null, abierta: false };
  sesiones.set(item, s);
  return s;
}

/** Cambia la fuente de todos los terminales abiertos (desde Ajustes). */
export function aplicarFuente(fuente: string, tamano: number) {
  for (const s of sesiones.values()) {
    s.term.options.fontFamily = fuente;
    s.term.options.fontSize = tamano;
    if (s.term.element?.offsetWidth) s.ajuste.fit();
  }
}

/** Pone el terminal dentro de `contenedor` (y la primera vez, arranca la shell). */
export async function enganchar(item: string, contenedor: HTMLElement) {
  const s = obtener(item);
  if (s.elemento.parentElement !== contenedor) contenedor.appendChild(s.elemento);
  if (s.abierta) {
    // El lienzo no se redibuja solo al volver a la página (al dividir o mover el panel).
    if (s.term.element) {
      s.ajuste.fit();
      s.term.refresh(0, s.term.rows - 1);
    }
    return;
  }
  s.abierta = true;
  await fuenteLista;
  s.term.open(s.elemento);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    s.term.loadAddon(webgl);
  } catch {
    // Sin WebGL (algunas gráficas en Linux) xterm dibuja con el DOM.
  }
  registrarEnlaces(s.term, item);
  // Al dividir, los paneles de al lado cambian de tamaño a la vez. Se espera a que el
  // reparto se asiente para arrancar la shell ya con su tamaño de verdad.
  await asentado();
  s.ajuste.fit();
  // Lo que xterm manda antes de saber el id de la shell se guarda y se envía después.
  // Importante: ConPTY empieza preguntando dónde está el cursor (ESC[6n) y no deja
  // arrancar la shell hasta tener respuesta; si esa respuesta se perdiera, la shell
  // se quedaría parada al nacer.
  const pendiente: string[] = [];
  s.term.onData((d) => (s.ptyId !== null ? void escribirPty(s.ptyId, d) : pendiente.push(d)));
  s.term.onResize(({ cols, rows }) => s.ptyId !== null && void redimensionarPty(s.ptyId, cols, rows));
  await arrancarShell(item, s);
  if (s.ptyId !== null) for (const d of pendiente.splice(0)) void escribirPty(s.ptyId, d);
}

/** Dos cuadros de pantalla y un respiro: lo que tarda el reparto de paneles en asentarse. */
const asentado = () =>
  new Promise<void>((listo) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(listo, 120))),
  );

async function arrancarShell(item: string, s: Sesion) {
  const it = useKyu.getState().items[item];
  if (!it || it.tipo !== "terminal") return;
  const id = await abrirPty(it.perfil, it.carpeta, s.term.cols, s.term.rows, (d) => {
    if (import.meta.env.DEV) registro(item, d);
    s.term.write(d);
  });
  if (!sesiones.has(item)) {
    void cerrarPty(id); // se cerró la pestaña mientras arrancaba
    return;
  }
  s.ptyId = id;
}

/** Solo en desarrollo: graba lo que llega de la shell cuando window.__kyuGrabar = item. */
function registro(item: string, d: Uint8Array) {
  const w = window as unknown as { __kyuGrabar?: string; __kyuGrabado?: string[] };
  if (w.__kyuGrabar !== item) return;
  (w.__kyuGrabado ??= []).push(new TextDecoder().decode(d));
}

/** Lo saca de la pantalla sin cerrar la shell. */
export function soltar(item: string) {
  const s = sesiones.get(item);
  s?.elemento.remove();
}

/** Cierra la shell y libera el terminal. */
export function destruir(item: string) {
  const s = sesiones.get(item);
  if (!s) return;
  sesiones.delete(item);
  if (s.ptyId !== null) void cerrarPty(s.ptyId);
  s.bloques.dispose();
  s.auto?.dispose();
  s.term.dispose();
  s.elemento.remove();
}

/** La pestaña de la shell `ptyId`, para cerrarla cuando la shell termina. */
export function itemDePty(ptyId: number): string | null {
  for (const [item, s] of sesiones) if (s.ptyId === ptyId) return item;
  return null;
}
