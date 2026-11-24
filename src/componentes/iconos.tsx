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
