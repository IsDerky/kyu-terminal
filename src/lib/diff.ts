// Diff por líneas para enseñar en los permisos de Claude lo que va a cambiar un archivo.
// LCS clásico sobre lo que queda tras quitar el principio y el final comunes; si aun así
// es enorme, se da todo como quitado + añadido (no se bloquea la ventana).

export interface Linea {
  tipo: "igual" | "quita" | "pone";
  texto: string;
  /** Número de línea en el archivo antes / después (1 = primera). */
  antes?: number;
  despues?: number;
}

export type Trozo = Linea | { tipo: "salto"; lineas: number };

const MAX_CELDAS = 4_000_000;

const partir = (t: string) => (t === "" ? [] : t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

/** Diff de `antes` → `despues`; `desde` = número de la primera línea de `antes` en el archivo. */
export function diffLineas(antes: string, despues: string, desde = 1): Linea[] {
  const a = partir(antes);
  const b = partir(despues);
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fa = a.length;
  let fb = b.length;
  while (fa > ini && fb > ini && a[fa - 1] === b[fb - 1]) (fa--, fb--);

  const medio: Array<["igual" | "quita" | "pone", string]> = [];
  const n = fa - ini;
  const m = fb - ini;
  if (n * m > MAX_CELDAS) {
    for (let i = ini; i < fa; i++) medio.push(["quita", a[i]]);
    for (let j = ini; j < fb; j++) medio.push(["pone", b[j]]);
  } else {
    // lcs[i][j] = LCS de a[ini+i..fa) y b[ini+j..fb)
    const ancho = m + 1;
    const lcs = new Uint32Array((n + 1) * ancho);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * ancho + j] =
          a[ini + i] === b[ini + j]
            ? lcs[(i + 1) * ancho + j + 1] + 1
            : Math.max(lcs[(i + 1) * ancho + j], lcs[i * ancho + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[ini + i] === b[ini + j]) (medio.push(["igual", a[ini + i]]), i++, j++);
      else if (lcs[(i + 1) * ancho + j] >= lcs[i * ancho + j + 1]) medio.push(["quita", a[ini + i++]]);
      else medio.push(["pone", b[ini + j++]]);
    }
    while (i < n) medio.push(["quita", a[ini + i++]]);
    while (j < m) medio.push(["pone", b[ini + j++]]);
  }

  const salida: Linea[] = [];
  let na = desde;
  let nb = desde;
  const poner = (tipo: Linea["tipo"], texto: string) => {
    if (tipo === "igual") salida.push({ tipo, texto, antes: na++, despues: nb++ });
    else if (tipo === "quita") salida.push({ tipo, texto, antes: na++ });
    else salida.push({ tipo, texto, despues: nb++ });
  };
  for (let k = 0; k < ini; k++) poner("igual", a[k]);
  for (const [tipo, texto] of medio) poner(tipo, texto);
  for (let k = fa; k < a.length; k++) poner("igual", a[k]);
  return salida;
}

/** Deja `contexto` líneas iguales alrededor de cada cambio y resume el resto en saltos. */
export function recortar(lineas: Linea[], contexto = 3): Trozo[] {
  const cerca = new Uint8Array(lineas.length);
  lineas.forEach((l, k) => {
    if (l.tipo === "igual") return;
    for (let d = Math.max(0, k - contexto); d <= Math.min(lineas.length - 1, k + contexto); d++) cerca[d] = 1;
  });
  const salida: Trozo[] = [];
  let saltadas = 0;
  lineas.forEach((l, k) => {
    if (cerca[k]) {
      if (saltadas) salida.push({ tipo: "salto", lineas: saltadas });
      saltadas = 0;
      salida.push(l);
    } else saltadas++;
  });
  if (saltadas) salida.push({ tipo: "salto", lineas: saltadas });
  return salida;
}

export const contar = (lineas: Linea[]) => ({
  puestas: lineas.filter((l) => l.tipo === "pone").length,
  quitadas: lineas.filter((l) => l.tipo === "quita").length,
});
