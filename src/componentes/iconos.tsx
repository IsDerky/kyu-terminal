import { Box, ChevronRight, FileText, Server, SquareTerminal, Terminal, type LucideIcon } from "lucide-react";
import type { Perfil } from "../lib/nucleo";

const ICONOS: Record<string, LucideIcon> = {
  powershell: Terminal,
  bash: SquareTerminal,
  linux: Box,
  cmd: ChevronRight,
  servidor: Server,
  terminal: Terminal,
};

export function IconoPerfil({ perfil, size = 13 }: { perfil?: Perfil; size?: number }) {
  const Icono = ICONOS[perfil?.icono ?? "terminal"] ?? Terminal;
  return <Icono size={size} strokeWidth={1.8} style={{ color: perfil?.color }} className="flex-none" />;
}

export function IconoArchivo({ size = 13 }: { size?: number }) {
  return <FileText size={size} strokeWidth={1.8} className="flex-none" />;
}

// Mascota de Claude Code, sacada de los caracteres de bloque con que la pinta `claude` al
// arrancar. Cada carácter son 2×2 píxeles y, como las celdas del terminal son el doble de
// altas que anchas, cada píxel mide 1×2.
const MASCOTA = [" ▐▛███▜▌", "▝▜█████▛▘", "  ▘▘ ▝▝"];
const CUADRANTES: Record<string, number[]> = {
  "█": [1, 1, 1, 1], "▐": [0, 1, 0, 1], "▌": [1, 0, 1, 0], "▛": [1, 1, 1, 0], "▜": [1, 1, 0, 1],
  "▝": [0, 1, 0, 0], "▘": [1, 0, 0, 0], "▀": [1, 1, 0, 0], "▄": [0, 0, 1, 1], "▖": [0, 0, 1, 0], "▗": [0, 0, 0, 1],
};
const PIXELES = MASCOTA.flatMap((fila, y) =>
  [...fila].flatMap((ch, x) => {
    const [a, b, c, d] = CUADRANTES[ch] ?? [0, 0, 0, 0];
    return [
      [a, 0, 0],
      [b, 1, 0],
      [c, 0, 1],
      [d, 1, 1],
    ]
      .filter(([on]) => on)
      .map(([, dx, dy]) => ({ x: x * 2 + dx, y: (y * 2 + dy) * 2 }));
  }),
);

/** `alto` en px; el ancho es 1,5 veces. */
export function Mascota({ alto = 16, color = "#d97757" }: { alto?: number; color?: string }) {
  return (
    <svg viewBox="0 0 18 12" width={alto * 1.5} height={alto} fill={color} shapeRendering="crispEdges" className="flex-none">
      {PIXELES.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={1.04} height={2.04} />
      ))}
    </svg>
  );
}

/** Logo de Kyu: cabeza de lobo maciza (el mismo dibujo que src-tauri/icons/logo.svg). */
export function LogoKyu({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="flex-none" aria-label="Kyu">
      <rect width="64" height="64" rx="14" fill="#151518" />
      <rect x=".5" y=".5" width="63" height="63" rx="13.5" fill="none" stroke="#2a2a30" />
      <path d="M13 10l11 13h16l11-13 1 19-6 9-6 4-8 15-8-15-6-4-6-9z" fill="#a78bfa" />
      <path d="M26 41l6 15 6-15-6 3z" fill="#c4b5fd" />
      <path d="M29.5 52h5l-2.5 4z" fill="#151518" />
      <path d="M21 31l7 3-7 2zM43 31l-7 3 7 2z" fill="#151518" />
    </svg>
  );
}
