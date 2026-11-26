// Otros agentes por ACP (Antigravity…): lo último que dijo cada uno de sus opciones y comandos,
// para tener los menús antes de arrancarlo, y lo elegido la última vez.
import type { Comando } from "./claudeOpciones";
import type { OpcionAgente } from "./nucleo";

export interface CatalogoAgente {
  opciones: OpcionAgente[];
  comandos: Comando[];
}

const claveCatalogo = (agente: string) => `kyu:agente:${agente}`;
const claveAjustes = (agente: string) => `kyu:agente:${agente}:ajustes`;

function leer<T>(clave: string, vacio: T): T {
  try {
    return (JSON.parse(localStorage.getItem(clave) ?? "null") as T | null) ?? vacio;
  } catch {
    return vacio;
  }
}

export const catalogoAgente = (agente: string): CatalogoAgente => {
  const c = leer<Partial<CatalogoAgente>>(claveCatalogo(agente), {});
  return { opciones: c.opciones ?? [], comandos: c.comandos ?? [] };
};

export function guardarCatalogoAgente(agente: string, parte: Partial<CatalogoAgente>) {
  try {
    localStorage.setItem(claveCatalogo(agente), JSON.stringify({ ...catalogoAgente(agente), ...parte }));
  } catch {
    // Sin sitio: los menús saldrán al arrancar el agente.
  }
}

export const ajustesGuardados = (agente: string) => leer<Record<string, string>>(claveAjustes(agente), {});

export function guardarAjustes(agente: string, ajustes: Record<string, string>) {
  try {
    localStorage.setItem(claveAjustes(agente), JSON.stringify(ajustes));
  } catch {
    // Se pierde la preferencia, nada más.
  }
}

/** Las opciones con lo elegido encima (antes de arrancar, el agente aún no las ha puesto). */
export function opcionesVistas(opciones: OpcionAgente[], ajustes: Record<string, string>): OpcionAgente[] {
  return opciones.map((o) => {
    const v = ajustes[o.id];
    return v !== undefined && v !== o.actual && o.valores.some((x) => x.valor === v) ? { ...o, actual: v } : o;
  });
}

/** La opción de una categoría (model, thought_level, mode) o, si no la trae, la de ese id. */
export const opcionPor = (lista: OpcionAgente[], cual: string) =>
  lista.find((o) => o.categoria === cual) ?? lista.find((o) => o.id === cual);

export const nombreValor = (o: OpcionAgente | undefined) => (o ? (o.valores.find((v) => v.valor === o.actual)?.nombre ?? o.actual) : "");
