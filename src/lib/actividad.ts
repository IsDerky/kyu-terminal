// Lo que pasa en cada terminal para enseñarlo en su pestaña: la orden que corre
// (con su nombre corto en vez de la carpeta) y, si acabó sin estar a la vista,
// cómo acabó, hasta que se abre la pestaña.
import { create } from "zustand";
import { paneles, useKyu } from "./estado";

export interface Actividad {
  nombre: string;
  estado: "corre" | "ok" | "mal";
}

interface Tienda {
  porItem: Record<string, Actividad>;
  poner: (item: string, a: Actividad) => void;
  quitar: (item: string) => void;
}

export const useActividad = create<Tienda>((set) => ({
  porItem: {},
  poner: (item, a) => set((s) => ({ porItem: { ...s.porItem, [item]: a } })),
  quitar: (item) =>
    set((s) => {
      if (!(item in s.porItem)) return s;
      const { [item]: _, ...resto } = s.porItem;
      return { porItem: resto };
    }),
}));

// Lanzadores y herramientas cuyo nombre solo no dice nada: se queda también la siguiente palabra.
const CON_SUBORDEN = new Set([
  "npm", "pnpm", "yarn", "bun", "npx", "pnpx", "bunx", "deno", "cargo", "go", "git", "gh", "docker",
  "kubectl", "uv", "pip", "python", "python3", "py", "node", "dotnet", "make", "just", "terraform",
  "ansible-playbook", "ssh", "wsl", "tauri", "next", "vite",
]);

/** «pnpm run dev -- --port 3000» → «pnpm dev»; «C:\\x\\ssh.exe n1» → «ssh n1». */
export function nombreCorto(orden: string): string {
  const palabras = orden
    .trim()
    .split(/\s+/)
    .filter((p) => !/^[A-Z_][A-Z0-9_]*=/.test(p)); // VAR=valor delante
  if (!palabras.length) return "";
  const limpia = (p: string) => p.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/i, "");
  const primera = limpia(palabras[0]);
  let nombre = primera;
  if (CON_SUBORDEN.has(primera.toLowerCase())) {
    const resto = palabras.slice(1).filter((p) => !p.startsWith("-"));
    const siguiente = resto[0] === "run" || resto[0] === "exec" ? resto[1] : resto[0];
    if (siguiente) nombre += ` ${limpia(siguiente)}`;
  }
  return nombre.length > 24 ? `${nombre.slice(0, 23)}…` : nombre;
}

/** La pestaña se está viendo: es la activa de su panel y su espacio es el activo. */
export function aLaVista(item: string): boolean {
  const s = useKyu.getState();
  const esp = s.espacios.find((e) => e.id === s.activo);
  if (!esp || s.ajustes || s.uso) return false;
  return paneles(esp.raiz).some((p) => p.activo === item) && document.visibilityState === "visible";
}
