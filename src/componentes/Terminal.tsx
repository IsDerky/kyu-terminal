import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { abrirPty, cerrarPty, escribirPty, redimensionarPty, type ConfigVista } from "../lib/nucleo";
import { Bloques } from "../lib/bloques";
import CapaBloques from "./CapaBloques";

interface Props {
  config: ConfigVista;
  alCambiarTitulo: (titulo: string) => void;
  alAbrir: (id: number) => void;
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

/** Espera a que la fuente esté cargada: si no, xterm mide las celdas con otra y se descuadra. */
async function cargarFuente(familias: string, tamano: number) {
  const primera = familias.split(",")[0].trim();
  try {
    await document.fonts.load(`${tamano}px ${primera}`);
  } catch {
    // Sin esa fuente se usa la siguiente de la lista; no es un error.
  }
}

export default function Terminal({ config, alCambiarTitulo, alAbrir }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [capa, setCapa] = useState<{ term: XTerm; bloques: Bloques } | null>(null);

  useEffect(() => {
    const div = contenedor.current!;
    let id: number | null = null;
    let vivo = true;
    const tamano = config.tema.fuente_tamano;

    const term = new XTerm({
      fontFamily: config.fuente,
      fontSize: tamano,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      allowProposedApi: true,
      theme: temaXterm(config),
      // Que AltGr escriba (\ @ # [ ] { } €) en teclados como el español.
      macOptionIsMeta: false,
    });
    // Para las pruebas automáticas (Playwright por CDP); no existe en release.
    if (import.meta.env.DEV) (window as unknown as { __kyu: XTerm }).__kyu = term;
    // Antes de que llegue nada de la shell: las marcas de bloque vienen desde el primer prompt.
    const bloques = new Bloques(term);
    const ajuste = new FitAddon();
    term.loadAddon(ajuste);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon((_e, url) => void openUrl(url)));

    // Ctrl+C copia si hay selección (si no, va a la shell); Ctrl+V pega.
    term.attachCustomKeyEventHandler((e) => {
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
    const menu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        void writeText(term.getSelection());
        term.clearSelection();
      } else {
        void readText().then((t) => t && term.paste(t));
      }
    };
    div.addEventListener("contextmenu", menu);

    let cuadro = 0;
    const observador = new ResizeObserver(() => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => vivo && ajuste.fit());
    });

    (async () => {
      await cargarFuente(config.fuente, tamano);
      if (!vivo) return;
      term.open(div);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // Sin WebGL (algunas gráficas en Linux) xterm dibuja con el DOM.
      }
      ajuste.fit();
      observador.observe(div);
      setCapa({ term, bloques });

      term.onTitleChange(alCambiarTitulo);
      const nuevoId = await abrirPty(term.cols, term.rows, (d) => term.write(d));
      if (!vivo) {
        void cerrarPty(nuevoId);
        return;
      }
      id = nuevoId;
      alAbrir(nuevoId);
      term.onData((d) => void escribirPty(nuevoId, d));
      term.onResize(({ cols, rows }) => void redimensionarPty(nuevoId, cols, rows));
      term.focus();
    })();

    return () => {
      vivo = false;
      observador.disconnect();
      div.removeEventListener("contextmenu", menu);
      if (id !== null) void cerrarPty(id);
      setCapa(null);
      bloques.dispose();
      term.dispose();
    };
  }, [config, alCambiarTitulo, alAbrir]);

  return (
    <div className="relative h-full w-full">
      <div ref={contenedor} className="h-full w-full" />
      {capa && (
        <CapaBloques
          term={capa.term}
          bloques={capa.bloques}
          fuente={config.fuente}
          tamano={config.tema.fuente_tamano}
        />
      )}
    </div>
  );
}
