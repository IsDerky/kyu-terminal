// Límite de gasto diario de Claude: tokens de salida de hoy (todos los proyectos, también lo
// de VS Code: sale de los .jsonl de Claude Code, como la pantalla de Uso) frente al límite de
// kyu.toml. Avisa una vez al día al pasar el 80 % y el 100 %. No bloquea nada.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface EstadoGasto {
  /** Límite en tokens de salida al día (0 = sin límite). */
  limite: number;
  /** Tokens de salida de hoy. */
  hoy: number;
  /** Aviso flotante pendiente de ver (80 o 100). */
  aviso: { nivel: 80 | 100; hoy: number; limite: number } | null;
}

export const useGasto = create<EstadoGasto>(() => ({ limite: 0, hoy: 0, aviso: null }));

const CLAVE_AVISADO = "kyu:gasto-avisado";
const hoyFecha = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD local

let reloj: ReturnType<typeof setInterval> | null = null;

/** Desde la configuración (miles de tokens; 0 = sin límite). */
export function configurarLimite(miles: number) {
  useGasto.setState({ limite: Math.max(0, miles) * 1000 });
  if (miles > 0 && !reloj) {
    void refrescarGasto();
    reloj = setInterval(() => void refrescarGasto(), 60_000);
  } else if (miles <= 0 && reloj) {
    clearInterval(reloj);
    reloj = null;
  }
}

interface Dia {
  fecha: string;
  salida: number;
}

/** Vuelve a contar lo de hoy (al acabar cada turno y cada minuto). */
export async function refrescarGasto() {
  const { limite } = useGasto.getState();
  if (!limite) return;
  try {
    const r = await invoke<{ dias: Dia[] }>("uso_leer", { dias: 1, desfaseMin: new Date().getTimezoneOffset() });
    const hoy = r.dias.at(-1)?.salida ?? 0;
    useGasto.setState({ hoy });
    // Un aviso por umbral y día.
    const nivel = hoy >= limite ? 100 : hoy >= limite * 0.8 ? 80 : null;
    if (!nivel) return;
    const marca = `${hoyFecha()}:${nivel}`;
    const avisados = (localStorage.getItem(CLAVE_AVISADO) ?? "").split(",");
    if (avisados.includes(marca)) return;
    localStorage.setItem(CLAVE_AVISADO, [...avisados.filter((a) => a.startsWith(hoyFecha())), marca].join(","));
    useGasto.setState({ aviso: { nivel, hoy, limite } });
  } catch {
    // Sin datos de uso: la barrita se queda como estaba.
  }
}

/** «12,4 k», «1,2 M». */
export function corto(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} M`;
  if (n >= 1000) return `${(n / 1000).toLocaleString("es-ES", { maximumFractionDigits: n >= 100_000 ? 0 : 1 })} k`;
  return String(n);
}
