// Color e icono puestos a mano en una pestaña de terminal (menú de la pestaña).
import {
  Bug,
  Cloud,
  Code,
  Database,
  Flame,
  Globe,
  Hammer,
  Package,
  Rocket,
  Server,
  Shield,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { create } from "zustand";

export const COLORES: { id: string; nombre: string; valor: string }[] = [
  { id: "morado", nombre: "Morado", valor: "#a78bfa" },
  { id: "azul", nombre: "Azul", valor: "#60a5fa" },
  { id: "cian", nombre: "Cian", valor: "#67e8f9" },
  { id: "verde", nombre: "Verde", valor: "#4ade80" },
  { id: "ambar", nombre: "Ámbar", valor: "#fbbf24" },
  { id: "naranja", nombre: "Naranja", valor: "#fb923c" },
  { id: "rojo", nombre: "Rojo", valor: "#f87171" },
  { id: "rosa", nombre: "Rosa", valor: "#f472b6" },
];

export const ICONOS: { id: string; nombre: string; icono: LucideIcon }[] = [
  { id: "terminal", nombre: "Terminal", icono: SquareTerminal },
  { id: "servidor", nombre: "Servidor", icono: Server },
  { id: "base", nombre: "Base de datos", icono: Database },
  { id: "web", nombre: "Web", icono: Globe },
  { id: "codigo", nombre: "Código", icono: Code },
  { id: "error", nombre: "Depurar", icono: Bug },
  { id: "cohete", nombre: "Despliegue", icono: Rocket },
  { id: "fuego", nombre: "Producción", icono: Flame },
  { id: "paquete", nombre: "Paquete", icono: Package },
  { id: "nube", nombre: "Nube", icono: Cloud },
  { id: "martillo", nombre: "Build", icono: Hammer },
  { id: "escudo", nombre: "Seguridad", icono: Shield },
];

export const colorDe = (id?: string) => COLORES.find((c) => c.id === id)?.valor;
export const iconoDe = (id?: string) => ICONOS.find((i) => i.id === id)?.icono;

/** Selector abierto (uno a la vez), en el punto del clic. */
export const useSelectorEstilo = create<{
  abierto: { item: string; x: number; y: number } | null;
  abrir: (item: string, x: number, y: number) => void;
  cerrar: () => void;
}>((set) => ({
  abierto: null,
  abrir: (item, x, y) => set({ abierto: { item, x, y } }),
  cerrar: () => set({ abierto: null }),
}));
