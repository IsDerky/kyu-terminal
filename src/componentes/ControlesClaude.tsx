// Controles del panel de Claude: modo, modelo y esfuerzo bajo la caja de texto, menú de
// comandos con barra y desglose del contexto.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AtSign, Check, ChevronDown, ChevronRight, Gauge, ImagePlus, Minimize2, UserRound } from "lucide-react";
import {
  cambiarCuenta,
  cambiarEsfuerzo,
  cambiarModelo,
  cambiarModo,
  enviar,
  esfuerzoEnCaliente,
  limiteContexto,
  useClaude,
  type Conversacion,
} from "../lib/claude";
import {
  ayudaModelo,
  ESFUERZOS,
  esfuerzos,
  esVersionFija,
  modeloDe,
  modo as datosModo,
  modosDisponibles,
  nombreCategoria,
  nombreModelo,
  partirDescripcion,
  type Comando,
} from "../lib/claudeOpciones";

const miles = (n: number) => n.toLocaleString("es-ES");
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("es-ES", { maximumFractionDigits: n < 10_000 ? 1 : 0 })}k` : String(n));

// ---------- Desplegable ----------

interface Opcion {
  valor: string | null;
  titulo: string;
  ayuda?: string;
  desactivada?: string;
  /** Va plegada bajo «Versiones anteriores». */
  anterior?: boolean;
}

function Desplegable({
  etiqueta,
  ayuda,
  opciones,
  valor,
  alElegir,
  ancho = 250,
  cabecera,
  fijo = false,
  derecha = false,
}: {
  fijo?: boolean;
  /** Abre pegado al borde derecho de la barra (el contenedor con `relative`), no del botón. */
  derecha?: boolean;
  etiqueta: React.ReactNode;
  ayuda: string;
  opciones: Opcion[];
  valor: string | null;
  alElegir: (v: string | null) => void;
  ancho?: number;
  cabecera: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const actuales = opciones.filter((o) => !o.anterior);
  const anteriores = opciones.filter((o) => o.anterior);
  // Si lo elegido es una versión anterior, se ve sin tener que desplegar.
  const desplegadas = verAnteriores || anteriores.some((o) => o.valor === valor);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    window.addEventListener("mousedown", fuera);
    return () => window.removeEventListener("mousedown", fuera);
  }, [abierto]);

  return (
    <div ref={caja} className={`${derecha ? "" : "relative"} ${fijo ? "flex-none" : "min-w-0"}`}>
      <button
        type="button"
        title={ayuda}
        onClick={() => {
          setAbierto((a) => !a);
          setVerAnteriores(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && abierto) {
            e.preventDefault();
            e.stopPropagation();
            setAbierto(false);
          }
        }}
        className={`flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-[11.5px] hover:bg-hover ${abierto ? "bg-hover" : ""}`}
      >
        {etiqueta}
        <ChevronDown size={11} className="flex-none text-muy" />
      </button>
      {abierto && (
        <div
          style={{ width: ancho }}
          className={`absolute bottom-full ${derecha ? "right-1" : "left-0"} z-30 mb-1.5 max-h-[min(460px,70vh)] overflow-y-auto rounded-lg border border-borde2 bg-tarjeta py-1 shadow-[0_12px_32px_-12px_#000]`}
        >
          <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muy">{cabecera}</p>
          {[...actuales, ...(desplegadas ? anteriores : [])].map((o, i) => (
            <div key={o.valor ?? "_"}>
            {anteriores.length > 0 && i === actuales.length && <Separador />}
            <button
              type="button"
              disabled={!!o.desactivada}
              title={o.desactivada}
              onClick={() => {
                setAbierto(false);
                if (o.valor !== valor) alElegir(o.valor);
              }}
              className={`flex w-full items-start gap-2 px-3 text-left hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent ${o.anterior ? "py-1" : "py-1.5"}`}
            >
              <span className="mt-[3px] w-3 flex-none">{o.valor === valor && <Check size={12} className="text-acento" />}</span>
              <span className="min-w-0">
                <span className={`block ${o.anterior ? "text-[12px] text-tenue" : "text-[12.5px] text-texto"}`}>{o.titulo}</span>
                {o.ayuda && <span className="block text-[11px] leading-snug text-tenue">{o.ayuda}</span>}
              </span>
            </button>
            </div>
          ))}
          {anteriores.length > 0 && !desplegadas && (
            <>
              <Separador />
              <button
                type="button"
                onClick={() => setVerAnteriores(true)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-tenue hover:bg-hover hover:text-texto"
              >
                <ChevronRight size={12} className="flex-none" />
                Versiones anteriores
                <span className="ml-auto text-muy">{anteriores.length}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const Separador = () => <div className="mx-3 my-1 border-t border-borde" />;

// ---------- Cuenta (pie del panel) ----------

/** Selector de cuenta de Claude; solo sale con dos o más cuentas en kyu.toml. */
export function SelectorCuenta({ espacio, c }: { espacio: string; c: Conversacion }) {
  const cuentas = useClaude((s) => s.cuentas);
  if (cuentas.length < 2) return null;
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  const actual = c.cuenta ?? cuentas[0];
  return (
    <Desplegable
      cabecera="Cuenta de Claude"
      derecha
      fijo
      ayuda={
        c.claudeId !== null
          ? `Cuenta: ${actual} · al cambiarla, la conversación sigue con la otra cuenta`
          : `Cuenta: ${actual}`
      }
      valor={actual}
      alElegir={(v) => v && cambiarCuenta(espacio, v)}
      ancho={220}
      etiqueta={
        <span className="flex min-w-0 items-center gap-1.5 text-tenue">
          <UserRound size={12} strokeWidth={1.8} className="flex-none" />
          <span className="max-w-[80px] truncate">{actual}</span>
        </span>
      }
      opciones={cuentas.map((n) => ({
        valor: n,
        titulo: n,
        desactivada: ocupado && n !== actual ? "Espera a que Claude acabe" : undefined,
      }))}
    />
  );
}

// ---------- Barra bajo la caja ----------

export function BarraOpciones({
  espacio,
  c,
  alArroba,
  alImagen,
}: {
  espacio: string;
  c: Conversacion;
  alArroba: () => void;
  alImagen: () => void;
}) {
  const catalogo = useClaude((s) => s.catalogo);
  const elegido = modeloDe(catalogo, c.eleccionModelo);
  const m = datosModo(c.modo);
  const niveles = esfuerzos(elegido);
  const enMarcha = c.claudeId !== null;

  const modelos: Opcion[] = catalogo?.models.length
    ? catalogo.models.map((x) => ({
        valor: x.value === "default" ? null : x.value,
        titulo: x.value === "default" ? `Predeterminado · ${nombreModelo(x, "")}` : x.displayName,
        ayuda: esVersionFija(x.value) ? undefined : ayudaModelo(x),
        anterior: esVersionFija(x.value),
      }))
    : [
        { valor: null, titulo: "Predeterminado" },
        { valor: "opus", titulo: "Opus" },
        { valor: "sonnet", titulo: "Sonnet" },
        { valor: "haiku", titulo: "Haiku" },
      ];

  return (
    <div className="relative flex h-8 items-center gap-0.5 pl-1.5 pr-9">
      <Desplegable
        cabecera="Modo · Mayús+Tab"
        fijo
        ayuda={`${m.nombre}: ${m.ayuda} (Mayús+Tab para cambiar)`}
        valor={c.modo}
        alElegir={(v) => v && void cambiarModo(espacio, v)}
        ancho={270}
        etiqueta={
          <span className={`flex min-w-0 items-center gap-1.5 ${m.color || "text-tenue"}`}>
            <m.Icono size={12} strokeWidth={2} className="flex-none" />
            <span className="truncate">{m.corto}</span>
          </span>
        }
        opciones={modosDisponibles(elegido).map((x) => ({ valor: x.id, titulo: x.nombre, ayuda: x.ayuda }))}
      />
      <button
        type="button"
        title="Mencionar un archivo (@)"
        onClick={alArroba}
        className="grid size-6 flex-none place-items-center rounded-md text-muy hover:bg-hover hover:text-texto"
      >
        <AtSign size={12} strokeWidth={2} />
      </button>
      <button
        type="button"
        title="Adjuntar imagen (también se puede pegar o soltar)"
        onClick={alImagen}
        className="grid size-6 flex-none place-items-center rounded-md text-muy hover:bg-hover hover:text-texto"
      >
        <ImagePlus size={12} strokeWidth={2} />
      </button>
      <span className="ml-auto" />
      <Desplegable
        cabecera="Modelo"
        derecha
        ayuda={enMarcha ? "Modelo (se aplica desde el próximo mensaje)" : "Modelo"}
        valor={c.eleccionModelo}
        alElegir={(v) => void cambiarModelo(espacio, v)}
        ancho={280}
        etiqueta={
          <span className="flex min-w-0 items-center text-tenue">
            <span className="truncate">{nombreModelo(elegido, c.eleccionModelo ?? c.modelo) || "Predeterminado"}</span>
          </span>
        }
        opciones={modelos}
      />
      {niveles.length > 0 && (
        <Desplegable
          cabecera="Esfuerzo"
          derecha
          fijo
          ayuda="Cuánto piensa Claude antes de contestar"
          valor={c.esfuerzo}
          alElegir={(v) => void cambiarEsfuerzo(espacio, v)}
          ancho={210}
          etiqueta={
            <span className="flex items-center gap-1.5 text-tenue">
              <Gauge size={12} strokeWidth={1.8} className="flex-none" />
              {c.esfuerzo ? ESFUERZOS[c.esfuerzo] ?? c.esfuerzo : "Auto"}
            </span>
          }
          opciones={[
            { valor: null, titulo: "Auto", ayuda: "El que decida Claude Code para el modelo" },
            ...niveles.map((n) => ({
              valor: n,
              titulo: ESFUERZOS[n] ?? n,
              desactivada: enMarcha && !esfuerzoEnCaliente(n) ? "Solo al empezar una conversación" : undefined,
            })),
          ]}
        />
      )}
    </div>
  );
}

// ---------- Comandos con barra ----------

/** Comandos que encajan con lo escrito («/com» → compact, …): primero los que empiezan así. */
export function filtrarComandos(lista: Comando[], texto: string): Comando[] | null {
  const m = texto.match(/^\/(\S*)$/);
  if (!m) return null;
  const q = m[1].toLowerCase();
  const empiezan = lista.filter((c) => c.name.toLowerCase().startsWith(q));
  const contienen = q ? lista.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)) : [];
  return [...empiezan, ...contienen];
}

export function MenuComandos({
  comandos,
  elegido,
  alElegir,
  alPasar,
}: {
  comandos: Comando[];
  elegido: number;
  alElegir: (c: Comando) => void;
  alPasar: (i: number) => void;
}) {
  const lista = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    lista.current?.querySelector(`[data-i="${elegido}"]`)?.scrollIntoView({ block: "nearest" });
  }, [elegido]);

  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-1.5 overflow-hidden rounded-lg border border-borde2 bg-tarjeta shadow-[0_12px_32px_-12px_#000]">
      <div ref={lista} className="max-h-[260px] overflow-y-auto overflow-x-hidden py-1">
        {comandos.length === 0 && <p className="px-3 py-2 text-[12px] text-muy">Ningún comando empieza así</p>}
        {comandos.map((c, i) => {
          const [desc, origen] = partirDescripcion(c.description);
          return (
            <button
              key={c.name}
              type="button"
              data-i={i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => alElegir(c)}
              onMouseMove={() => alPasar(i)}
              className={`flex w-full items-baseline gap-2 px-3 py-[5px] text-left ${i === elegido ? "bg-hover" : ""}`}
            >
              <span className="flex-none font-mono text-[11.5px] text-texto">/{c.name}</span>
              {c.argumentHint && (
                <span title={c.argumentHint} className="min-w-0 max-w-[45%] flex-none truncate font-mono text-[11px] text-muy">
                  {c.argumentHint}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-tenue">{desc}</span>
              {origen && <span className="flex-none text-[10.5px] text-muy">{origen}</span>}
            </button>
          );
        })}
      </div>
      <p className="border-t border-borde px-3 py-1 text-[10.5px] text-muy">↑↓ elegir · Tab o Intro completar · Esc cerrar</p>
    </div>
  );
}

// ---------- Desglose del contexto ----------

/** Tono de cada categoría: mensajes en morado, lo demás en grises; la reserva rayada. */
function colorCategoria(n: string) {
  switch (n) {
    case "Messages":
      return "#a78bfa";
    case "System prompt":
      return "#8b8b96";
    case "System tools":
      return "#6b6b76";
    case "Free space":
      return "transparent";
    case "Autocompact buffer":
      return "repeating-linear-gradient(135deg,#3a3a42 0 2px,transparent 2px 5px)";
    default:
      return "#c4b5fd";
  }
}

export function DesgloseContexto({ espacio, c, alCerrar }: { espacio: string; c: Conversacion; alCerrar: () => void }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!caja.current?.contains(t) && !t.closest("[data-boton-contexto]")) alCerrar();
    };
    window.addEventListener("mousedown", fuera);
    return () => window.removeEventListener("mousedown", fuera);
  }, [alCerrar]);

  const u = c.contexto;
  const max = limiteContexto(c);
  const visibles = u?.categories.filter((x) => !x.isDeferred && x.tokens > 0) ?? [];
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";

  return (
    <div
      ref={caja}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), alCerrar())}
      className="absolute right-2 top-12 z-30 w-[300px] rounded-lg border border-borde2 bg-tarjeta p-3 shadow-[0_12px_32px_-12px_#000]"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12.5px] font-semibold">Contexto</span>
        <span className="text-[11.5px] text-tenue">
          {k(u?.totalTokens ?? c.tokens)} de {k(max)} · {u?.percentage ?? Math.round((c.tokens / max) * 100)} %
        </span>
      </div>
      {!u ? (
        <p className="text-[12px] leading-relaxed text-tenue">
          {c.claudeId === null ? "Empieza la conversación para ver en qué se va el contexto." : "Cargando…"}
        </p>
      ) : (
        <>
          <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-hover">
            {visibles
              .filter((x) => x.name !== "Free space")
              .map((x) => (
                <span
                  key={x.name}
                  title={`${nombreCategoria(x.name)}: ${miles(x.tokens)}`}
                  style={{ width: `${(x.tokens / u.maxTokens) * 100}%`, background: colorCategoria(x.name) }}
                  className="h-full min-w-[2px] border-r border-tarjeta last:border-r-0"
                />
              ))}
          </div>
          <ul className="flex flex-col gap-1">
            {visibles.map((x) => (
              <li key={x.name} className="flex items-center gap-2 text-[11.5px]">
                <span
                  style={{ background: colorCategoria(x.name) }}
                  className={`size-2 flex-none rounded-[2px] ${x.name === "Free space" ? "border border-borde2" : ""}`}
                />
                <span className="min-w-0 flex-1 truncate text-tenue">{nombreCategoria(x.name)}</span>
                <span className="tabular-nums text-texto">{k(x.tokens)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        disabled={c.claudeId === null || ocupado}
        onClick={() => {
          alCerrar();
          void enviar(espacio, "/compact");
        }}
        className="mt-3 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-borde2 text-[12px] text-texto hover:bg-hover disabled:opacity-40"
      >
        <Minimize2 size={12} strokeWidth={1.8} />
        Compactar ahora
      </button>
    </div>
  );
}
