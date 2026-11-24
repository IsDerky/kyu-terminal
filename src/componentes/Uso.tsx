import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, BarChart3, Clock, Loader2, MessageSquare, Table2, Zap, type LucideIcon } from "lucide-react";

interface Dia {
  fecha: string;
  salida: number;
  entrada: number;
  cache_leida: number;
  cache_creada: number;
  peticiones: number;
}
interface Parte {
  nombre: string;
  salida: number;
}
interface UsoVista {
  carpeta: string;
  dias: Dia[];
  proyectos: Parte[];
  modelos: Parte[];
  sesiones: number;
}

/** Barras: un paso más oscuro que el acento, validado sobre el fondo del panel. */
const COLOR = "#9b7cf4";
const RAYADO = `repeating-linear-gradient(135deg, ${COLOR} 0 3px, #6d4fd0 3px 6px)`;

const entero = (n: number) => n.toLocaleString("es-ES");
function corto(n: number) {
  if (n >= 1e9) return [(n / 1e9).toLocaleString("es-ES", { maximumFractionDigits: 2 }), "G"];
  if (n >= 1e6) return [(n / 1e6).toLocaleString("es-ES", { maximumFractionDigits: n >= 1e8 ? 0 : 2 }), "M"];
  if (n >= 1e3) return [(n / 1e3).toLocaleString("es-ES", { maximumFractionDigits: 0 }), "k"];
  return [entero(n), ""];
}
const cortoTexto = (n: number) => corto(n).join(" ").trim();
const porcentaje = (p: number) =>
  p > 0 && p < 0.01 ? "< 0,01 %" : `${p.toLocaleString("es-ES", { maximumFractionDigits: p < 1 ? 2 : 1 })} %`;

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function etiquetaDia(fecha: string) {
  const [y, m, d] = fecha.split("-").map(Number);
  return { semana: DIAS_SEMANA[new Date(y, m - 1, d).getDay()], dia: d };
}

/** Pestaña especial: tokens de Claude Code leídos de sus registros en este PC. */
export default function Uso() {
  const [dias, setDias] = useState(7);
  const [datos, setDatos] = useState<UsoVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tabla, setTabla] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    invoke<UsoVista>("uso_leer", { dias, desfaseMin: new Date().getTimezoneOffset() }).then(
      (d) => vivo && (setDatos(d), setError(null), setCargando(false)),
      (e) => vivo && (setError(String(e)), setCargando(false)),
    );
    return () => {
      vivo = false;
    };
  }, [dias]);

  const total = (f: (d: Dia) => number) => datos?.dias.reduce((s, d) => s + f(d), 0) ?? 0;
  const salida = total((d) => d.salida);
  const leida = total((d) => d.cache_leida);
  const entradaTotal = leida + total((d) => d.entrada) + total((d) => d.cache_creada);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex items-center gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <BarChart3 size={16} strokeWidth={1.8} /> Uso de Claude Code
          </h2>
          {cargando && <Loader2 size={13} className="animate-spin text-muy" />}
          <div className="ml-auto flex rounded-md border border-borde2 p-0.5 text-[12px]">
            {[7, 30].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDias(n)}
                className={`rounded px-2.5 py-0.5 ${dias === n ? "bg-hover text-texto" : "text-tenue hover:text-texto"}`}
              >
                {n} días
              </button>
            ))}
          </div>
        </div>
        <p className="mb-5 mt-0.5 text-[12px] text-muy">
          Últimos {dias} días · este PC · leído de <span className="font-mono">{datos?.carpeta ?? "~/.claude/projects"}</span>
        </p>
        {error && <p className="mb-4 text-[12.5px] text-mal">{error}</p>}

        {datos && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <Cifra icono={ArrowUpRight} titulo="Tokens de salida" valor={salida} nota="lo que escribe Claude" />
              <Cifra
                icono={Zap}
                titulo="Leído de caché"
                valor={leida}
                nota={entradaTotal ? `${porcentaje((leida / entradaTotal) * 100)} de la entrada` : "sin datos"}
              />
              <Cifra icono={MessageSquare} titulo="Peticiones" valor={total((d) => d.peticiones)} nota="respuestas del modelo" completo />
              <Cifra icono={Clock} titulo="Sesiones" valor={datos.sesiones} nota="conversaciones con actividad" completo />
            </div>

            <div className="mt-3 grid grid-cols-[1.6fr_1fr] gap-3">
              <section className="rounded-[10px] border border-borde bg-panel p-4">
                <div className="mb-3 flex items-center gap-3 text-[12.5px] font-medium">
                  Tokens de salida por día
                  <span className="flex items-center gap-1.5 text-[11px] font-normal text-muy">
                    <i className="inline-block size-2.5 rounded-sm" style={{ background: RAYADO }} /> hoy, en curso
                  </span>
                  <button
                    type="button"
                    onClick={() => setTabla(!tabla)}
                    className="ml-auto flex items-center gap-1 text-[11.5px] font-normal text-tenue hover:text-texto"
                  >
                    {tabla ? <BarChart3 size={12} /> : <Table2 size={12} />} {tabla ? "Ver gráfica" : "Ver tabla"}
                  </button>
                </div>
                {tabla ? <TablaDias dias={datos.dias} /> : <Barras dias={datos.dias} />}
              </section>

              <section className="rounded-[10px] border border-borde bg-panel p-4">
                <Reparto titulo="Por proyecto" partes={datos.proyectos} total={salida} />
                <div className="h-4" />
                <Reparto titulo="Por modelo" partes={datos.modelos} total={salida} />
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Cifra({ icono: Icono, titulo, valor, nota, completo }: { icono: LucideIcon; titulo: string; valor: number; nota: string; completo?: boolean }) {
  const [n, u] = completo ? [entero(valor), ""] : corto(valor);
  return (
    <div className="rounded-[10px] border border-borde bg-panel px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-tenue">
        <Icono size={12} strokeWidth={1.8} /> {titulo}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums leading-tight">
        {n}
        {u && <small className="ml-0.5 text-[14px] font-medium text-tenue">{u}</small>}
      </div>
      <div className="text-[11px] text-muy">{nota}</div>
    </div>
  );
}

const ALTO = 170;

function Barras({ dias }: { dias: Dia[] }) {
  const [encima, setEncima] = useState<number | null>(null);
  const max = Math.max(1, ...dias.map((d) => d.salida));
  const muchos = dias.length > 10;
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px] border-b border-borde" style={{ height: ALTO + 18 }}>
        {dias.map((d, i) => {
          const hoy = i === dias.length - 1;
          const alto = d.salida ? Math.max(3, (d.salida / max) * ALTO) : 0;
          return (
            <div
              key={d.fecha}
              onMouseEnter={() => setEncima(i)}
              onMouseLeave={() => setEncima(null)}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
            >
              {!muchos && d.salida > 0 && <span className="mb-1 text-[10.5px] tabular-nums text-muy">{cortoTexto(d.salida)}</span>}
              <div
                className="w-full max-w-9 rounded-t-[4px]"
                style={{
                  height: alto || 1,
                  background: d.salida ? (hoy ? RAYADO : COLOR) : "var(--color-borde2)",
                  opacity: encima === null || encima === i ? 1 : 0.55,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {dias.map((d, i) => {
          const e = etiquetaDia(d.fecha);
          const hoy = i === dias.length - 1;
          const ver = !muchos || i % 5 === 0 || hoy;
          return (
            <span key={d.fecha} className={`flex-1 text-center text-[10.5px] ${hoy ? "text-texto" : "text-muy"}`}>
              {ver ? (muchos ? e.dia : `${e.semana} ${e.dia}`) : ""}
            </span>
          );
        })}
      </div>
      {encima !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-borde2 bg-tarjeta px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={{
            left: `${((encima + 0.5) / dias.length) * 100}%`,
            transform: `translateX(${encima > dias.length / 2 ? "-100%" : "0"})`,
          }}
        >
          <div className="font-medium">
            {etiquetaDia(dias[encima].fecha).semana} {dias[encima].fecha.split("-").reverse().join("-")}
            {encima === dias.length - 1 && <span className="text-muy"> · en curso</span>}
          </div>
          <Fila n="Salida" v={entero(dias[encima].salida)} />
          <Fila n="Caché leída" v={cortoTexto(dias[encima].cache_leida)} />
          <Fila n="Peticiones" v={entero(dias[encima].peticiones)} />
        </div>
      )}
    </div>
  );
}

function Fila({ n, v }: { n: string; v: string }) {
  return (
    <div className="flex justify-between gap-6 text-tenue">
      {n}
      <span className="tabular-nums text-texto">{v}</span>
    </div>
  );
}

function TablaDias({ dias }: { dias: Dia[] }) {
  return (
    <div className="max-h-[220px] overflow-y-auto">
      <table className="w-full text-[11.5px] tabular-nums">
        <thead className="text-left text-muy">
          <tr>
            <th className="py-1 font-normal">Día</th>
            <th className="py-1 text-right font-normal">Salida</th>
            <th className="py-1 text-right font-normal">Caché leída</th>
            <th className="py-1 text-right font-normal">Peticiones</th>
          </tr>
        </thead>
        <tbody>
          {[...dias].reverse().map((d) => (
            <tr key={d.fecha} className="border-t border-borde">
              <td className="py-1 text-tenue">{d.fecha.split("-").reverse().join("-")}</td>
              <td className="py-1 text-right">{entero(d.salida)}</td>
              <td className="py-1 text-right">{cortoTexto(d.cache_leida)}</td>
              <td className="py-1 text-right">{entero(d.peticiones)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reparto({ titulo, partes, total }: { titulo: string; partes: Parte[]; total: number }) {
  const visibles = partes.slice(0, 5);
  const resto = partes.slice(5).reduce((s, p) => s + p.salida, 0);
  const filas = resto > 0 ? [...visibles, { nombre: "Otros", salida: resto }] : visibles;
  return (
    <>
      <div className="mb-2 text-[12.5px] font-medium">{titulo}</div>
      {filas.length === 0 && <p className="text-[12px] text-muy">Sin datos en estos días.</p>}
      <div className="flex flex-col gap-2">
        {filas.map((p) => {
          const pc = total ? (p.salida / total) * 100 : 0;
          return (
            <div key={p.nombre} title={`${entero(p.salida)} tokens de salida`} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 text-[12px]">
              <span className="truncate">{p.nombre}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                <i className="block h-full rounded-full" style={{ width: `${Math.max(pc, 0.8)}%`, background: COLOR }} />
              </span>
              <span className="text-right tabular-nums text-tenue">{porcentaje(pc)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
