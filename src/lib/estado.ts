// Estado de la ventana: espacios de trabajo (pestañas de arriba), dentro de cada uno un
// árbol de paneles divididos, y en cada panel sus pestañas (terminales y archivos).
//
// Los terminales y editores de verdad no viven aquí sino en sus registros
// (terminales.ts, editores.ts): así, al dividir o mover un panel, React lo vuelve a
// montar pero la shell y el texto sin guardar siguen intactos.
import { create } from "zustand";

export type Item =
  | { id: string; tipo: "terminal"; perfil: string; titulo: string; carpeta: string | null; deClaude?: boolean }
  | { id: string; tipo: "archivo"; ruta: string; sucio: boolean; linea: number; columna: number; salto: number };

export type Direccion = "horizontal" | "vertical";

export type Nodo =
  | { tipo: "panel"; id: string; items: string[]; activo: string | null }
  | { tipo: "division"; id: string; dir: Direccion; hijos: Nodo[] };

export interface Espacio {
  id: string;
  /** null = se llama como la carpeta del terminal con el foco */
  nombre: string | null;
  raiz: Nodo;
  /** id del panel con el foco */
  foco: string;
}

export type Zona = "centro" | "izquierda" | "derecha" | "arriba" | "abajo";

interface Estado {
  espacios: Espacio[];
  activo: string;
  items: Record<string, Item>;
  /** Terminal con la barra de búsqueda abierta. */
  buscando: string | null;
  paleta: boolean;

  iniciar: (perfil: string) => void;
  nuevoEspacio: (perfil: string, carpeta?: string | null) => void;
  cambiarEspacio: (id: string) => void;
  renombrarEspacio: (id: string, nombre: string | null) => void;
  nuevaPestana: (perfil: string, panel?: string) => void;
  dividir: (dir: Direccion, perfil: string, panel?: string) => void;
  /** Abre un terminal en un panel nuevo a la derecha de `espacio` sin quitar el foco; devuelve su id. */
  terminalAlLado: (espacio: string, perfil: string, carpeta: string | null, titulo: string) => string | null;
  activar: (panel: string, item: string) => void;
  enfocar: (panel: string) => void;
  /** Quita la pestaña de su panel (y el panel o el espacio si se quedan vacíos). */
  quitarItem: (item: string) => void;
  moverItem: (item: string, destino: string, zona: Zona) => void;
  abrirArchivo: (ruta: string, linea: number, columna: number) => void;
  ponerTitulo: (item: string, titulo: string, carpeta?: string | null) => void;
  marcarSucio: (item: string, sucio: boolean) => void;
  ponerBuscando: (item: string | null) => void;
  ponerPaleta: (abierta: boolean) => void;
  siguientePestana: (paso: number) => void;
}

let contador = 0;
const nuevoId = (prefijo: string) => `${prefijo}${++contador}`;

// ---------- Árbol ----------

export function paneles(nodo: Nodo): Extract<Nodo, { tipo: "panel" }>[] {
  return nodo.tipo === "panel" ? [nodo] : nodo.hijos.flatMap(paneles);
}

function buscarPanel(raiz: Nodo, id: string) {
  return paneles(raiz).find((p) => p.id === id);
}

function panelDeItem(raiz: Nodo, item: string) {
  return paneles(raiz).find((p) => p.items.includes(item));
}

/** Copia el árbol cambiando el nodo `id` por lo que devuelva `f` (null = quitarlo). */
function cambiar(nodo: Nodo, id: string, f: (n: Nodo) => Nodo | null): Nodo | null {
  if (nodo.id === id) return f(nodo);
  if (nodo.tipo === "panel") return nodo;
  const hijos = nodo.hijos.map((h) => cambiar(h, id, f)).filter((h): h is Nodo => h !== null);
  if (hijos.length === 0) return null;
  // Una división con un solo hijo sobra: se queda el hijo.
  if (hijos.length === 1) return hijos[0];
  // Hijos que son divisiones en la misma dirección se juntan con la de arriba.
  const planos = hijos.flatMap((h) => (h.tipo === "division" && h.dir === nodo.dir ? h.hijos : [h]));
  return { ...nodo, hijos: planos };
}

/** Pone `nuevo` al lado del nodo `id`. */
function ponerAlLado(raiz: Nodo, id: string, nuevo: Nodo, zona: Exclude<Zona, "centro">): Nodo {
  const dir: Direccion = zona === "izquierda" || zona === "derecha" ? "horizontal" : "vertical";
  const antes = zona === "izquierda" || zona === "arriba";
  return (
    cambiar(raiz, id, (n) => ({
      tipo: "division",
      id: nuevoId("d"),
      dir,
      hijos: antes ? [nuevo, n] : [n, nuevo],
    })) ?? nuevo
  );
}

function nuevoPanel(items: string[]): Extract<Nodo, { tipo: "panel" }> {
  return { tipo: "panel", id: nuevoId("p"), items, activo: items[items.length - 1] ?? null };
}

function terminal(perfil: string, carpeta: string | null = null): Item {
  return { id: nuevoId("t"), tipo: "terminal", perfil, titulo: perfil, carpeta };
}

// ---------- Tienda ----------

export const useKyu = create<Estado>((set, get) => {
  /** Cambia el espacio activo con `f`. */
  const conEspacio = (f: (e: Espacio) => Espacio) =>
    set((s) => ({ espacios: s.espacios.map((e) => (e.id === s.activo ? f(e) : e)) }));
  const espacioActivo = () => get().espacios.find((e) => e.id === get().activo)!;

  return {
    espacios: [],
    activo: "",
    items: {},
    buscando: null,
    paleta: false,

    iniciar: (perfil) => {
      if (get().espacios.length) return;
      get().nuevoEspacio(perfil);
    },

    nuevoEspacio: (perfil, carpeta = null) => {
      const t = terminal(perfil, carpeta);
      const panel = nuevoPanel([t.id]);
      const espacio: Espacio = { id: nuevoId("e"), nombre: null, raiz: panel, foco: panel.id };
      set((s) => ({ espacios: [...s.espacios, espacio], activo: espacio.id, items: { ...s.items, [t.id]: t } }));
    },

    cambiarEspacio: (id) => set({ activo: id, buscando: null }),

    renombrarEspacio: (id, nombre) =>
      set((s) => ({ espacios: s.espacios.map((e) => (e.id === id ? { ...e, nombre } : e)) })),

    nuevaPestana: (perfil, panel) => {
      const e = espacioActivo();
      const destino = panel ?? e.foco;
      const carpeta = carpetaDelFoco();
      const t = terminal(perfil, carpeta);
      set((s) => ({ items: { ...s.items, [t.id]: t } }));
      conEspacio((esp) => ({
        ...esp,
        foco: destino,
        raiz:
          cambiar(esp.raiz, destino, (n) =>
            n.tipo === "panel" ? { ...n, items: [...n.items, t.id], activo: t.id } : n,
          ) ?? esp.raiz,
      }));
    },

    dividir: (dir, perfil, panel) => {
      const e = espacioActivo();
      const origen = panel ?? e.foco;
      const t = terminal(perfil, carpetaDelFoco());
      const nuevo = nuevoPanel([t.id]);
      set((s) => ({ items: { ...s.items, [t.id]: t } }));
      conEspacio((esp) => ({
        ...esp,
        foco: nuevo.id,
        raiz: ponerAlLado(esp.raiz, origen, nuevo, dir === "horizontal" ? "derecha" : "abajo"),
      }));
    },

    terminalAlLado: (espacio, perfil, carpeta, titulo) => {
      const esp = get().espacios.find((e) => e.id === espacio);
      if (!esp) return null;
      const t = { ...terminal(perfil, carpeta), titulo, deClaude: true } as Item;
      const nuevo = nuevoPanel([t.id]);
      set((s) => ({
        items: { ...s.items, [t.id]: t },
        espacios: s.espacios.map((e) =>
          e.id === espacio ? { ...e, raiz: ponerAlLado(e.raiz, e.foco, nuevo, "derecha") } : e,
        ),
      }));
      return t.id;
    },

    activar: (panel, item) =>
      conEspacio((esp) => ({
        ...esp,
        foco: panel,
        raiz: cambiar(esp.raiz, panel, (n) => (n.tipo === "panel" ? { ...n, activo: item } : n)) ?? esp.raiz,
      })),

    enfocar: (panel) => conEspacio((esp) => (esp.foco === panel ? esp : { ...esp, foco: panel })),

    quitarItem: (item) => {
      const s = get();
      const espacio = s.espacios.find((e) => panelDeItem(e.raiz, item));
      if (!espacio) return;
      const panel = panelDeItem(espacio.raiz, item)!;
      const resto = panel.items.filter((i) => i !== item);
      const items = { ...s.items };
      delete items[item];

      let raiz: Nodo | null;
      let foco = espacio.foco;
      if (resto.length) {
        const idx = panel.items.indexOf(item);
        const activo = panel.activo === item ? resto[Math.min(idx, resto.length - 1)] : panel.activo;
        raiz = cambiar(espacio.raiz, panel.id, (n) => ({ ...n, items: resto, activo }) as Nodo);
      } else {
        raiz = cambiar(espacio.raiz, panel.id, () => null);
        if (raiz && foco === panel.id) foco = paneles(raiz)[0].id;
      }

      let espacios: Espacio[];
      let activo = s.activo;
      if (raiz) {
        espacios = s.espacios.map((e) => (e.id === espacio.id ? { ...e, raiz: raiz!, foco } : e));
      } else {
        const idx = s.espacios.indexOf(espacio);
        espacios = s.espacios.filter((e) => e.id !== espacio.id);
        if (activo === espacio.id) activo = espacios[Math.min(idx, espacios.length - 1)]?.id ?? "";
      }
      set({ espacios, activo, items, buscando: s.buscando === item ? null : s.buscando });
    },

    moverItem: (item, destino, zona) => {
      const esp = espacioActivo();
      const origen = panelDeItem(esp.raiz, item);
      if (!origen) return;
      if (zona === "centro" && origen.id === destino) return;
      // Dividir un panel con su única pestaña no tiene sentido.
      if (zona !== "centro" && origen.id === destino && origen.items.length === 1) return;

      // 1) sacar la pestaña de su panel
      const resto = origen.items.filter((i) => i !== item);
      let raiz =
        cambiar(esp.raiz, origen.id, (n) =>
          resto.length ? ({ ...n, items: resto, activo: origen.activo === item ? resto[0] : origen.activo } as Nodo) : null,
        ) ?? null;
      if (!raiz) return; // era lo único del espacio: nada que mover
      // 2) ponerla en el destino
      let foco = destino;
      if (zona === "centro") {
        raiz = cambiar(raiz, destino, (n) =>
          n.tipo === "panel" ? { ...n, items: [...n.items, item], activo: item } : n,
        )!;
      } else {
        const nuevo = nuevoPanel([item]);
        foco = nuevo.id;
        raiz = buscarPanel(raiz, destino) ? ponerAlLado(raiz, destino, nuevo, zona) : raiz;
      }
      conEspacio((e) => ({ ...e, raiz: raiz!, foco }));
    },

    abrirArchivo: (ruta, linea, columna) => {
      const s = get();
      const esp = espacioActivo();
      // ¿Ya está abierto en este espacio? Se activa y salta a la línea.
      for (const p of paneles(esp.raiz)) {
        const ya = p.items.find((i) => {
          const it = s.items[i];
          return it?.tipo === "archivo" && it.ruta.toLowerCase() === ruta.toLowerCase();
        });
        if (ya) {
          const it = s.items[ya] as Extract<Item, { tipo: "archivo" }>;
          set({ items: { ...s.items, [ya]: { ...it, linea, columna, salto: it.salto + 1 } } });
          get().activar(p.id, ya);
          return;
        }
      }
      const archivo: Item = { id: nuevoId("a"), tipo: "archivo", ruta, sucio: false, linea, columna, salto: 1 };
      set({ items: { ...s.items, [archivo.id]: archivo } });
      // Si hay un panel mostrando archivos, va ahí como pestaña; si no, se abre uno a la derecha.
      const deArchivos = paneles(esp.raiz).find((p) => p.activo && s.items[p.activo]?.tipo === "archivo");
      if (deArchivos) {
        conEspacio((e) => ({
          ...e,
          foco: deArchivos.id,
          raiz: cambiar(e.raiz, deArchivos.id, (n) =>
            n.tipo === "panel" ? { ...n, items: [...n.items, archivo.id], activo: archivo.id } : n,
          )!,
        }));
      } else {
        const nuevo = nuevoPanel([archivo.id]);
        conEspacio((e) => ({ ...e, foco: nuevo.id, raiz: ponerAlLado(e.raiz, e.foco, nuevo, "derecha") }));
      }
    },

    ponerTitulo: (item, titulo, carpeta) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "terminal") return s;
        return { items: { ...s.items, [item]: { ...it, titulo, carpeta: carpeta ?? it.carpeta } } };
      }),

    marcarSucio: (item, sucio) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "archivo" || it.sucio === sucio) return s;
        return { items: { ...s.items, [item]: { ...it, sucio } } };
      }),

    ponerBuscando: (item) => set({ buscando: item }),
    ponerPaleta: (paleta) => set({ paleta }),

    siguientePestana: (paso) => {
      const esp = espacioActivo();
      const p = buscarPanel(esp.raiz, esp.foco);
      if (!p || p.items.length < 2 || !p.activo) return;
      const i = (p.items.indexOf(p.activo) + paso + p.items.length) % p.items.length;
      get().activar(p.id, p.items[i]);
    },
  };

  /** Carpeta de lo que tiene el foco (el terminal, o la del archivo), para abrir lo nuevo ahí. */
  function carpetaDelFoco(): string | null {
    const esp = espacioActivo();
    const p = buscarPanel(esp.raiz, esp.foco);
    const it = p?.activo ? get().items[p.activo] : undefined;
    if (it?.tipo === "terminal") return it.carpeta;
    if (it?.tipo === "archivo") return it.ruta.replace(/[\\/][^\\/]*$/, "") || null;
    return null;
  }
});

/** El panel con el foco del espacio activo y su pestaña activa. */
export function focoActual() {
  const s = useKyu.getState();
  const esp = s.espacios.find((e) => e.id === s.activo);
  if (!esp) return null;
  const panel = buscarPanel(esp.raiz, esp.foco);
  const item = panel?.activo ? s.items[panel.activo] : undefined;
  return { espacio: esp, panel, item };
}
