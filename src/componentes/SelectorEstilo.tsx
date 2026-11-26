import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { COLORES, ICONOS, useSelectorEstilo } from "../lib/estiloPestana";
import { useKyu } from "../lib/estado";

/** Color e icono de una pestaña de terminal; se ve el cambio al momento. */
export default function SelectorEstilo() {
  const abierto = useSelectorEstilo((s) => s.abierto);
  const cerrar = useSelectorEstilo((s) => s.cerrar);
  const it = useKyu((s) => (abierto ? s.items[abierto.item] : undefined));
  const caja = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!abierto || !caja.current) return setPos(null);
    const r = caja.current.getBoundingClientRect();
    let { x, y } = abierto;
    if (x + r.width > window.innerWidth - 4) x = Math.max(4, x - r.width);
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - r.height - 4);
    setPos({ x, y });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && cerrar();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") (e.preventDefault(), e.stopPropagation(), cerrar());
    };
    window.addEventListener("mousedown", fuera, true);
    window.addEventListener("keydown", tecla, true);
    window.addEventListener("blur", cerrar);
    return () => {
      window.removeEventListener("mousedown", fuera, true);
      window.removeEventListener("keydown", tecla, true);
      window.removeEventListener("blur", cerrar);
    };
  }, [abierto, cerrar]);

  if (!abierto || !it || it.tipo !== "terminal") return null;
  const pintar = (cambio: { color?: string | null; icono?: string | null }) => useKyu.getState().pintarItem(abierto.item, cambio);

  return (
    <div
      ref={caja}
      role="dialog"
      aria-label="Color e icono de la pestaña"
      style={{ left: pos?.x ?? abierto.x, top: pos?.y ?? abierto.y, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-[60] w-[232px] rounded-[10px] border border-borde2 bg-[#141417f2] p-2.5 text-[12px] text-texto shadow-[0_18px_50px_#000c] backdrop-blur"
    >
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muy">Color</div>
      <div className="mb-3 grid grid-cols-8 gap-1">
        {COLORES.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.nombre}
            onClick={() => pintar({ color: it.color === c.id ? null : c.id })}
            className="grid size-[22px] place-items-center rounded-full ring-offset-2 ring-offset-[#141417] hover:ring-1 hover:ring-borde2"
            style={{ background: c.valor }}
          >
            {it.color === c.id && <Check size={12} strokeWidth={3} className="text-[#0b0b0d]" />}
          </button>
        ))}
      </div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muy">Icono</div>
      <div className="grid grid-cols-6 gap-1">
        {ICONOS.map(({ id, nombre, icono: Icono }) => (
          <button
            key={id}
            type="button"
            title={nombre}
            onClick={() => pintar({ icono: it.icono === id ? null : id })}
            className={`grid h-7 place-items-center rounded-md ${it.icono === id ? "bg-acento/20 text-texto" : "text-tenue hover:bg-hover hover:text-texto"}`}
          >
            <Icono size={14} strokeWidth={1.8} />
          </button>
        ))}
      </div>
      {(it.color || it.icono) && (
        <button
          type="button"
          onClick={() => pintar({ color: null, icono: null })}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-borde2 py-1 text-[11.5px] text-tenue hover:text-texto"
        >
          <RotateCcw size={11} /> Volver al del perfil
        </button>
      )}
    </div>
  );
}
