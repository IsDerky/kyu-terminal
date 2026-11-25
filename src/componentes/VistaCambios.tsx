import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Check, GitCommitHorizontal, Loader2, RefreshCw } from "lucide-react";
import { cambiosGit, commitGit, diffGit, mensajeCommit, refrescarGit, useGit, type Cambio } from "../lib/git";
import { enviar, nuevaConversacion } from "../lib/claude";
import { Mascota } from "./iconos";

const COLOR: Record<Cambio["estado"], string> = {
  M: "text-aviso",
  A: "text-ok",
  "?": "text-ok",
  D: "text-mal",
  R: "text-acento2",
};
const LETRA: Record<Cambio["estado"], string> = { M: "M", A: "A", "?": "U", D: "D", R: "R" };

const REVISAR =
  "Revisa mis cambios sin commit de este repo (git status, git diff HEAD y los archivos nuevos) antes de hacer commit: " +
  "busca fallos, cosas a medias y lo que se me haya colado. No cambies nada; dime lo que encuentres, de más grave a menos.";

/**
 * Pestaña «Cambios»: lo que hay sin commit en el repo, con el diff de cada archivo. Claude
 * propone el mensaje (Haiku, una vuelta) o revisa los cambios en una conversación; commit y push.
 */
export default function VistaCambios({ raiz, espacio }: { raiz: string; espacio: string }) {
  const [lista, setLista] = useState<Cambio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [fuera, setFuera] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [trabajando, setTrabajando] = useState<null | "mensaje" | "commit">(null);
  const [aviso, setAviso] = useState<{ bien: boolean; texto: string } | null>(null);
  const resumen = useGit((s) => s.resumen);
  const nombreRepo = raiz.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

  const cargar = () =>
    cambiosGit(raiz).then(
      (l) => {
        setLista(l);
        setError(null);
        setElegido((e) => (e && l.some((c) => c.ruta === e) ? e : (l[0]?.ruta ?? null)));
      },
      (e) => setError(String(e)),
    );

  // Al día cada 3 s (lo que se cambie en los terminales o lo que haga Claude).
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiz]);

  useEffect(() => {
    if (!elegido) return setDiff("");
    let vivo = true;
    diffGit(raiz, elegido).then(
      (d) => vivo && setDiff(d),
      (e) => vivo && setDiff(`(no se pudo leer el diff: ${e})`),
    );
    return () => {
      vivo = false;
    };
  }, [raiz, elegido, lista]);

  const marcados = useMemo(() => (lista ?? []).filter((c) => !fuera.has(c.ruta)).map((c) => c.ruta), [lista, fuera]);

  const proponer = async () => {
    setTrabajando("mensaje");
    setAviso(null);
    try {
      const partes = await Promise.all(marcados.slice(0, 40).map(async (r) => `--- ${r}\n${await diffGit(raiz, r).catch(() => "")}`));
      setMensaje(await mensajeCommit(raiz, partes.join("\n")));
    } catch (e) {
      setAviso({ bien: false, texto: `Claude no pudo proponer el mensaje: ${e}` });
    } finally {
      setTrabajando(null);
    }
  };

  const hacerCommit = async (subir: boolean) => {
    setTrabajando("commit");
    setAviso(null);
    try {
      await commitGit(raiz, mensaje.trim(), marcados, subir);
      setMensaje("");
      setFuera(new Set());
      setAviso({ bien: true, texto: subir ? "Commit hecho y subido." : "Commit hecho." });
      refrescarGit(subir);
      void cargar();
    } catch (e) {
      setAviso({ bien: false, texto: String(e) });
    } finally {
      setTrabajando(null);
    }
  };

  const revisar = () => {
    const cid = nuevaConversacion(espacio);
    void enviar(cid, REVISAR);
  };

  const todos = lista !== null && lista.length > 0 && fuera.size === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-[12.5px]">
      <div className="flex h-9 flex-none items-center gap-2 border-b border-borde px-3">
        <GitCommitHorizontal size={14} strokeWidth={1.8} className="text-tenue" />
        <span className="font-medium">{nombreRepo}</span>
        {resumen?.raiz.toLowerCase() === raiz.toLowerCase() && (
          <span className="rounded bg-[#17151f] px-1.5 font-mono text-[11.5px] text-acento2">{resumen.rama}</span>
        )}
        <span className="text-muy">{lista ? `${lista.length} ${lista.length === 1 ? "archivo" : "archivos"} sin commit` : ""}</span>
        <span className="flex-1" />
        <button type="button" title="Actualizar" onClick={() => void cargar()} className="grid size-6 place-items-center rounded text-muy hover:bg-hover hover:text-texto">
          <RefreshCw size={12} />
        </button>
      </div>

      {error && <p className="px-3 py-3 text-mal">{error}</p>}
      {lista && !lista.length && !error && (
        <div className="grid flex-1 place-items-center text-tenue">
          <span className="flex items-center gap-2">
            <Check size={14} className="text-ok" /> No hay nada sin commit.
          </span>
        </div>
      )}

      {lista && lista.length > 0 && (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[300px] min-w-0 flex-none flex-col border-r border-borde">
            <label className="flex h-8 flex-none items-center gap-2 border-b border-borde px-3 text-[11.5px] text-tenue">
              <input
                type="checkbox"
                checked={todos}
                onChange={() => setFuera(todos ? new Set(lista.map((c) => c.ruta)) : new Set())}
                className="accent-[var(--color-acento)]"
              />
              {marcados.length} de {lista.length} para el commit
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {lista.map((c) => (
                <div
                  key={c.ruta}
                  onClick={() => setElegido(c.ruta)}
                  className={`flex h-7 cursor-default items-center gap-2 px-3 ${elegido === c.ruta ? "bg-hover text-texto" : "text-tenue hover:bg-hover/60"}`}
                >
                  <input
                    type="checkbox"
                    checked={!fuera.has(c.ruta)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() =>
                      setFuera((f) => {
                        const n = new Set(f);
                        if (n.has(c.ruta)) n.delete(c.ruta);
                        else n.add(c.ruta);
                        return n;
                      })
                    }
                    className="accent-[var(--color-acento)]"
                  />
                  <span className={`w-3 flex-none font-mono text-[11px] font-semibold ${COLOR[c.estado]}`}>{LETRA[c.estado]}</span>
                  <span className="min-w-0 truncate font-mono text-[11.5px]" title={c.ruta}>
                    {c.ruta}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Diff texto={diff} />
        </div>
      )}

      {lista && lista.length > 0 && (
        <div className="flex flex-none flex-col gap-2 border-t border-borde bg-fondo p-3">
          <textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Mensaje del commit"
            rows={3}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey && mensaje.trim() && marcados.length && !trabajando) {
                e.preventDefault();
                void hacerCommit(e.shiftKey);
              }
            }}
            className="w-full resize-none rounded-lg border border-borde2 bg-panel px-2.5 py-2 font-mono text-[12px] text-texto outline-none placeholder:text-muy focus:border-[#3a3a42]"
          />
          <div className="flex items-center gap-2 text-[11.5px] text-tenue">
            <Boton onClick={() => void proponer()} desactivado={!!trabajando || !marcados.length} titulo="Claude (Haiku) escribe el mensaje a partir del diff">
              {trabajando === "mensaje" ? <Loader2 size={12} className="animate-spin" /> : <Mascota alto={9} />}
              Proponer mensaje
            </Boton>
            <Boton onClick={revisar} desactivado={false} titulo="Abre una conversación para que Claude busque fallos antes del commit">
              <Mascota alto={9} />
              Revisar con Claude
            </Boton>
            {aviso && <span className={`min-w-0 truncate ${aviso.bien ? "text-ok" : "text-mal"}`} title={aviso.texto}>{aviso.texto}</span>}
            <span className="flex-1" />
            <Boton onClick={() => void hacerCommit(false)} desactivado={!!trabajando || !mensaje.trim() || !marcados.length} titulo="Ctrl+Intro">
              {trabajando === "commit" && <Loader2 size={12} className="animate-spin" />}
              Commit
            </Boton>
            <Boton
              principal
              onClick={() => void hacerCommit(true)}
              desactivado={!!trabajando || !mensaje.trim() || !marcados.length || !resumen?.github}
              titulo="Ctrl+Mayús+Intro"
            >
              <ArrowUp size={12} strokeWidth={2.2} />
              Commit y push
            </Boton>
          </div>
        </div>
      )}
    </div>
  );
}

function Boton({
  children,
  onClick,
  desactivado,
  titulo,
  principal,
}: {
  children: React.ReactNode;
  onClick: () => void;
  desactivado: boolean;
  titulo: string;
  principal?: boolean;
}) {
  return (
    <button
      type="button"
      title={titulo}
      onClick={onClick}
      disabled={desactivado}
      className={`flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 disabled:opacity-40 ${
        principal ? "border-acento bg-acento font-semibold text-[#140f22]" : "border-borde2 text-tenue hover:bg-hover hover:text-texto"
      }`}
    >
      {children}
    </button>
  );
}

/** El diff unificado de git, con colores. */
function Diff({ texto }: { texto: string }) {
  const lineas = useMemo(() => texto.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)), [texto]);
  return (
    <div className="min-w-0 flex-1 overflow-auto py-1.5 font-mono text-[11.5px] leading-[1.6]">
      {lineas.map((l, i) => (
        <div
          key={i}
          className={`whitespace-pre px-3 ${
            l.startsWith("@@")
              ? "bg-acento/5 text-acento2"
              : l.startsWith("+")
                ? "bg-ok/[.07] text-[#bbf7d0]"
                : l.startsWith("-")
                  ? "bg-mal/[.06] text-[#fecaca]"
                  : "text-tenue"
          }`}
        >
          {l || " "}
        </div>
      ))}
    </div>
  );
}
