// Uso real de cada cuenta de Claude (sesión de 5 h y semana), tal como lo manda Claude Code en
// cada turno (`rate_limit_event`). Se guarda el último dato de cada cuenta para enseñarlo
// también antes de escribir y para proponer la otra cuenta al llegar al límite.
import { create } from "zustand";

export interface Ventana {
  /** De 0 a 1. */
  uso: number;
  /** Segundos Unix; 0 = no se sabe. */
  reinicio: number;
  estado: string;
}

export interface Limite {
  estado: string;
  sesion: Ventana | null;
  semana: Ventana | null;
  /** Cuándo llegó (ms). */
  hora: number;
}

const CLAVE = "kyu:limites";

function leer(): Record<string, Limite> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, Limite>;
  } catch {
    return {};
  }
}

export const useLimites = create<{ porCuenta: Record<string, Limite> }>(() => ({ porCuenta: leer() }));

/** Nombre con el que se guarda: la cuenta elegida o, sin elegir, la primera (la de siempre). */
export const claveCuenta = (cuenta: string | null, cuentas: string[]) => cuenta ?? cuentas[0] ?? "";

export function apuntarLimite(cuenta: string, l: Omit<Limite, "hora">) {
  useLimites.setState((s) => {
    const porCuenta = { ...s.porCuenta, [cuenta]: { ...l, hora: Date.now() } };
    try {
      localStorage.setItem(CLAVE, JSON.stringify(porCuenta));
    } catch {
      // Sin almacenamiento solo se pierde el dato al cerrar.
    }
    return { porCuenta };
  });
}

/** La ventana, si no se ha reiniciado ya desde que llegó el dato. */
export function vigente(v: Ventana | null | undefined): Ventana | null {
  if (!v) return null;
  return v.reinicio && v.reinicio * 1000 <= Date.now() ? null : v;
}

/** La que más aprieta de las dos (para el pie y para avisar). */
export function peor(l: Limite | undefined): { nombre: "sesion" | "semana"; v: Ventana } | null {
  const s = vigente(l?.sesion);
  const w = vigente(l?.semana);
  if (!s && !w) return null;
  if (s && (!w || s.uso >= w.uso)) return { nombre: "sesion", v: s };
  return { nombre: "semana", v: w! };
}

/** Al 90 % o rechazada: toca cambiar de cuenta. */
export function agotada(l: Limite | undefined) {
  const p = peor(l);
  const rechazada = l?.estado === "rejected" && (vigente(l.sesion) || vigente(l.semana));
  return !!rechazada || (p !== null && p.v.uso >= 0.9);
}

export const porcentaje = (v: Ventana) => Math.round(Math.min(1, Math.max(0, v.uso)) * 100);

/** «15:30» si es hoy; «mañana 15:30»; «lun 10:00» si es más tarde. */
export function horaReinicio(segundos: number) {
  if (!segundos) return "";
  const d = new Date(segundos * 1000);
  const hora = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const hoy = new Date();
  const mañana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  if (d.toDateString() === hoy.toDateString()) return hora;
  if (d.toDateString() === mañana.toDateString()) return `mañana ${hora}`;
  return `${d.toLocaleDateString("es-ES", { weekday: "short" })} ${hora}`;
}

/** «Sesión de 5 h: 31 % (se reinicia a las 15:30) · Semana: 4 % (…)». */
export function describir(l: Limite | undefined) {
  const parte = (nombre: string, v: Ventana | null) =>
    v ? `${nombre}: ${porcentaje(v)} %${v.reinicio ? ` (se reinicia ${horaReinicio(v.reinicio)})` : ""}` : null;
  return [parte("Sesión de 5 h", vigente(l?.sesion)), parte("Semana", vigente(l?.semana))].filter(Boolean).join(" · ");
}
