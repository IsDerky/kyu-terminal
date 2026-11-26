import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMenu, type Elemento } from "../lib/menu";

/** El menú de clic derecho abierto (uno a la vez), en el punto del clic y sin salirse de la ventana. */
export default function MenuContextual() {
  const menu = useMenu((s) => s.menu);
  const cerrar = useMenu((s) => s.cerrar);
  const caja = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [marcado, setMarcado] = useState(-1);

  const opciones = (menu?.elementos ?? [])
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: Extract<Elemento, { tipo: "opcion" }>; i: number } => x.e.tipo === "opcion" && !x.e.desactivada);

  // Se mide ya pintado: si no cabe a la derecha o abajo, se abre hacia el otro lado.
  useLayoutEffect(() => {
    if (!menu || !caja.current) return setPos(null);
    const r = caja.current.getBoundingClientRect();
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    let x = menu.x;
    let y = menu.y;
    if (x + r.width > ancho - 4) x = Math.max(4, menu.x - r.width);
    if (y + r.height > alto - 4) y = Math.max(4, Math.min(menu.y - r.height, alto - r.height - 4));
    setPos({ x, y });
    setMarcado(-1);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) cerrar();
    };
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cerrar();
        menu.foco?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (!opciones.length) return;
        const actual = opciones.findIndex((o) => o.i === marcado);
        const d = e.key === "ArrowDown" ? 1 : -1;
        const sig = actual < 0 ? (d > 0 ? 0 : opciones.length - 1) : (actual + d + opciones.length) % opciones.length;
        setMarcado(opciones[sig].i);
        return;
      }
      if (e.key === "Enter") {
        const o = opciones.find((x) => x.i === marcado);
        if (!o) return;
        e.preventDefault();
        e.stopPropagation();
        elegir(o.e.hacer);
      }
    };
    const soltar = () => cerrar();
    window.addEventListener("mousedown", fuera, true);
    window.addEventListener("keydown", teclas, true);
    window.addEventListener("blur", soltar);
    window.addEventListener("resize", soltar);
    return () => {
      window.removeEventListener("mousedown", fuera, true);
      window.removeEventListener("keydown", teclas, true);
      window.removeEventListener("blur", soltar);
      window.removeEventListener("resize", soltar);
    };
  });

  if (!menu) return null;

  function elegir(hacer: () => void) {
    const foco = menu?.foco;
    cerrar();
    foco?.focus();
    hacer();
  }

  return (
    <div
      ref={caja}
      role="menu"
      // Sin esto, pulsar una opción le quita el foco (y la selección) a la caja de texto.
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-[100] min-w-[236px] rounded-[10px] border border-borde2 bg-[#141417f2] p-[5px] text-[12.5px] leading-none text-texto shadow-[0_18px_50px_#000c,0_0_0_1px_#0006] backdrop-blur-md"
    >
      {menu.rapidas && (
        <div className="mb-[5px] grid grid-cols-4 gap-1 border-b border-borde2 px-0.5 pb-1.5 pt-0.5">
          {menu.rapidas.map((r) => (
            <button
              key={r.texto}
              type="button"
              disabled={r.desactivada}
              onClick={() => elegir(r.hacer)}
              className="flex flex-col items-center gap-1 rounded-[7px] bg-white/[0.024] px-1 pb-1.5 pt-[7px] text-[10.5px] text-tenue hover:bg-acento/[0.14] hover:text-texto disabled:pointer-events-none disabled:opacity-40"
            >
              <r.icono size={15} strokeWidth={1.8} className="text-texto" />
              {r.texto}
            </button>
          ))}
        </div>
      )}
      {menu.contexto && (
        <div className="-mx-px -mt-px mb-[5px] flex items-center gap-2 border-b border-borde2 px-2 pb-2 pt-1.5 font-mono text-[12px] text-tenue">
          <menu.contexto.icono size={14} strokeWidth={1.8} className="flex-none" />
          <b className="truncate font-semibold text-texto">{menu.contexto.texto}</b>
          {menu.contexto.detalle && (
            <span className={`flex-none ${menu.contexto.color === "mal" ? "text-mal" : menu.contexto.color === "ok" ? "text-ok" : ""}`}>
              {menu.contexto.detalle}
            </span>
          )}
        </div>
      )}
      {menu.elementos.map((e, i) =>
        e.tipo === "separador" ? (
          <div key={i} className="mx-1 my-[5px] h-px bg-borde2" />
        ) : e.tipo === "cabecera" ? (
          <div key={i} className="px-2 pb-1 pt-[7px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muy">
            {e.texto}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={e.desactivada}
            onClick={() => elegir(e.hacer)}
            onMouseEnter={() => setMarcado(i)}
            className={`flex h-7 w-full items-center gap-[9px] whitespace-nowrap rounded-md px-2 text-left disabled:text-muy ${
              marcado === i && !e.desactivada ? "bg-acento/[0.14]" : ""
            } ${e.estilo === "claude" ? "text-claude2" : e.estilo === "peligro" ? "text-mal" : ""}`}
          >
            <e.icono
              size={14}
              strokeWidth={1.8}
              className={`flex-none ${
                e.estilo === "claude" ? "text-claude" : e.estilo === "peligro" ? "text-mal" : marcado === i && !e.desactivada ? "text-acento2" : "text-tenue"
              }`}
            />
            <span className="flex-1">{e.texto}</span>
            {e.atajo && <span className="ml-3.5 font-mono text-[11px] text-muy">{e.atajo}</span>}
          </button>
        ),
      )}
    </div>
  );
}
