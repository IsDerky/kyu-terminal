// Controles del panel de Claude: modo, modelo y esfuerzo bajo la caja de texto, menú de
// comandos con barra y desglose del contexto.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AtSign, Bot, Check, ChevronDown, ChevronRight, Gauge, ImagePlus, Minimize2, UserRound, X } from "lucide-react";
import {
  AGENTES,
  nombreAgente,
  ponerAgente,
  cambiarCuenta,
  cambiarEsfuerzo,
  cambiarModelo,
  cambiarModo,
  cambiarOpcionAgente,
  enviar,
  opcionesDe,
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
import { agotada, claveCuenta, describir, horaReinicio, peor, porcentaje, useLimites } from "../lib/limites";
import { useSesiones } from "../lib/sesiones";
import { nombreValor, opcionPor } from "../lib/agentes";
import type { OpcionAgente } from "../lib/nucleo";

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

const colorUso = (uso: number) => (uso >= 0.9 ? "var(--color-mal)" : uso >= 0.7 ? "var(--color-aviso)" : "var(--color-claude2)");

/** «5 h 31 %» con su barrita: lo que más aprieta de la cuenta (sesión de 5 h o semana). */
export function LimiteCuenta({ c }: { c: Conversacion }) {
  const cuentas = useClaude((s) => s.cuentas);
  const l = useLimites((s) => s.porCuenta[claveCuenta(c.cuenta, cuentas)]);
  const p = peor(l);
  if (!p) return null;
  const color = colorUso(p.v.uso);
  return (
    <span className="flex flex-none items-center gap-1.5" title={`Uso de la cuenta · ${describir(l)}`}>
      <span style={{ color: p.v.uso >= 0.7 ? color : undefined }}>
        {p.nombre === "sesion" ? "5 h" : "Sem."} {porcentaje(p.v)} %
      </span>
      <span className="h-[5px] w-8 overflow-hidden rounded-full bg-hover">
        <span className="block h-full rounded-full" style={{ width: `${porcentaje(p.v)}%`, background: color }} />
      </span>
    </span>
  );
}

/** Encima de la caja, con la cuenta al 90 % o rechazada: cuándo se reinicia y pasar a otra. */
/** Avisos de límite cerrados con la X: vuelven con la siguiente ventana (otro reinicio). */
const cerrados = new Set<string>();

export function AvisoLimite({ espacio, c }: { espacio: string; c: Conversacion }) {
  const cuentas = useClaude((s) => s.cuentas);
  const porCuenta = useLimites((s) => s.porCuenta);
  const sesiones = useSesiones((s) => s.porCuenta);
  const [, setCerrado] = useState(0);
  const actual = claveCuenta(c.cuenta, cuentas);
  const l = porCuenta[actual];
  if (!agotada(l)) return null;
  const p = peor(l);
  const clave = `${actual}|${p?.nombre ?? ""}|${p?.v.reinicio ?? ""}`;
  if (cerrados.has(clave)) return null;
  // La otra cuenta con sesión y menos uso (sin datos cuenta como libre).
  const otra = cuentas
    .filter((n) => n !== actual && sesiones?.[n] !== false)
    .map((n) => ({ n, uso: peor(porCuenta[n])?.v.uso ?? 0 }))
    .filter((x) => x.uso < 0.9)
    .sort((a, b) => a.uso - b.uso)[0]?.n;
  const ocupado = c.estado === "arrancando" || c.estado === "pensando";
  return (
    // Pestaña pegada encima de la caja: algo más estrecha, sin borde abajo y sin hueco.
    <div className="mx-3 flex items-center gap-2 rounded-t-lg border border-b-0 border-aviso/30 bg-aviso/[0.06] py-1.5 pl-3 pr-1.5 text-[12px] text-tenue">
      <span className="min-w-0 flex-1">
        {cuentas.length > 1 ? `«${actual}» está` : "La cuenta está"}{" "}
        {p ? `al ${porcentaje(p.v)} % de la ${p.nombre === "sesion" ? "sesión de 5 h" : "semana"}` : "en su límite"}
        {p?.v.reinicio ? `; se reinicia ${horaReinicio(p.v.reinicio)}` : ""}.
      </span>
      {otra && (
        <button
          type="button"
          disabled={ocupado}
          title={ocupado ? "Espera a que Claude acabe" : "La conversación sigue con la otra cuenta"}
          onClick={() => cambiarCuenta(espacio, otra)}
          className="flex-none rounded-full border border-acento/40 bg-acento/10 px-2.5 py-0.5 text-[11.5px] text-acento2 hover:bg-acento/20 disabled:opacity-40"
        >
          Seguir con «{otra}»
        </button>
      )}
      <button
        type="button"
        title="Cerrar el aviso"
        onClick={() => {
          cerrados.add(clave);
          setCerrado((n) => n + 1);
        }}
        className="grid size-6 flex-none place-items-center rounded-md text-muy hover:bg-hover hover:text-texto"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Selector de cuenta de Claude; solo sale con dos o más cuentas en kyu.toml. */
export function SelectorCuenta({ espacio, c }: { espacio: string; c: Conversacion }) {
  const cuentas = useClaude((s) => s.cuentas);
  const porCuenta = useLimites((s) => s.porCuenta);
  const sesiones = useSesiones((s) => s.porCuenta);
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
        ayuda: sesiones?.[n] === false ? "Sin sesión" : describir(porCuenta[n]) || undefined,
        desactivada:
          n === actual
            ? undefined
            : sesiones?.[n] === false
              ? "Sin sesión: iníciala en Ajustes → Claude → Cuentas"
              : ocupado
                ? "Espera a que Claude acabe"
                : undefined,
      }))}
    />
  );
}

/** Selector de cuenta de Antigravity; solo sale con dos o más cuentas en kyu.toml. */
export function SelectorCuentaAntigravity({ espacio, c }: { espacio: string; c: Conversacion }) {
  const cuentas = useClaude((s) => s.cuentasAntigravity);
  if (cuentas.length < 2) return null;
  const ocupado = c.claudeId !== null;
  const actual = c.cuenta ?? cuentas[0];
  return (
    <Desplegable
      cabecera="Cuenta de Antigravity"
      derecha
      fijo
      ayuda={ocupado ? `Cuenta: ${actual}` : `Cuenta: ${actual} · se aplica al próximo mensaje`}
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
        desactivada: n === actual ? undefined : ocupado ? "Espera a que acabe" : undefined,
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
  if (c.agente) return <BarraAgente espacio={espacio} c={c} alArroba={alArroba} alImagen={alImagen} />;
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
    // pr-16: hueco fijo para dos botones a la derecha (Enviar, o «Dejar en cola» + Parar)
    // para que el de la cola no tape el selector de razonamiento al aparecer.
    // En una barra estrecha el modo y el esfuerzo se quedan en su icono (el nombre sigue en la ayuda).
    <div className="@container relative flex h-8 items-center gap-0.5 pl-1.5 pr-16">
      <SelectorAgente espacio={espacio} c={c} />
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
            <span className="hidden truncate @[20rem]:inline">{m.corto}</span>
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
              <span className="hidden @[17rem]:inline">{c.esfuerzo ? ESFUERZOS[c.esfuerzo] ?? c.esfuerzo : "Auto"}</span>
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

/** Quién contesta: solo se puede cambiar antes del primer mensaje. */
function SelectorAgente({ espacio, c }: { espacio: string; c: Conversacion }) {
  if (c.claudeId !== null || c.entradas.length) return null;
  return (
    <Desplegable
      cabecera="Quién contesta"
      fijo
      ayuda={`${nombreAgente(c)} (se elige antes del primer mensaje)`}
      valor={c.agente}
      alElegir={(v) => ponerAgente(espacio, v)}
      ancho={260}
      etiqueta={
        <span className="flex min-w-0 items-center gap-1.5 text-tenue">
          <Bot size={12} strokeWidth={2} className="flex-none" />
          <span className="hidden truncate @[20rem]:inline">{nombreAgente(c)}</span>
        </span>
      }
      opciones={[
        { valor: null, titulo: "Claude", ayuda: "Claude Code, con tu cuenta de Claude" },
        ...Object.entries(AGENTES).map(([id, nombre]) => ({
          valor: id,
          titulo: nombre,
          ayuda: id === "antigravity" ? "Antigravity CLI (agy): modelos de Google con tu cuenta" : undefined,
        })),
      ]}
    />
  );
}

/** Modo de un agente: icono y color como los de Claude para los que se parecen. */
const MODO_AGENTE: Record<string, string> = { default: "default", "accept-edits": "acceptEdits", auto: "auto", plan: "plan" };

/** Barra de una conversación con otro agente: sus opciones (modo, modelo, razonamiento). */
function BarraAgente({ espacio, c, alArroba, alImagen }: { espacio: string; c: Conversacion; alArroba: () => void; alImagen: () => void }) {
  const opciones = opcionesDe(c);
  const modo = opcionPor(opciones, "mode");
  const modelo = opcionPor(opciones, "model");
  const razonamiento = opcionPor(opciones, "thought_level");
  const otras = opciones.filter((o) => o !== modo && o !== modelo && o !== razonamiento);
  const enMarcha = c.claudeId !== null;
  const m = datosModo(MODO_AGENTE[modo?.actual ?? ""] ?? "default");
  const valores = (o: OpcionAgente): Opcion[] => o.valores.map((v) => ({ valor: v.valor, titulo: v.nombre, ayuda: v.ayuda ?? undefined }));
  const elegir = (o: OpcionAgente) => (v: string | null) => v && void cambiarOpcionAgente(espacio, o.id, v);
  return (
    <div className="@container relative flex h-8 items-center gap-0.5 pl-1.5 pr-16">
      <SelectorAgente espacio={espacio} c={c} />
      {modo && (
        <Desplegable
          cabecera="Modo · Mayús+Tab"
          fijo
          ayuda={`${nombreValor(modo)}: ${modo.valores.find((v) => v.valor === modo.actual)?.ayuda ?? ""} (Mayús+Tab para cambiar)`}
          valor={modo.actual}
          alElegir={elegir(modo)}
          ancho={290}
          etiqueta={
            <span className={`flex min-w-0 items-center gap-1.5 ${m.color || "text-tenue"}`}>
              <m.Icono size={12} strokeWidth={2} className="flex-none" />
              <span className="hidden truncate @[20rem]:inline">{nombreValor(modo)}</span>
            </span>
          }
          opciones={valores(modo)}
        />
      )}
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
      {otras.map((o) => (
        <Desplegable
          key={o.id}
          cabecera={o.nombre}
          derecha
          fijo
          ayuda={o.nombre}
          valor={o.actual}
          alElegir={elegir(o)}
          ancho={240}
          etiqueta={<span className="truncate text-tenue">{nombreValor(o)}</span>}
          opciones={valores(o)}
        />
      ))}
      {modelo ? (
        <Desplegable
          cabecera="Modelo"
          derecha
          ayuda={enMarcha ? `Modelo de ${nombreAgente(c)} (se aplica desde el próximo mensaje)` : `Modelo de ${nombreAgente(c)}`}
          valor={modelo.actual}
          alElegir={elegir(modelo)}
          ancho={280}
          etiqueta={
            <span className="flex min-w-0 items-center text-tenue">
              <span className="truncate">{nombreValor(modelo)}</span>
            </span>
          }
          opciones={valores(modelo)}
        />
      ) : (
        c.modelo && (
          <span title="Modelo que contesta" className="truncate px-1.5 text-[11.5px] text-tenue">
            {c.modelo}
          </span>
        )
      )}
      {razonamiento && (
        <Desplegable
          cabecera="Razonamiento"
          derecha
          fijo
          ayuda="Cuánto piensa el modelo antes de contestar"
          valor={razonamiento.actual}
          alElegir={elegir(razonamiento)}
          ancho={210}
          etiqueta={
            <span className="flex items-center gap-1.5 text-tenue">
              <Gauge size={12} strokeWidth={1.8} className="flex-none" />
              <span className="hidden @[17rem]:inline">{nombreValor(razonamiento)}</span>
            </span>
          }
          opciones={valores(razonamiento)}
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
