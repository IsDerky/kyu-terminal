import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowDown, ArrowUp, Check, CircleDot, FileDiff, GitBranch, Loader2, X } from "lucide-react";
import { refrescarGit, runDeRama, subirGit, useGit, type Run } from "../lib/git";
import { useKyu } from "../lib/estado";

/** Icono de un run de CI: girando mientras corre, verde, rojo o gris (cancelado). */
export function IconoRun({ run, size = 11 }: { run: Run; size?: number }) {
  if (run.status !== "completed") return <Loader2 size={size} className="animate-spin text-claude2" />;
  if (run.conclusion === "success") return <Check size={size + 1} strokeWidth={2.2} className="text-ok" />;
  if (run.conclusion === "cancelled" || run.conclusion === "skipped") return <X size={size + 1} className="text-muy" />;
  return <X size={size + 1} strokeWidth={2.2} className="text-mal" />;
}

/**
 * Barra de abajo con el git del terminal con el foco: rama, lo que va por delante o detrás de
 * origin, los cambios sin commit (abren la pestaña «Cambios») y el CI de esa rama.
 */
export default function BarraEstado({ alIssues }: { alIssues: () => void }) {
  const r = useGit((s) => s.resumen);
  const runs = useGit((s) => (r ? s.runs[r.raiz] : undefined));
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!r) return null;
  const deRama = runDeRama(runs, r.rama);
  // Otros runs en marcha del repo (una release por etiqueta, otra rama).
  const otros = (runs ?? []).filter((x) => x.status !== "completed" && x !== deRama).slice(0, 2);

  const subir = async () => {
    setSubiendo(true);
    setError(null);
    try {
      await subirGit(r.raiz);
      refrescarGit(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <footer className="flex h-6 flex-none items-center gap-3.5 border-t border-borde bg-barra px-3 text-[11.5px] text-tenue">
      <span className="flex items-center gap-1.5" title={r.raiz}>
        <GitBranch size={12} strokeWidth={1.8} />
        <span className="max-w-48 truncate text-texto/90">{r.rama}</span>
      </span>
      {(r.delante > 0 || r.detras > 0) && (
        <button
          type="button"
          title={r.delante > 0 ? `${r.delante} commit(s) sin subir · clic para hacer push` : `${r.detras} commit(s) por bajar (git pull)`}
          onClick={() => r.delante > 0 && !subiendo && void subir()}
          className={`flex items-center gap-1 rounded px-1 ${r.delante > 0 ? "hover:bg-hover hover:text-texto" : "cursor-default"}`}
        >
          {subiendo ? <Loader2 size={11} className="animate-spin" /> : <ArrowUp size={11} strokeWidth={2} />}
          {r.delante}
          <ArrowDown size={11} strokeWidth={2} className="ml-0.5" />
          {r.detras}
        </button>
      )}
      <button
        type="button"
        title="Cambios sin commit: diff y commit"
        onClick={() => useKyu.getState().abrirCambios(r.raiz)}
        className={`flex items-center gap-1.5 rounded px-1 hover:bg-hover hover:text-texto ${r.cambios ? "" : "text-muy"}`}
      >
        <FileDiff size={12} strokeWidth={1.8} />
        {r.cambios ? `${r.cambios} ${r.cambios === 1 ? "cambio" : "cambios"}` : "sin cambios"}
      </button>
      {r.github &&
        [deRama, ...otros].map(
          (run) =>
            run && (
              <button
                key={run.databaseId}
                type="button"
                title={`${run.workflowName} · ${run.headBranch} · ${run.displayTitle} · clic para verlo en GitHub`}
                onClick={() => void openUrl(run.url)}
                className="flex items-center gap-1.5 rounded px-1 hover:bg-hover hover:text-texto"
              >
                <IconoRun run={run} />
                {run.workflowName}
                {run.headBranch !== r.rama && <span className="text-muy">{run.headBranch}</span>}
              </button>
            ),
        )}
      {error && (
        <span className="min-w-0 truncate text-mal" title={error}>
          {error}
        </span>
      )}
      <span className="flex-1" />
      {r.github && (
        <button
          type="button"
          title="Trabajar en un issue: worktree, espacio y conversación"
          onClick={alIssues}
          className="flex items-center gap-1.5 rounded px-1 hover:bg-hover hover:text-texto"
        >
          <CircleDot size={11} strokeWidth={1.8} />
          Issues
        </button>
      )}
      {r.github && (
        <button
          type="button"
          title={`Abrir ${r.github} en GitHub`}
          onClick={() => void openUrl(`https://github.com/${r.github}`)}
          className="rounded px-1 text-muy hover:bg-hover hover:text-texto"
        >
          {r.github}
        </button>
      )}
    </footer>
  );
}
