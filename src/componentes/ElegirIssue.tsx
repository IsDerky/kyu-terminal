import { useEffect, useRef, useState } from "react";
import { CircleDot, GitBranch, Loader2 } from "lucide-react";
import { issuesGh, useGit, worktreeNuevo, type Issue } from "../lib/git";
import { conversacionEnPanel, useClaude } from "../lib/claude";
import { useKyu } from "../lib/estado";
import { Mascota } from "./iconos";

/**
 * De un issue a un espacio de trabajo: worktree con su rama al lado del repo, espacio nuevo en
 * él y una conversación con el issue ya escrito en la caja (se manda cuando quieras).
 */
export default function ElegirIssue({ perfil, alCerrar }: { perfil: string; alCerrar: () => void }) {
  const r = useGit((s) => s.resumen);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sel, setSel] = useState(0);
  const [creando, setCreando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entrada.current?.focus();
    if (!r) return;
    issuesGh(r.raiz).then(setIssues, (e) => setError(String(e)));
  }, [r]);

  const repo = r?.raiz.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "repo";
  const filtrados = (issues ?? []).filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(busqueda.toLowerCase()));
  const elegido = filtrados[Math.min(sel, filtrados.length - 1)];

  const trabajar = async (i: Issue) => {
    if (!r || creando) return;
    setCreando(true);
    setError(null);
    try {
      const ruta = await worktreeNuevo(r.raiz, `wt-${repo}-${i.number}`, `issue-${i.number}`);
      const k = useKyu.getState();
      k.nuevoEspacio(perfil, ruta);
      useKyu.getState().ponerWorktree({ raiz: r.raiz, ruta }, `#${i.number}`);
      const espacio = useKyu.getState().activo;
      const cid = conversacionEnPanel(espacio, { alLado: true });
      const texto = `Trabaja en el issue #${i.number} de ${r.github}: «${i.title}» (${i.url}).\n\n${i.body?.trim() || "(sin descripción)"}\n\nEstás en el worktree ${ruta}, rama issue-${i.number}.`;
      useClaude.setState((s) => ({ borradores: { ...s.borradores, [cid]: texto } }));
      alCerrar();
    } catch (e) {
      setError(String(e));
      setCreando(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/30 pt-16" onMouseDown={alCerrar}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="h-fit w-[520px] overflow-hidden rounded-[10px] border border-borde2 bg-tarjeta text-[12.5px] shadow-[0_24px_60px_-16px_#000]"
      >
        <input
          ref={entrada}
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") alCerrar();
            else if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, filtrados.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            else if (e.key === "Enter" && elegido) void trabajar(elegido);
          }}
          placeholder={`Trabajar en un issue · ${r?.github ?? ""}`}
          className="w-full border-b border-borde bg-transparent px-3 py-2.5 text-texto outline-none placeholder:text-muy"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {!issues && !error && (
            <p className="flex items-center gap-2 px-3 py-3 text-tenue">
              <Loader2 size={13} className="animate-spin" /> Leyendo los issues…
            </p>
          )}
          {issues && !filtrados.length && <p className="px-3 py-3 text-tenue">{issues.length ? "Ninguno encaja." : "No hay issues abiertos."}</p>}
          {filtrados.map((i, n) => (
            <button
              key={i.number}
              type="button"
              onMouseEnter={() => setSel(n)}
              onClick={() => void trabajar(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-[7px] text-left ${i === elegido ? "bg-hover text-texto" : "text-tenue"}`}
            >
              <span className="w-10 flex-none font-mono text-[11.5px] text-acento2">#{i.number}</span>
              <CircleDot size={12} strokeWidth={1.8} className="flex-none text-ok" />
              <span className="min-w-0 truncate">{i.title}</span>
            </button>
          ))}
        </div>
        {elegido && (
          <div className="flex flex-col gap-1.5 border-t border-borde px-3 py-2.5 text-[12px] text-tenue">
            <span className="flex items-center gap-2">
              <GitBranch size={12} strokeWidth={1.8} />
              worktree <code className="rounded bg-[#17151f] px-1.5 font-mono text-[11.5px] text-acento2">wt-{repo}-{elegido.number}</code> en la rama{" "}
              <code className="rounded bg-[#17151f] px-1.5 font-mono text-[11.5px] text-acento2">issue-{elegido.number}</code>
            </span>
            <span className="flex items-center gap-2">
              <Mascota alto={9} /> espacio nuevo con una conversación que ya trae el issue (la mandas tú)
            </span>
          </div>
        )}
        {creando && (
          <p className="flex items-center gap-2 border-t border-borde px-3 py-2 text-tenue">
            <Loader2 size={13} className="animate-spin" /> Creando el worktree…
          </p>
        )}
        {error && <p className="border-t border-borde px-3 py-2 text-mal">{error}</p>}
      </div>
    </div>
  );
}
