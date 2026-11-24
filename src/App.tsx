import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BarraTitulo from "./componentes/BarraTitulo";
import Terminal from "./componentes/Terminal";
import { alTerminarPty, leerConfig, type ConfigVista } from "./lib/nucleo";

export default function App() {
  const [config, setConfig] = useState<ConfigVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("Kyu Terminal");
  const idPty = useRef<number | null>(null);

  useEffect(() => {
    leerConfig().then(setConfig, (e) => setError(String(e)));
  }, []);

  // Cuando la shell termina (exit), se cierra la ventana, como en cualquier terminal.
  useEffect(() => {
    const quitar = alTerminarPty((id) => {
      if (id === idPty.current) void getCurrentWindow().close();
    });
    return () => void quitar.then((f) => f());
  }, []);

  const cambiarTitulo = useCallback((t: string) => {
    const limpio = t.trim() || "Kyu Terminal";
    setTitulo(limpio);
    void getCurrentWindow().setTitle(`${limpio} · Kyu`);
  }, []);

  const alAbrir = useCallback((id: number) => {
    idPty.current = id;
  }, []);

  return (
    <div className="flex h-full flex-col">
      <BarraTitulo titulo={titulo} />
      <main className="min-h-0 flex-1 py-2 pl-3.5 pr-1">
        {error ? (
          <p className="p-4 font-mono text-mal">No se pudo leer la configuración: {error}</p>
        ) : config ? (
          <Terminal config={config} alCambiarTitulo={cambiarTitulo} alAbrir={alAbrir} />
        ) : null}
      </main>
    </div>
  );
}
