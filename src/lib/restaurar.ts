// Restaurar la sesión: al cambiar algo se guarda (localStorage, con un momento de espera)
// qué espacios, paneles y pestañas hay, y la conversación de Claude de cada espacio; al
// abrir Kyu se vuelve a montar todo. Las shells son nuevas (en su carpeta), no las de antes.
import { nuevoId, paneles, useKyu, type Direccion, type Espacio, type Item, type Nodo } from "./estado";
import { activarPestana, nuevaDePanel, nuevaPestana, pestanasDe, reanudar, useClaude } from "./claude";
import { leerArchivo } from "./nucleo";

const CLAVE = "kyu:sesion";
const ESPERA = 800;

/** Tamaños de cada división (id → {id del hijo: %}), según los va dejando el ratón. */
export const tamanos = new Map<string, Record<string, number>>();

type ItemGuardado =
  | { tipo: "terminal"; perfil: string; carpeta: string | null; titulo: string }
  | { tipo: "archivo"; ruta: string; linea: number; columna: number }
  | { tipo: "arbol" }
  /** Conversación en una pestaña de panel (sin `conv`: estaba vacía, vuelve vacía). */
  | { tipo: "claude"; conv?: ConversacionGuardada };

type NodoGuardado =
  | { tipo: "panel"; items: ItemGuardado[]; activo: number; foco?: boolean }
  | { tipo: "division"; dir: Direccion; hijos: NodoGuardado[]; tamanos?: number[] };

interface ConversacionGuardada {
  sesion: string;
  carpeta: string;
  titulo: string;
  /** Cuenta de Claude con la que iba (sin poner = la de siempre). */
  cuenta?: string;
}

interface EspacioGuardado {
  nombre: string | null;
  raiz: NodoGuardado;
  /** Antes de las pestañas de conversación (se sigue leyendo). */
  claude?: ConversacionGuardada;
  /** Conversaciones del espacio, en orden, y la que se veía. */
  claudes?: ConversacionGuardada[];
  claudeActiva?: number;
}

interface SesionGuardada {
  version: 1;
  activo: number;
  claudeVisible: boolean;
  expandido?: boolean;
  espacios: EspacioGuardado[];
}

// ---------- Guardar ----------

/** Lo que hace falta para volver a cargar una conversación; null si no tiene nada dentro. */
function guardarConversacion(cid: string, c = useClaude.getState()): ConversacionGuardada | null {
  const conv = c.conversaciones[cid];
  const primero = conv?.entradas.find((x) => x.tipo === "tu");
  if (!conv?.sesion || !conv.carpeta || primero?.tipo !== "tu") return null;
  return {
    sesion: conv.sesion,
    carpeta: conv.carpeta,
    titulo: primero.texto.split("\n")[0].slice(0, 60),
    cuenta: conv.cuenta ?? undefined,
  };
}

function guardarNodo(n: Nodo, items: Record<string, Item>, foco: string): NodoGuardado | null {
  if (n.tipo === "panel") {
    // Los terminales que abre Claude (MCP) son de esa conversación: no vuelven.
    const ids = n.items.filter((i) => items[i] && !(items[i].tipo === "terminal" && items[i].deClaude));
    if (!ids.length) return null;
    const lista = ids.map((i): ItemGuardado => {
      const it = items[i];
      if (it.tipo === "arbol") return { tipo: "arbol" };
      if (it.tipo === "claude") return { tipo: "claude", conv: guardarConversacion(it.cid) ?? undefined };
      return it.tipo === "terminal"
        ? { tipo: "terminal", perfil: it.perfil, carpeta: it.carpeta, titulo: it.titulo }
        : { tipo: "archivo", ruta: it.ruta, linea: it.linea, columna: it.columna };
    });
    return { tipo: "panel", items: lista, activo: Math.max(0, ids.indexOf(n.activo ?? "")), foco: n.id === foco || undefined };
  }
  const conTamano = n.hijos.map((h) => ({ h, g: guardarNodo(h, items, foco) })).filter((x) => x.g !== null);
  if (!conTamano.length) return null;
  if (conTamano.length === 1) return conTamano[0].g;
  const medidas = tamanos.get(n.id);
  const lista = medidas ? conTamano.map((x) => medidas[x.h.id]) : [];
  const valen = lista.length === conTamano.length && lista.every((v) => typeof v === "number" && v > 0);
  return { tipo: "division", dir: n.dir, hijos: conTamano.map((x) => x.g!), tamanos: valen ? lista : undefined };
}

function foto(): SesionGuardada {
  const k = useKyu.getState();
  const c = useClaude.getState();
  const espacios: EspacioGuardado[] = [];
  let activo = 0;
  for (const e of k.espacios) {
    const raiz = guardarNodo(e.raiz, k.items, e.foco);
    if (!raiz) continue;
    if (e.id === k.activo) activo = espacios.length;
    // Las conversaciones con algo dentro (las vacías no vuelven).
    const claudes: ConversacionGuardada[] = [];
    let claudeActiva = 0;
    for (const cid of pestanasDe(e.id, c)) {
      const g = guardarConversacion(cid, c);
      if (!g) continue;
      if (cid === (c.activas[e.id] ?? e.id)) claudeActiva = claudes.length;
      claudes.push(g);
    }
    espacios.push({ nombre: e.nombre, raiz, claudes: claudes.length ? claudes : undefined, claudeActiva });
  }
  return { version: 1, activo, claudeVisible: c.visible, expandido: c.expandido, espacios };
}

let pendiente: ReturnType<typeof setTimeout> | null = null;

export function guardarSesion() {
  if (pendiente) clearTimeout(pendiente);
  pendiente = null;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(foto()));
  } catch {
    // Sin sitio en localStorage: la próxima vez se empieza de cero.
  }
}

let vigilando = false;

function programar() {
  if (!vigilando) return;
  if (pendiente) clearTimeout(pendiente);
  pendiente = setTimeout(guardarSesion, ESPERA);
}

/** Al soltar un separador: se apunta el tamaño y se guarda. */
export function alCambiarTamano(division: string, layout: Record<string, number>) {
  tamanos.set(division, layout);
  programar();
}

/** Guarda la sesión cada vez que cambian los espacios, las pestañas o Claude. */
export function vigilarSesion() {
  vigilando = true;
  const quitarK = useKyu.subscribe((s, a) => {
    if (s.espacios !== a.espacios || s.items !== a.items || s.activo !== a.activo) programar();
  });
  const quitarC = useClaude.subscribe((s, a) => {
    if (s.conversaciones !== a.conversaciones || s.visible !== a.visible || s.pestanas !== a.pestanas || s.activas !== a.activas || s.expandido !== a.expandido)
      programar();
  });
  window.addEventListener("beforeunload", guardarSesion);
  return () => {
    vigilando = false;
    quitarK();
    quitarC();
    window.removeEventListener("beforeunload", guardarSesion);
  };
}

/** Para la pantalla de Ajustes: olvidar lo guardado. */
export const olvidarSesion = () => localStorage.removeItem(CLAVE);

// ---------- Restaurar ----------

function leer(): SesionGuardada | null {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as SesionGuardada | null;
    return s?.version === 1 && Array.isArray(s.espacios) && s.espacios.length ? s : null;
  } catch {
    return null;
  }
}

/** Rutas de archivo guardadas que ya no se pueden abrir. */
async function archivosPerdidos(s: SesionGuardada) {
  const rutas = new Set<string>();
  const recorrer = (n: NodoGuardado) =>
    n.tipo === "panel" ? n.items.forEach((i) => i.tipo === "archivo" && rutas.add(i.ruta)) : n.hijos.forEach(recorrer);
  s.espacios.forEach((e) => recorrer(e.raiz));
  const perdidos = new Set<string>();
  await Promise.all(
    [...rutas].map((r) =>
      leerArchivo(r).then(
        () => {},
        () => perdidos.add(r),
      ),
    ),
  );
  return perdidos;
}

/**
 * Vuelve a montar la última sesión. `perfiles` = los que hay ahora (un perfil que ya no
 * existe pasa a ser `porDefecto`). Devuelve false si no había nada que restaurar.
 */
let enCurso: Promise<boolean> | null = null;

export function restaurarSesion(perfiles: string[], porDefecto: string): Promise<boolean> {
  // Una sola vez por arranque (en desarrollo, StrictMode monta App dos veces).
  enCurso ??= restaurar(perfiles, porDefecto);
  return enCurso;
}

async function restaurar(perfiles: string[], porDefecto: string): Promise<boolean> {
  const s = leer();
  if (!s) return false;
  const perdidos = await archivosPerdidos(s);
  const items: Record<string, Item> = {};
  // Conversaciones de pestaña que hay que volver a cargar cuando ya estén los espacios.
  const dePanel: { cid: string; conv: ConversacionGuardada }[] = [];

  const montar = (g: NodoGuardado, foco: { id: string | null }, espacio: string): Nodo | null => {
    if (g.tipo === "panel") {
      const ids: string[] = [];
      let activo: string | null = null;
      g.items.forEach((i, k) => {
        let it: Item;
        if (i.tipo === "arbol") {
          it = { id: nuevoId("r"), tipo: "arbol" };
        } else if (i.tipo === "claude") {
          const cid = nuevaDePanel(espacio);
          if (i.conv) dePanel.push({ cid, conv: i.conv });
          it = { id: nuevoId("c"), tipo: "claude", cid };
        } else if (i.tipo === "terminal") {
          const perfil = perfiles.includes(i.perfil) ? i.perfil : porDefecto;
          it = { id: nuevoId("t"), tipo: "terminal", perfil, titulo: i.titulo || perfil, carpeta: i.carpeta };
        } else {
          if (perdidos.has(i.ruta)) return;
          it = { id: nuevoId("a"), tipo: "archivo", ruta: i.ruta, sucio: false, linea: i.linea || 1, columna: i.columna || 1, salto: 1 };
        }
        items[it.id] = it;
        ids.push(it.id);
        if (k === g.activo) activo = it.id;
      });
      if (!ids.length) return null;
      const panel: Nodo = { tipo: "panel", id: nuevoId("p"), items: ids, activo: activo ?? ids[0] };
      if (g.foco) foco.id = panel.id;
      return panel;
    }
    const pares = g.hijos.map((h, k) => ({ n: montar(h, foco, espacio), t: g.tamanos?.[k] })).filter((x) => x.n !== null);
    if (!pares.length) return null;
    if (pares.length === 1) return pares[0].n;
    const total = pares.reduce((a, x) => a + (x.t ?? 0), 0);
    const tam = pares.every((x) => x.t) && total > 0 ? pares.map((x) => (x.t! / total) * 100) : undefined;
    return { tipo: "division", id: nuevoId("d"), dir: g.dir, hijos: pares.map((x) => x.n!), tamanos: tam };
  };

  const espacios: Espacio[] = [];
  const claudes: { espacio: string; lista: ConversacionGuardada[]; activa: number }[] = [];
  let activo = "";
  s.espacios.forEach((g, k) => {
    const foco = { id: null as string | null };
    const id = nuevoId("e");
    const raiz = montar(g.raiz, foco, id);
    if (!raiz) return;
    const esp: Espacio = { id, nombre: g.nombre, raiz, foco: foco.id ?? paneles(raiz)[0].id };
    espacios.push(esp);
    if (k === s.activo || !activo) activo = esp.id;
    const lista = g.claudes ?? (g.claude ? [g.claude] : []);
    if (lista.length) claudes.push({ espacio: esp.id, lista, activa: g.claudeActiva ?? 0 });
  });
  if (!espacios.length) return false;

  useKyu.setState({ espacios, items, activo });
  // Las conversaciones se cargan del historial; Claude arranca al escribir (--resume).
  // La primera conversación de cada espacio lleva su id; las demás, pestañas nuevas.
  for (const { espacio, lista, activa } of claudes) {
    const ids = lista.map((_, i) => (i === 0 ? espacio : nuevaPestana(espacio)));
    lista.forEach((d, i) => void reanudar(ids[i], d.carpeta, d.sesion, d.titulo, d.cuenta ?? null).catch(() => {}));
    activarPestana(ids[Math.min(activa, ids.length - 1)]);
  }
  for (const { cid, conv } of dePanel) void reanudar(cid, conv.carpeta, conv.sesion, conv.titulo, conv.cuenta ?? null).catch(() => {});
  if (s.expandido) useClaude.setState({ expandido: true });
  if (s.claudeVisible) useClaude.getState().mostrar(true);
  return true;
}
