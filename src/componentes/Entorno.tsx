import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, FileText, Loader2, TriangleAlert } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { leerEntorno, type Entorno as DatosEntorno, type Variable } from "../lib/nucleo";

// Las que más se miran, arriba.
const IMPORTANTES = ["CLAUDE_CONFIG_DIR", "NODE_ENV", "KYU_TERMINAL", "HOME", "USERPROFILE", "SHELL", "COMSPEC", "JAVA_HOME", "PYTHONPATH", "VIRTUAL_ENV", "CARGO_HOME", "GOPATH"];
// Valores que parecen secretos: tapados hasta pulsar el ojo.
const SECRETO = /(SECRET|TOKEN|PASSWORD|PASSWD|PWD$|API_?KEY|PRIVATE|CREDENTIAL|AUTH|_KEY$|^KEY$|DSN|DATABASE_URL|CONNECTION_STRING)/i;

type Pestana = "proceso" | "path" | string; // string = nombre de un .env

/**
 * Variables de entorno del espacio: las que heredan sus shells, el PATH por entradas y los
 * .env* de su carpeta. Solo para mirar; nada sale de aquí salvo lo que copies tú.
 */
export default function Entorno({ carpeta, alCerrar }: { carpeta: string | null; alCerrar: () => void }) {
  const [datos, setDatos] = useState<DatosEntorno | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("proceso");
  const [busqueda, setBusqueda] = useState("");
  const [vistos, setVistos] = useState<Set<string>>(new Set());
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entrada.current?.focus();
    leerEntorno(carpeta).then(setDatos, (e) => setError(String(e)));
  }, [carpeta]);

  const variables: Variable[] = useMemo(() => {
    if (!datos || pestana === "path") return [];
    const lista = pestana === "proceso" ? datos.proceso.filter((v) => v.nombre.toUpperCase() !== "PATH") : datos.ficheros.find((f) => f.nombre === pestana)?.variables ?? [];
    const q = busqueda.toLowerCase();
    const filtradas = lista.filter((v) => !q || v.nombre.toLowerCase().includes(q) || v.valor.toLowerCase().includes(q));
    if (pestana !== "proceso") return filtradas;
    const peso = (n: string) => {
      const i = IMPORTANTES.indexOf(n.toUpperCase());
      return i < 0 ? IMPORTANTES.length : i;
    };
    return [...filtradas].sort((a, b) => peso(a.nombre) - peso(b.nombre));
  }, [datos, pestana, busqueda]);

  const path = (datos?.path ?? []).filter((p) => !busqueda || p.ruta.toLowerCase().includes(busqueda.toLowerCase()));
  const pestanas: { id: Pestana; texto: string; n: number }[] = datos
    ? [
        { id: "proceso", texto: "Shells", n: datos.proceso.length - 1 },
        { id: "path", texto: "PATH", n: datos.path.length },
        ...datos.ficheros.map((f) => ({ id: f.nombre, texto: f.nombre, n: f.variables.length })),
      ]
    : [];
  const alternar = (clave: string) =>
    setVistos((s) => {
      const n = new Set(s);
      if (n.has(clave)) n.delete(clave);
      else n.add(clave);
      return n;
    });

  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/30 pt-14" onMouseDown={alCerrar}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && alCerrar()}
        className="flex h-fit max-h-[78vh] w-[720px] flex-col overflow-hidden rounded-[10px] border border-borde2 bg-tarjeta text-[12.5px] shadow-[0_24px_60px_-16px_#000]"
      >
        <div className="flex items-center gap-3 border-b border-borde px-3">
          <input
            ref={entrada}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar variable o valor"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-texto outline-none placeholder:text-muy"
          />
          <span className="truncate text-[11.5px] text-muy" title={carpeta ?? undefined}>
            {carpeta ? carpeta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "sin carpeta"}
          </span>
        </div>

        <div className="flex flex-none gap-1 border-b border-borde px-2 py-1.5">
          {pestanas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestana(p.id)}
              className={`flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] ${pestana === p.id ? "bg-hover text-texto" : "text-tenue hover:text-texto"}`}
            >
              {p.id !== "proceso" && p.id !== "path" && <FileText size={12} strokeWidth={1.8} />}
              {p.texto}
              <span className="text-[10.5px] tabular-nums text-muy">{p.n}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!datos && !error && (
            <p className="flex items-center gap-2 px-3 py-3 text-tenue">
              <Loader2 size={13} className="animate-spin" /> Leyendo…
            </p>
          )}
          {error && <p className="px-3 py-3 text-mal">{error}</p>}

          {datos && pestana === "path" &&
            path.map((p, i) => (
              <div key={`${i}-${p.ruta}`} className="group flex items-center gap-2 px-3 py-1 hover:bg-hover">
                <span className="w-6 flex-none text-right text-[11px] tabular-nums text-muy">{i + 1}</span>
                <span className={`min-w-0 flex-1 truncate font-mono text-[12px] ${p.existe ? "text-texto" : "text-muy line-through"}`} title={p.ruta}>
                  {p.ruta}
                </span>
                {!p.existe && (
                  <span className="flex flex-none items-center gap-1 text-[11px] text-aviso" title="Esta carpeta no existe">
                    <TriangleAlert size={12} /> no existe
                  </span>
                )}
                <Copiar texto={p.ruta} />
              </div>
            ))}

          {datos && pestana !== "path" && variables.length === 0 && <p className="px-3 py-3 text-tenue">Nada que enseñar.</p>}
          {datos &&
            pestana !== "path" &&
            variables.map((v) => {
              const clave = `${pestana}:${v.nombre}`;
              const secreto = SECRETO.test(v.nombre) && v.valor !== "";
              const visible = !secreto || vistos.has(clave);
              return (
                <div key={clave} className="group flex items-start gap-3 px-3 py-1 hover:bg-hover">
                  <span className="w-56 flex-none truncate font-mono text-[12px] text-acento2" title={v.nombre}>
                    {v.nombre}
                  </span>
                  <span className={`min-w-0 flex-1 break-all font-mono text-[12px] ${visible ? "text-texto" : "select-none text-muy"}`}>
                    {visible ? v.valor || <span className="text-muy">(vacía)</span> : "•".repeat(Math.min(v.valor.length, 24))}
                  </span>
                  {secreto && (
                    <button type="button" title={visible ? "Tapar" : "Enseñar"} onClick={() => alternar(clave)} className="grid size-5 flex-none place-items-center rounded text-muy hover:text-texto">
                      {visible ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                  <Copiar texto={v.valor} />
                </div>
              );
            })}
        </div>

        <p className="flex-none border-t border-borde px-3 py-1.5 text-[11px] text-muy">
          Las de «Shells» son las de Kyu al arrancar: lo que cambie tu perfil de la shell no sale aquí. Los secretos van tapados y nada de esto se manda a Claude.
        </p>
      </div>
    </div>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [hecho, setHecho] = useState(false);
  useEffect(() => {
    if (!hecho) return;
    const t = setTimeout(() => setHecho(false), 1200);
    return () => clearTimeout(t);
  }, [hecho]);
  return (
    <button
      type="button"
      title="Copiar valor"
      onClick={() => void writeText(texto).then(() => setHecho(true))}
      className={`grid size-5 flex-none place-items-center rounded opacity-0 group-hover:opacity-100 ${hecho ? "text-ok opacity-100" : "text-muy hover:text-texto"}`}
    >
      {hecho ? <Check size={12} /> : <Copy size={11} />}
    </button>
  );
}
