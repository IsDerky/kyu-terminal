// Estado de la ventana: espacios de trabajo (pestañas de arriba), dentro de cada uno un
// árbol de paneles divididos, y en cada panel sus pestañas (terminales y archivos).
//
// Los terminales y editores de verdad no viven aquí sino en sus registros
// (terminales.ts, editores.ts): así, al dividir o mover un panel, React lo vuelve a
// montar pero la shell y el texto sin guardar siguen intactos.
import { create } from "zustand";
import { aplanar, heredar } from "./tamanos";

export type Item =
  | { id: string; tipo: "terminal"; perfil: string; titulo: string; carpeta: string | null; deClaude?: boolean; /** Nombre puesto a mano (Renombrar): manda sobre el título. */ nombre?: string; /** Color e icono puestos a mano (ids de estiloPestana.ts). */ color?: string; icono?: string }
  | {
      id: string;
      tipo: "archivo";
      ruta: string;
      sucio: boolean;
      linea: number;
      columna: number;
      salto: number;
      /** Enseñar lo que cambió Claude: cómo estaba antes (null = no existía). */
      diff?: { antes: string | null; /** Quién lo cambió (null = Claude). */ agente?: string | null };
    }
  /** Pestaña «Archivos»: el árbol de la carpeta del terminal con el foco. */
  | { id: string; tipo: "arbol" }
  /** Una conversación de Claude como pestaña (`cid`: su id en claude.ts, «espacio~pN»). */
  | { id: string; tipo: "claude"; cid: string }
  /** Pestaña «Cambios»: lo que hay sin commit en el repo `raiz`, con su diff y el commit. */
  | { id: string; tipo: "cambios"; raiz: string }
  /** Pestaña «Problemas»: errores y avisos del último build o lint del espacio. */
  | { id: string; tipo: "problemas" }
  /** «Visor de archivos»: árbol de `raiz` a un lado y el archivo elegido (`ruta`) en la misma pestaña. */
  | { id: string; tipo: "visor"; raiz: string | null; ruta: string | null; sucio: boolean };

export type Direccion = "horizontal" | "vertical";

export type Nodo =
  | { tipo: "panel"; id: string; items: string[]; activo: string | null }
  // `tamanos`: % de cada hijo al montarla (al restaurar la sesión); luego los lleva el ratón.
  | { tipo: "division"; id: string; dir: Direccion; hijos: Nodo[]; tamanos?: number[] };

export interface Espacio {
  id: string;
  /** null = se llama como la carpeta del terminal con el foco */
  nombre: string | null;
  raiz: Nodo;
  /** id del panel con el foco */
  foco: string;
  /** Panel a pantalla completa (Ctrl+Mayús+X); deja de estarlo en cuanto el foco va a otro. */
  maximizado?: string | null;
  /** Espacio abierto para un issue en un worktree: al cerrarlo se ofrece quitarlo. */
  worktree?: { raiz: string; ruta: string };
  /** Carpeta del espacio («Abrir carpeta…»): los terminales nuevos sin otra carpeta arrancan aquí. */
  carpeta?: string;
}

export type Zona = "centro" | "izquierda" | "derecha" | "arriba" | "abajo";

interface Estado {
  espacios: Espacio[];
  activo: string;
  items: Record<string, Item>;
  /** Terminal con la barra de búsqueda abierta. */
  buscando: string | null;
  paleta: boolean;
  /** Pestaña de Ajustes abierta (en lugar del espacio). */
  ajustes: boolean;
  /** Pestaña de Uso de Claude abierta (en lugar del espacio). */
  uso: boolean;

  iniciar: (perfil: string) => void;
  /** Con `fija`, la carpeta queda como la del espacio y le da nombre («Abrir carpeta…»). */
  nuevoEspacio: (perfil: string, carpeta?: string | null, fija?: boolean) => void;
  cambiarEspacio: (id: string) => void;
  renombrarEspacio: (id: string, nombre: string | null) => void;
  nuevaPestana: (perfil: string, panel?: string, carpeta?: string | null) => void;
  /** Pone (o quita, con null) el nombre a mano de una terminal. */
  renombrarItem: (item: string, nombre: string | null) => void;
  /** Color o icono de una pestaña de terminal (null = quitarlo). */
  pintarItem: (item: string, cambio: { color?: string | null; icono?: string | null }) => void;
  /** Cambia una pestaña por otra en el mismo sitio (Reiniciar la terminal). */
  reemplazarItem: (viejo: string, nuevo: Item) => void;
  dividir: (dir: Direccion, perfil: string, panel?: string) => void;
  /** Abre un terminal en un panel nuevo a la derecha de `espacio` sin quitar el foco; devuelve su id. */
  /** Terminal nueva a la derecha del foco. `deClaude`: es la de MCP, donde ejecuta Claude (lleva su icono). */
  terminalAlLado: (espacio: string, perfil: string, carpeta: string | null, titulo: string, deClaude?: boolean) => string | null;
  activar: (panel: string, item: string) => void;
  enfocar: (panel: string) => void;
  /** Quita la pestaña de su panel (y el panel o el espacio si se quedan vacíos). */
  quitarItem: (item: string) => void;
  moverItem: (item: string, destino: string, zona: Zona) => void;
  abrirArchivo: (ruta: string, linea: number, columna: number, diff?: { antes: string | null; agente?: string | null }) => void;
  /** Quita las marcas de cambios de una pestaña de archivo. */
  quitarDiff: (item: string) => void;
  /** Ctrl+Mayús+B: abre la pestaña «Archivos» en el panel con el foco, la enfoca o la cierra. */
  alternarArbol: () => void;
  /** Pestaña «Visor de archivos» con el árbol de `raiz`, en `panel` (o el del foco). */
  abrirVisor: (raiz: string | null, panel?: string) => void;
  /** Cambia el archivo que enseña un visor. */
  verEnVisor: (item: string, ruta: string | null) => void;
  /** Pone la conversación `cid` como pestaña: en el panel `panel` (o el del foco) o, con
   *  `alLado`, en un panel nuevo a la derecha del foco. */
  ponerClaude: (cid: string, opciones?: { panel?: string; alLado?: boolean }) => void;
  /** Ctrl+Mayús+X: el panel con el foco a pantalla completa, o de vuelta. */
  alternarMaximizar: () => void;
  /** Abre (o enseña) la pestaña «Cambios» del repo en el panel con el foco. */
  abrirCambios: (raiz: string) => void;
  /** Abre (o enseña) la pestaña «Problemas» en el panel con el foco. */
  abrirProblemas: () => void;
  /** Apunta en el espacio activo el worktree para el que se abrió. */
  ponerWorktree: (worktree: { raiz: string; ruta: string }, nombre: string) => void;
  ponerTitulo: (item: string, titulo: string, carpeta?: string | null) => void;
  marcarSucio: (item: string, sucio: boolean) => void;
  ponerBuscando: (item: string | null) => void;
  ponerPaleta: (abierta: boolean) => void;
  ponerAjustes: (abierta: boolean) => void;
  ponerUso: (abierta: boolean) => void;
  siguientePestana: (paso: number) => void;
}

let contador = 0;
export const nuevoId = (prefijo: string) => `${prefijo}${++contador}`;

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
  // Una división con un solo hijo sobra: se queda el hijo (con el sitio que tenía ella arriba).
  if (hijos.length === 1) {
    heredar(nodo.id, hijos[0].id);
    return hijos[0];
  }
  // Hijos que son divisiones en la misma dirección se juntan con la de arriba.
  const planos = hijos.flatMap((h) => {
    if (h.tipo !== "division" || h.dir !== nodo.dir) return [h];
    aplanar(nodo.id, h.id, h.hijos.map((n) => n.id), h.tamanos);
    return h.hijos;
  });
  return { ...nodo, hijos: planos };
}

/** Pone `nuevo` al lado del nodo `id` (con `parte`, el % que ocupa lo nuevo). */
function ponerAlLado(raiz: Nodo, id: string, nuevo: Nodo, zona: Exclude<Zona, "centro">, parte?: number): Nodo {
  const dir: Direccion = zona === "izquierda" || zona === "derecha" ? "horizontal" : "vertical";
  const antes = zona === "izquierda" || zona === "arriba";
  return (
    cambiar(raiz, id, (n) => {
      const division: Nodo = {
        tipo: "division",
        id: nuevoId("d"),
        dir,
        hijos: antes ? [nuevo, n] : [n, nuevo],
        tamanos: parte ? (antes ? [parte, 100 - parte] : [100 - parte, parte]) : undefined,
      };
      // La división nueva ocupa el sitio de `n`: el resto de su grupo no se reparte de nuevo
      heredar(n.id, division.id);
      return division;
    }) ?? nuevo
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
    ajustes: false,
    uso: false,

    iniciar: (perfil) => {
      if (get().espacios.length) return;
      get().nuevoEspacio(perfil);
    },

    nuevoEspacio: (perfil, carpeta = null, fija = false) => {
      const t = terminal(perfil, carpeta);
      const panel = nuevoPanel([t.id]);
      const espacio: Espacio = {
        id: nuevoId("e"),
        nombre: fija && carpeta ? carpeta.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null : null,
        raiz: panel,
        foco: panel.id,
        ...(fija && carpeta ? { carpeta } : {}),
      };
      set((s) => ({ espacios: [...s.espacios, espacio], activo: espacio.id, items: { ...s.items, [t.id]: t } }));
    },

    cambiarEspacio: (id) => set({ activo: id, buscando: null }),

    renombrarEspacio: (id, nombre) =>
      set((s) => ({ espacios: s.espacios.map((e) => (e.id === id ? { ...e, nombre } : e)) })),

    nuevaPestana: (perfil, panel, enCarpeta) => {
      const e = espacioActivo();
      const destino = panel ?? e.foco;
      const carpeta = enCarpeta ?? carpetaDelFoco();
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

    terminalAlLado: (espacio, perfil, carpeta, titulo, deClaude = false) => {
      const esp = get().espacios.find((e) => e.id === espacio);
      if (!esp) return null;
      const t = { ...terminal(perfil, carpeta), titulo, ...(deClaude ? { deClaude: true } : {}) } as Item;
      const nuevo = nuevoPanel([t.id]);
      set((s) => ({
        items: { ...s.items, [t.id]: t },
        espacios: s.espacios.map((e) =>
          e.id === espacio ? { ...e, raiz: ponerAlLado(e.raiz, e.foco, nuevo, "derecha") } : e,
        ),
      }));
      return t.id;
    },

    // Ir a otro panel quita el «maximizado» (si no, volvería a saltar al volver a él).
    activar: (panel, item) =>
      conEspacio((esp) => ({
        ...esp,
        foco: panel,
        maximizado: esp.maximizado === panel ? panel : null,
        raiz: cambiar(esp.raiz, panel, (n) => (n.tipo === "panel" ? { ...n, activo: item } : n)) ?? esp.raiz,
      })),

    enfocar: (panel) =>
      conEspacio((esp) => (esp.foco === panel ? esp : { ...esp, foco: panel, maximizado: esp.maximizado === panel ? panel : null })),

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

    abrirArchivo: (ruta, linea, columna, diff) => {
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
          set({ items: { ...s.items, [ya]: { ...it, linea, columna, salto: it.salto + 1, diff: diff ?? it.diff } } });
          get().activar(p.id, ya);
          return;
        }
      }
      const archivo: Item = { id: nuevoId("a"), tipo: "archivo", ruta, sucio: false, linea, columna, salto: 1, diff };
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

    quitarDiff: (item) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "archivo" || !it.diff) return s;
        return { items: { ...s.items, [item]: { ...it, diff: undefined } } };
      }),

    alternarArbol: () => {
      const s = get();
      const esp = espacioActivo();
      for (const p of paneles(esp.raiz)) {
        const ya = p.items.find((i) => s.items[i]?.tipo === "arbol");
        if (!ya) continue;
        // Ya se ve y tiene el foco: se cierra. Si no, se enseña.
        if (p.id === esp.foco && p.activo === ya) get().quitarItem(ya);
        else get().activar(p.id, ya);
        return;
      }
      const arbol: Item = { id: nuevoId("r"), tipo: "arbol" };
      set({ items: { ...s.items, [arbol.id]: arbol } });
      conEspacio((e) => ({
        ...e,
        raiz:
          cambiar(e.raiz, e.foco, (n) => (n.tipo === "panel" ? { ...n, items: [arbol.id, ...n.items], activo: arbol.id } : n)) ??
          e.raiz,
      }));
    },

    abrirVisor: (raiz, panel) => {
      const it: Item = { id: nuevoId("v"), tipo: "visor", raiz, ruta: null, sucio: false };
      set((s) => ({ items: { ...s.items, [it.id]: it } }));
      conEspacio((e) => {
        const destino = panel ?? e.foco;
        return {
          ...e,
          foco: destino,
          raiz:
            cambiar(e.raiz, destino, (n) => (n.tipo === "panel" ? { ...n, items: [...n.items, it.id], activo: it.id } : n)) ??
            e.raiz,
        };
      });
    },

    verEnVisor: (item, ruta) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "visor") return s;
        return { items: { ...s.items, [item]: { ...it, ruta, sucio: false } } };
      }),

    ponerClaude: (cid, opciones = {}) => {
      const it: Item = { id: nuevoId("c"), tipo: "claude", cid };
      set((s) => ({ items: { ...s.items, [it.id]: it } }));
      if (opciones.alLado) {
        const nuevo = nuevoPanel([it.id]);
        conEspacio((e) => ({ ...e, foco: nuevo.id, raiz: ponerAlLado(e.raiz, e.foco, nuevo, "derecha", 40) }));
        return;
      }
      conEspacio((e) => {
        const destino = opciones.panel ?? e.foco;
        return {
          ...e,
          foco: destino,
          raiz:
            cambiar(e.raiz, destino, (n) => (n.tipo === "panel" ? { ...n, items: [...n.items, it.id], activo: it.id } : n)) ??
            e.raiz,
        };
      });
    },

    abrirCambios: (raiz) => {
      const s = get();
      const esp = espacioActivo();
      for (const p of paneles(esp.raiz)) {
        const ya = p.items.find((i) => {
          const it = s.items[i];
          return it?.tipo === "cambios" && it.raiz.toLowerCase() === raiz.toLowerCase();
        });
        if (ya) return get().activar(p.id, ya);
      }
      const it: Item = { id: nuevoId("g"), tipo: "cambios", raiz };
      set({ items: { ...s.items, [it.id]: it } });
      conEspacio((e) => ({
        ...e,
        raiz:
          cambiar(e.raiz, e.foco, (n) => (n.tipo === "panel" ? { ...n, items: [...n.items, it.id], activo: it.id } : n)) ?? e.raiz,
      }));
    },

    abrirProblemas: () => {
      const s = get();
      const esp = espacioActivo();
      for (const p of paneles(esp.raiz)) {
        const ya = p.items.find((i) => s.items[i]?.tipo === "problemas");
        if (ya) return get().activar(p.id, ya);
      }
      const it: Item = { id: nuevoId("x"), tipo: "problemas" };
      set({ items: { ...s.items, [it.id]: it } });
      conEspacio((e) => ({
        ...e,
        raiz:
          cambiar(e.raiz, e.foco, (n) => (n.tipo === "panel" ? { ...n, items: [...n.items, it.id], activo: it.id } : n)) ?? e.raiz,
      }));
    },

    ponerWorktree: (worktree, nombre) => conEspacio((e) => ({ ...e, worktree, nombre })),

    alternarMaximizar: () =>
      conEspacio((e) => {
        if (paneles(e.raiz).length < 2) return e.maximizado ? { ...e, maximizado: null } : e;
        return { ...e, maximizado: e.maximizado === e.foco ? null : e.foco };
      }),

    ponerTitulo: (item, titulo, carpeta) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "terminal") return s;
        return { items: { ...s.items, [item]: { ...it, titulo, carpeta: carpeta ?? it.carpeta } } };
      }),

    renombrarItem: (item, nombre) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "terminal") return s;
        const { nombre: _, ...resto } = it;
        const limpio = nombre?.trim();
        return { items: { ...s.items, [item]: limpio ? { ...resto, nombre: limpio } : resto } };
      }),

    pintarItem: (item, cambio) =>
      set((s) => {
        const it = s.items[item];
        if (!it || it.tipo !== "terminal") return s;
        const nuevo = { ...it };
        for (const k of ["color", "icono"] as const) {
          if (cambio[k] === undefined) continue;
          if (cambio[k]) nuevo[k] = cambio[k]!;
          else delete nuevo[k];
        }
        return { items: { ...s.items, [item]: nuevo } };
      }),

    reemplazarItem: (viejo, nuevo) =>
      set((s) => {
        const { [viejo]: _, ...items } = s.items;
        const poner = (n: Nodo): Nodo =>
          n.tipo === "panel"
            ? n.items.includes(viejo)
              ? { ...n, items: n.items.map((i) => (i === viejo ? nuevo.id : i)), activo: n.activo === viejo ? nuevo.id : n.activo }
              : n
            : { ...n, hijos: n.hijos.map(poner) };
        return { items: { ...items, [nuevo.id]: nuevo }, espacios: s.espacios.map((e) => ({ ...e, raiz: poner(e.raiz) })) };
      }),

    marcarSucio: (item, sucio) =>
      set((s) => {
        const it = s.items[item];
        if (!it || (it.tipo !== "archivo" && it.tipo !== "visor") || it.sucio === sucio) return s;
        return { items: { ...s.items, [item]: { ...it, sucio } } };
      }),

    ponerBuscando: (item) => set({ buscando: item }),
    ponerPaleta: (paleta) => set({ paleta }),
    ponerAjustes: (ajustes) => set({ ajustes, uso: false, paleta: false }),
    ponerUso: (uso) => set({ uso, ajustes: false, paleta: false }),

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
    // Desde la pestaña «Archivos»: la del primer terminal del espacio.
    for (const p of paneles(esp.raiz)) {
      for (const i of p.items) {
        const t = get().items[i];
        if (t?.tipo === "terminal" && t.carpeta) return t.carpeta;
      }
    }
    return esp.carpeta ?? null;
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
