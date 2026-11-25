// Git y GitHub del espacio activo: rama, cambios y CI para la barra de estado (59), la pestaña
// «Cambios» (60), los avisos de CI (62), los enlaces a commits (64) y los issues (63).
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { create } from "zustand";
import { carpetaDelEspacio } from "./claude";
import { useKyu } from "./estado";

export interface ResumenGit {
  raiz: string;
  rama: string;
  delante: number;
  detras: number;
  cambios: number;
  /** «dueño/repo» si origin está en GitHub. */
  github: string | null;
}

export interface Cambio {
  ruta: string;
  estado: "M" | "A" | "D" | "R" | "?";
}

export interface Run {
  databaseId: number;
  status: string;
  conclusion: string;
  workflowName: string;
  headBranch: string;
  displayTitle: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface AvisoCI {
  id: number;
  run: Run;
  repo: string;
}

export const resumenGit = (carpeta: string) => invoke<ResumenGit | null>("git_resumen", { carpeta });
export const cambiosGit = (raiz: string) => invoke<Cambio[]>("git_cambios", { raiz });
export const diffGit = (raiz: string, ruta: string) => invoke<string>("git_diff", { raiz, ruta });
export const commitGit = (raiz: string, mensaje: string, rutas: string[], subir: boolean) =>
  invoke<string>("git_commit", { raiz, mensaje, rutas, subir });
export const subirGit = (raiz: string) => invoke<string>("git_subir", { raiz });
export const runsGh = (raiz: string) => invoke<Run[]>("gh_runs", { raiz });
export const issuesGh = (raiz: string) => invoke<Issue[]>("gh_issues", { raiz });
export const worktreeNuevo = (raiz: string, nombre: string, rama: string) =>
  invoke<string>("git_worktree_nuevo", { raiz, nombre, rama });
export const worktreeQuitar = (raiz: string, ruta: string) => invoke("git_worktree_quitar", { raiz, ruta });
export const esCommit = (raiz: string, hash: string) => invoke<boolean>("git_es_commit", { raiz, hash });
export const mensajeCommit = (raiz: string, diff: string) =>
  invoke<string>("claude_mensaje_commit", { raiz, diff });

const enCurso = (r: Run) => r.status !== "completed";

interface EstadoGit {
  /** Repo de la carpeta del espacio activo (null = no es un repo). */
  resumen: ResumenGit | null;
  /** Runs recientes por raíz de repo. */
  runs: Record<string, Run[]>;
  avisos: AvisoCI[];
  quitarAviso: (id: number) => void;
}

export const useGit = create<EstadoGit>((set) => ({
  resumen: null,
  runs: {},
  avisos: [],
  quitarAviso: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),
}));

/** El último run de la rama (para la barra). */
export function runDeRama(runs: Run[] | undefined, rama: string) {
  return runs?.find((r) => r.headBranch === rama);
}

let contador = 0;
/** Runs que se vieron sin acabar: al acabar, aviso. */
const vigilados = new Map<number, string>();

async function avisarWindows(r: Run) {
  const ventana = getCurrentWindow();
  const delante = (await ventana.isFocused().catch(() => true)) && !(await ventana.isMinimized().catch(() => false));
  if (delante || !(await isPermissionGranted().catch(() => false))) return;
  const bien = r.conclusion === "success";
  sendNotification({
    title: `${bien ? "CI en verde" : r.conclusion === "cancelled" ? "CI cancelado" : "CI en rojo"} · ${r.workflowName}`,
    body: `${r.headBranch} · ${r.displayTitle}`,
  });
}

async function refrescarRuns(raiz: string) {
  const lista = await runsGh(raiz).catch(() => null);
  if (!lista) return;
  for (const r of lista) {
    if (enCurso(r)) vigilados.set(r.databaseId, raiz);
    else if (vigilados.get(r.databaseId) === raiz) {
      vigilados.delete(r.databaseId);
      useGit.setState((s) => ({ avisos: [...s.avisos.filter((a) => a.run.databaseId !== r.databaseId), { id: ++contador, run: r, repo: raiz }] }));
      void avisarWindows(r);
    }
  }
  useGit.setState((s) => ({ runs: { ...s.runs, [raiz]: lista } }));
}

let ultimoRuns = 0;
let prisaHasta = 0;
let ocupado = false;

/** Una vuelta: el repo del espacio activo y, cada poco, sus runs (más a menudo si hay alguno en marcha). */
async function vuelta() {
  if (ocupado) return;
  ocupado = true;
  try {
    const k = useKyu.getState();
    const carpeta = k.activo ? carpetaDelEspacio(k.activo) : null;
    const r = carpeta ? await resumenGit(carpeta).catch(() => null) : null;
    const antes = useGit.getState().resumen;
    if (JSON.stringify(antes) !== JSON.stringify(r)) useGit.setState({ resumen: r });
    // Repos con runs en marcha (aunque ya no sean el del espacio activo) + el activo.
    const raices = new Set<string>(vigilados.values());
    if (r?.github) raices.add(r.raiz);
    const ahora = Date.now();
    // Tras un push (lo que iba por delante pasa a 0) el run tarda en salir: dos minutos de prisa.
    const empujado = antes && r && antes.raiz === r.raiz && antes.delante > 0 && r.delante === 0;
    if (empujado) prisaHasta = ahora + 120_000;
    const prisa = vigilados.size > 0 || ahora < prisaHasta;
    if (raices.size && (empujado || ahora - ultimoRuns > (prisa ? 10_000 : 30_000))) {
      ultimoRuns = ahora;
      await Promise.all([...raices].map(refrescarRuns));
    }
  } finally {
    ocupado = false;
  }
}

/** Se arranca una vez: cada 3 s mira el repo del espacio activo. */
export function vigilarGit() {
  void vuelta();
  const t = setInterval(() => void vuelta(), 3000);
  return () => clearInterval(t);
}

/** Fuerza una vuelta ya (tras un commit, un push o cambiar de espacio). */
export const refrescarGit = (trasPush = false) => {
  ultimoRuns = 0;
  if (trasPush) prisaHasta = Date.now() + 120_000;
  void vuelta();
};
