import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Avisos from "./componentes/Avisos";
import BarraTitulo, { nombreEspacio } from "./componentes/BarraTitulo";
import Espacio from "./componentes/Espacio";
import Paleta from "./componentes/Paleta";
import PanelClaude, { ID_ENTRADA } from "./componentes/PanelClaude";
import Ajustes from "./componentes/Ajustes";
import { alTerminarPty, cerrarTodasClaude, cerrarTodasPty, leerConfig, type ConfigVista } from "./lib/nucleo";
import { limpiar, useClaude } from "./lib/claude";
import { escucharMcp } from "./lib/mcp";
import { alternarGrabacion } from "./lib/grabar";
import { focoActual, useKyu } from "./lib/estado";
import { aplicarFuente, configurar, itemDePty, sesion } from "./lib/terminales";
import { configurarEditores, editor } from "./lib/editores";
import { cerrarActual, cerrarItem, moverFoco } from "./lib/acciones";

/**
 * Ctrl+Mayús+C: oculto → se abre con el cursor en la caja; abierto sin foco → le da el
 * foco; abierto con foco → se oculta y el foco vuelve al panel de antes.
 */
function alternarClaude() {
  const { visible, mostrar } = useClaude.getState();
  const caja = () => document.getElementById(ID_ENTRADA) as HTMLTextAreaElement | null;
  if (visible && document.activeElement === caja()) {
    mostrar(false);
    const it = focoActual()?.item;
    if (it?.tipo === "terminal") sesion(it.id)?.term.focus();
    else if (it?.tipo === "archivo") editor(it.id)?.vista.focus();
    return;
  }
  mostrar(true);
  requestAnimationFrame(() => caja()?.focus());
}

export default function App() {
  const [config, setConfig] = useState<ConfigVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const espacios = useKyu((s) => s.espacios);
  const activo = useKyu((s) => s.activo);
  const paleta = useKyu((s) => s.paleta);
  const ajustes = useKyu((s) => s.ajustes);
  const claudeVisible = useClaude((s) => s.visible);
  useKyu((s) => s.items); // el título de la ventana sigue al terminal con el foco

  useEffect(() => {
    void cerrarTodasPty();
    void cerrarTodasClaude();
    leerConfig().then((c) => {
      document.documentElement.style.setProperty("--font-mono", c.fuente);
      configurar(c);
      configurarEditores(c.fuente, c.tema.fuente_tamano);
      setConfig(c);
      useKyu.getState().iniciar(c.perfiles[0]?.nombre ?? "");
    }, (e) => setError(String(e)));
  }, []);

  // Cuando una shell termina (exit), se cierra su pestaña.
  useEffect(() => {
    const quitar = alTerminarPty((ptyId) => {
      const item = itemDePty(ptyId);
      if (item) void cerrarItem(item, false);
    });
    return () => void quitar.then((f) => f());
  }, []);

  // Herramientas MCP de Kyu para el Claude del panel.
  useEffect(() => {
    const quitar = escucharMcp();
    return () => void quitar.then((f) => f());
  }, []);

  // Al cerrar un espacio se cierra también su conversación con Claude.
  useEffect(() => limpiar(espacios.map((e) => e.id)), [espacios]);

  // Atajos de Kyu. En fase de captura, para que xterm no se los quede.
  useEffect(() => {
    if (!config) return;
    const teclas = (e: KeyboardEvent) => {
      const k = useKyu.getState();
      const f = focoActual();
      const perfil = f?.item?.tipo === "terminal" ? f.item.perfil : config.perfiles[0]?.nombre ?? "";
      const enEditor = (document.activeElement as HTMLElement | null)?.closest(".cm-editor");
      const hecho = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.ctrlKey && e.shiftKey && !e.altKey) {
        switch (e.code) {
          case "KeyP": hecho(); k.ponerPaleta(!k.paleta); return;
          case "KeyD": hecho(); k.dividir("horizontal", perfil); return;
          case "KeyE": hecho(); k.dividir("vertical", perfil); return;
          case "KeyT": hecho(); k.nuevaPestana(perfil); return;
          case "KeyN": hecho(); k.nuevoEspacio(config.perfiles[0]?.nombre ?? ""); return;
          case "KeyW": hecho(); cerrarActual(); return;
          case "Tab": hecho(); k.siguientePestana(-1); return;
          case "KeyC": hecho(); alternarClaude(); return;
          case "KeyG": hecho(); void alternarGrabacion(); return;
        }
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.code === "Comma") return (hecho(), k.ponerAjustes(!k.ajustes));
        if (e.code === "Tab") return (hecho(), k.siguientePestana(1));
        if (/^Digit[1-9]$/.test(e.code)) {
          const esp = k.espacios[Number(e.code.slice(5)) - 1];
          if (esp) (hecho(), k.cambiarEspacio(esp.id));
          return;
        }
        if (e.code === "KeyF" && !enEditor && f?.item?.tipo === "terminal") return (hecho(), k.ponerBuscando(f.item.id));
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const dir = { ArrowLeft: "izquierda", ArrowRight: "derecha", ArrowUp: "arriba", ArrowDown: "abajo" }[e.code] as
          | "izquierda" | "derecha" | "arriba" | "abajo" | undefined;
        if (dir) return (hecho(), moverFoco(dir));
      }
    };
    window.addEventListener("keydown", teclas, true);
    return () => window.removeEventListener("keydown", teclas, true);
  }, [config]);

  const espacio = espacios.find((e) => e.id === activo);
  useEffect(() => {
    if (espacio) void getCurrentWindow().setTitle(`${nombreEspacio(espacio)} · Kyu`);
  });

  if (error) return <p className="p-4 font-mono text-mal">No se pudo leer la configuración: {error}</p>;
  if (!config) return null;
  return (
    <div className="relative flex h-full flex-col">
      <BarraTitulo config={config} />
      <div className="flex min-h-0 flex-1">
        {ajustes && (
          <Ajustes
            config={config}
            alCambiar={() =>
              void leerConfig().then((c) => {
                document.documentElement.style.setProperty("--font-mono", c.fuente);
                configurar(c);
                configurarEditores(c.fuente, c.tema.fuente_tamano);
                aplicarFuente(c.fuente, c.tema.fuente_tamano);
                setConfig(c);
              })
            }
          />
        )}
        {espacio && (
          <div className={ajustes ? "hidden" : "flex min-w-0 flex-1"}>
            <Espacio key={espacio.id} espacio={espacio} config={config} />
          </div>
        )}
        {espacio && claudeVisible && <PanelClaude key={`claude-${espacio.id}`} espacio={espacio.id} />}
      </div>
      <Avisos />
      {paleta && <Paleta config={config} />}
    </div>
  );
}
