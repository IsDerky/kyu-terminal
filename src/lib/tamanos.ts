// Tamaños de cada división (id → {id del hijo: %}), según los va dejando el ratón.
// Cuando el árbol cambia de forma (dividir, cerrar, juntar), un hijo puede cambiar de id:
// aquí se le pasa el tamaño del que sustituye para que el resto del reparto no se pierda.

export const tamanos = new Map<string, Record<string, number>>();

/** `nuevo` ocupa el sitio de `viejo` en su división (con su mismo %). */
export function heredar(viejo: string, nuevo: string) {
  for (const [division, reparto] of tamanos) {
    if (!(viejo in reparto)) continue;
    const { [viejo]: parte, ...resto } = reparto;
    tamanos.set(division, { ...resto, [nuevo]: parte });
  }
}

/** La división `hijo` se deshace dentro de `padre`: sus hijos se reparten el % que tenía. */
export function aplanar(padre: string, hijo: string, nietos: string[], tamanosHijo?: number[]) {
  const reparto = tamanos.get(padre);
  const parte = reparto?.[hijo];
  if (!reparto || parte === undefined) return;
  const propios = tamanos.get(hijo);
  const pesos = nietos.map((n, i) => propios?.[n] ?? tamanosHijo?.[i] ?? 100 / nietos.length);
  const total = pesos.reduce((a, b) => a + b, 0) || 1;
  const { [hijo]: _, ...resto } = reparto;
  nietos.forEach((n, i) => (resto[n] = (parte * pesos[i]) / total));
  tamanos.set(padre, resto);
}

/** Reparto para montar una división: lo último conocido, `guardados` (al restaurar) o a partes iguales. */
export function repartoInicial(division: string, hijos: string[], guardados?: number[]): Record<string, number> {
  const conocido = tamanos.get(division);
  const valores = hijos.map((h, i) => conocido?.[h] ?? (guardados?.length === hijos.length ? guardados[i] : undefined));
  const sabidos = valores.filter((v): v is number => v !== undefined && v > 0);
  // Los hijos nuevos sin tamaño se llevan lo que falte hasta 100 (o una parte igual si no falta nada)
  const faltan = valores.length - sabidos.length;
  const suma = sabidos.reduce((a, b) => a + b, 0);
  const hueco = !faltan ? 0 : suma < 99 ? (100 - suma) / faltan : suma / sabidos.length;
  const crudo = valores.map((v) => (v !== undefined && v > 0 ? v : hueco || 100 / hijos.length));
  const total = crudo.reduce((a, b) => a + b, 0);
  return Object.fromEntries(hijos.map((h, i) => [h, (crudo[i] * 100) / total]));
}
