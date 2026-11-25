// Qué cuentas de Claude tienen la sesión iniciada (`claude auth status` de cada una). Se
// mira al abrir Kyu y al tocar las cuentas en Ajustes; el pie desactiva las que no.
import { create } from "zustand";
import { cuentasClaude } from "./nucleo";

interface Tienda {
  /** null = aún no se ha mirado. */
  porCuenta: Record<string, boolean> | null;
}

export const useSesiones = create<Tienda>(() => ({ porCuenta: null }));

export async function cargarSesiones(): Promise<Record<string, boolean>> {
  const lista = await cuentasClaude().catch(() => []);
  const porCuenta = Object.fromEntries(lista.map((c) => [c.nombre, c.sesion]));
  useSesiones.setState({ porCuenta });
  return porCuenta;
}
