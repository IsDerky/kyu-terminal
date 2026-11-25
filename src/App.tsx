import { lazy, Suspense, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Avisos from "./componentes/Avisos";
import BarraTitulo, { nombreEspacio } from "./componentes/BarraTitulo";
import Espacio from "./componentes/Espacio";
import Paleta from "./componentes/Paleta";
import BarraEstado from "./componentes/BarraEstado";
import ElegirIssue from "./componentes/ElegirIssue";
import Entorno from "./componentes/Entorno";
// Se cargan la primera vez que se abren (menos memoria si no se usan).
const Ajustes = lazy(() => import("./componentes/Ajustes"));
const Uso = lazy(() => import("./componentes/Uso"));
import { alTerminarPty, cerrarTodasClaude, cerrarTodasPty, leerConfig, type ConfigVista } from "./lib/nucleo";
import { carpetaDelEspacio, configurarClaude, irAClaude, limpiar, nuevaConversacion } from "./lib/claude";
import { escucharMcp } from "./lib/mcp";
import { alternarGrabacion } from "./lib/grabar";
import { focoActual, paneles, useKyu } from "./lib/estado";
import { aplicarFuente, configurar, itemDePty, sesion } from "./lib/terminales";
import { configurarEditores, editor } from "./lib/editores";
import { cerrarActual, cerrarItem, moverFoco } from "./lib/acciones";
import { restaurarSesion, vigilarSesion } from "./lib/restaurar";
import { configurarLimite } from "./lib/gasto";
import { preguntarPorSeleccion } from "./lib/seleccion";
import { vigilarActualizaciones } from "./lib/actualizar";
import { vigilarGit } from "./lib/git";

/** Panel del que se vino a Claude con Ctrl+Mayús+C (para volver con la misma tecla). */
let volverA: { espacio: string; panel: string } | null = null;

/**
 * Ctrl+Mayús+C: lleva a la última conversación del espacio (o abre una a la derecha) con el
 * cursor en la caja. Con el foco ya en Claude, vuelve al panel de antes.
 */
function alternarClaude() {
  const k = useKyu.getState();
  const f = focoActual();
  if (f?.item?.tipo === "claude") {
    const esp = f.espacio;
    const antes = volverA?.espacio === esp.id ? paneles(esp.raiz).find((p) => p.id === volverA!.panel) : undefined;
    const destino = antes ?? paneles(esp.raiz).find((p) => p.activo && k.items[p.activo]?.tipo !== "claude");
    if (!destino?.activo) return;
    k.enfocar(destino.id);
    const it = k.items[destino.activo];
    if (it?.tipo === "terminal") sesion(it.id)?.term.focus();
    else if (it?.tipo === "archivo") editor(it.id)?.vista.focus();
    return;
  }
  if (f?.panel) volverA = { espacio: f.espacio.id, panel: f.panel.id };
  irAClaude(k.activo);
}

export default function App() {
  const [config, setConfig] = useState<ConfigVista | null>(null);
  const [issues, setIssues] = useState(false);
  const [entorno, setEntorno] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const espacios = useKyu((s) => s.espacios);
  const activo = useKyu((s) => s.activo);
  const paleta = useKyu((s) => s.paleta);
  const ajustes = useKyu((s) => s.ajustes);
  const uso = useKyu((s) => s.uso);
  useKyu((s) => s.items); // el título de la ventana sigue al terminal con el foco

  useEffect(() => {
    void cerrarTodasPty();
    void cerrarTodasClaude();
    let dejar: (() => void) | null = null;
    leerConfig().then(async (c) => {
      document.documentElement.style.setProperty("--font-mono", c.fuente);
      configurar(c);
      configurarEditores(c.fuente, c.tema.fuente_tamano);
      configurarLimite(c.limite_diario);
      configurarClaude(c);
      vigilarActualizaciones(c.actualizaciones);
      const porDefecto = c.perfiles[0]?.nombre ?? "";
      // Lo de la última vez; si no hay (o está apagado en Ajustes), un espacio nuevo.
      const restaurada = c.restaurar_sesion && (await restaurarSesion(c.perfiles.map((p) => p.nombre), porDefecto).catch(() => false));
      if (!restaurada) useKyu.getState().iniciar(porDefecto);
      setConfig(c);
      dejar = vigilarSesion();
    }, (e) => setError(String(e)));
    return () => dejar?.();
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

  // Git del espacio activo (barra de estado y avisos de CI); la paleta abre los issues.
  useEffect(() => {
    const dejar = vigilarGit();
    const abrir = () => setIssues(true);
    const abrirEntorno = () => setEntorno(true);
    window.addEventListener("kyu-issues", abrir);
    window.addEventListener("kyu-entorno", abrirEntorno);
    return () => {
      dejar();
      window.removeEventListener("kyu-issues", abrir);
      window.removeEventListener("kyu-entorno", abrirEntorno);
    };
  }, []);

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
          case "KeyX": hecho(); k.alternarMaximizar(); return;
          case "KeyG": hecho(); void alternarGrabacion(); return;
          case "KeyB": hecho(); k.alternarArbol(); return;
          // En el editor, Ctrl+Mayús+K es borrar línea (como en VS Code): se le deja.
          case "KeyK": if (enEditor) return; hecho(); nuevaConversacion(k.activo); return;
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
        // Alt+K: la selección a Claude. Sin selección, la tecla sigue a la shell.
        if (e.code === "KeyK" && preguntarPorSeleccion()) return hecho();
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
      <Suspense fallback={null}>
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
                configurarLimite(c.limite_diario);
                configurarClaude(c);
                vigilarActualizaciones(c.actualizaciones);
                setConfig(c);
              })
            }
          />
        )}
        {uso && <Uso />}
        {espacio && (
          <div className={ajustes || uso ? "hidden" : "flex min-w-0 flex-1"}>
            <Espacio key={espacio.id} espacio={espacio} config={config} />
          </div>
        )}
      </div>
      </Suspense>
      <BarraEstado alIssues={() => setIssues(true)} />
      <Avisos />
      {issues && <ElegirIssue perfil={config.perfiles[0]?.nombre ?? ""} alCerrar={() => setIssues(false)} />}
      {entorno && <Entorno carpeta={carpetaDelEspacio(activo)} alCerrar={() => setEntorno(false)} />}
      {paleta && <Paleta config={config} />}
    </div>
  );
}
