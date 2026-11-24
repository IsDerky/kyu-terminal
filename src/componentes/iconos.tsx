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
