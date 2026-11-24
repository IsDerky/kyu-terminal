import { useEffect, useMemo, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import { responder, type Entrada } from "../lib/claude";
import { contar, diffLineas, recortar, type Linea, type Trozo } from "../lib/diff";
import { herramienta, partirRuta, relativa } from "../lib/herramientas";
import { leerArchivo } from "../lib/nucleo";

type EntradaPermiso = Extract<Entrada, { tipo: "permiso" }>;
type Datos = Record<string, unknown>;

const texto = (v: unknown) => (typeof v === "string" ? v : "");

/** Permiso de Claude en el panel: qué quiere hacer, el detalle (diff, orden) y los botones. */
export default function Permiso({ e, espacio, carpeta }: { e: EntradaPermiso; espacio: string; carpeta: string | null }) {
  const [nombre] = herramienta(e.herramienta);

  if (e.respuesta) {
    const si = e.respuesta !== "denegar";
    return (
      <div className="px-1 text-[11.5px] text-muy">
        <div className="flex min-w-0 items-center gap-2">
          {si ? <Check size={12} className="flex-none text-ok" /> : <X size={12} className="flex-none text-mal" />}
          <span className="flex-none">{e.respuesta === "siempre" ? "Permitido siempre" : si ? "Permitido" : "Denegado"}:</span>
          <span className="truncate font-mono">
            {nombre} {relativa(e.resumen, carpeta)}
          </span>
        </div>
        {e.mensaje && <p className="mt-1 select-text whitespace-pre-wrap pl-5 text-tenue">«{e.mensaje}»</p>}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-aviso/25 bg-aviso/[0.03]">
      <div className="flex min-w-0 items-start gap-2 px-[11px] py-[9px] text-[12.5px]">
        <ShieldAlert size={14} strokeWidth={1.8} className="mt-0.5 flex-none text-aviso" />
        <Que nombre={nombre} herramienta={e.herramienta} resumen={relativa(e.resumen, carpeta)} />
      </div>
      <Detalle herramienta={e.herramienta} input={(e.input ?? {}) as Datos} />
      <div className="flex items-center gap-1.5 px-[11px] pb-2.5">
        <BotonPermiso principal onClick={() => void responder(espacio, e.id, "permitir")} tecla="Intro">
          <Check size={13} /> Permitir
        </BotonPermiso>
        <BotonPermiso onClick={() => void responder(espacio, e.id, "siempre")}>Siempre</BotonPermiso>
        <BotonPermiso onClick={() => void responder(espacio, e.id, "denegar")} tecla="Esc">
          Denegar
        </BotonPermiso>
      </div>
    </div>
  );
}

/** «Claude quiere usar Editar demo.txt» y, debajo, la carpeta del archivo recortada. */
function Que({ nombre, herramienta: h, resumen }: { nombre: string; herramienta: string; resumen: string }) {
  const ruta = partirRuta(h, resumen);
  if (ruta) {
    const [archivo, dir] = ruta;
    return (
      <span className="min-w-0" title={resumen}>
        Claude quiere usar <b className="font-semibold">{nombre}</b>{" "}
        <span className="font-mono text-[12px] text-texto">{archivo}</span>
        {dir && <span className="block truncate font-mono text-[11px] text-muy">{dir}</span>}
      </span>
    );
  }
  // Bash y PowerShell: la orden ya va entera en el detalle.
  return (
    <span className="min-w-0">
      Claude quiere usar <b className="font-semibold">{nombre}</b>{" "}
      {h !== "Bash" && h !== "PowerShell" && h !== "mcp__kyu__ejecutar_en_panel" && <span className="break-all font-mono text-[12px] text-tenue">{resumen}</span>}
    </span>
  );
}

/** Las teclas solo se enseñan con el foco dentro del panel, que es cuando funcionan. */
function BotonPermiso({
  principal,
  tecla,
  onClick,
  children,
}: {
  principal?: boolean;
  tecla?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] ${
        principal
          ? "border-claude bg-claude font-medium text-white hover:brightness-110"
          : "border-borde2 text-tenue hover:bg-hover hover:text-texto"
      }`}
    >
      {children}
      {tecla && (
        <kbd
          className={`hidden rounded px-1 font-ui text-[10px] group-focus-within/claude:inline ${
            principal ? "bg-white/20 text-white" : "bg-hover text-muy"
          }`}
        >
          {tecla}
        </kbd>
      )}
    </button>
  );
}

function Detalle({ herramienta: h, input }: { herramienta: string; input: Datos }) {
  switch (h) {
    case "Edit":
      return <DiffEdicion ruta={texto(input.file_path)} cambios={[{ antes: texto(input.old_string), despues: texto(input.new_string) }]} />;
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? (input.edits as Datos[]) : [];
      return (
        <DiffEdicion
          ruta={texto(input.file_path)}
          cambios={edits.map((x) => ({ antes: texto(x.old_string), despues: texto(x.new_string) }))}
        />
      );
    }
    case "Write":
      return <DiffEscritura ruta={texto(input.file_path)} contenido={texto(input.content)} />;
    case "Bash":
    case "PowerShell":
      return (
        <Caja>
          {texto(input.description) && <p className="mb-1.5 font-ui text-[11.5px] text-tenue">{texto(input.description)}</p>}
          <pre className="select-text whitespace-pre-wrap break-all font-mono text-[11.5px] text-texto">{texto(input.command)}</pre>
        </Caja>
      );
    case "mcp__kyu__ejecutar_en_panel":
      return (
        <Caja>
          <p className="mb-1.5 font-ui text-[11.5px] text-tenue">En el panel «Claude» de Kyu, a la vista</p>
          <pre className="select-text whitespace-pre-wrap break-all font-mono text-[11.5px] text-texto">{texto(input.orden)}</pre>
        </Caja>
      );
    case "WebFetch":
      return texto(input.prompt) ? (
        <Caja>
          <p className="select-text whitespace-pre-wrap font-ui text-[11.5px] text-tenue">{texto(input.prompt)}</p>
        </Caja>
      ) : null;
    case "Read":
    case "Grep":
    case "Glob":
    case "WebSearch":
      return null;
    default: {
      // Herramientas de MCP y demás: la entrada tal cual, para saber qué se permite.
      const json = JSON.stringify(input, null, 2);
      return json && json !== "{}" ? (
        <Caja>
          <pre className="select-text whitespace-pre-wrap break-all font-mono text-[11px] text-tenue">{json}</pre>
        </Caja>
      ) : null;
    }
  }
}

function Caja({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-[11px] mb-2.5 max-h-[220px] overflow-auto rounded-md border border-borde bg-fondo px-2.5 py-2">
      {children}
    </div>
  );
}

const CONTEXTO = 2;

/**
 * Un cambio de Edit con unas líneas del archivo alrededor: las líneas enteras que toca
 * `antes`, ampliadas `CONTEXTO` por cada lado, y lo mismo con el cambio hecho. null si
 * el texto no está en el archivo (o no se pudo leer).
 */
function conContexto(contenido: string | null, antes: string, despues: string) {
  if (contenido === null || !antes) return null;
  const t = contenido.replace(/\r\n/g, "\n");
  const viejo = antes.replace(/\r\n/g, "\n");
  const i = t.indexOf(viejo);
  if (i < 0) return null;
  let ini = t.lastIndexOf("\n", i - 1) + 1; // principio de la primera línea tocada
  let fin = t.indexOf("\n", i + viejo.length); // final de la última
  if (fin < 0) fin = t.length;
  for (let k = 0; k < CONTEXTO && ini > 0; k++) ini = t.lastIndexOf("\n", ini - 2) + 1;
  for (let k = 0; k < CONTEXTO && fin < t.length; k++) {
    const sig = t.indexOf("\n", fin + 1);
    fin = sig < 0 ? t.length : sig;
  }
  let linea = 1;
  for (let k = 0; k < ini; k++) if (t.charCodeAt(k) === 10) linea++;
  const trozo = t.slice(ini, fin);
  const cambiado = t.slice(ini, i) + despues.replace(/\r\n/g, "\n") + t.slice(i + viejo.length, fin);
  return { antes: trozo, despues: cambiado, linea };
}

/** El archivo como está ahora; undefined mientras se lee, null si no existe o no se puede leer. */
function useArchivo(ruta: string) {
  const [contenido, setContenido] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    setContenido(undefined);
    if (!ruta) return setContenido(null);
    leerArchivo(ruta).then(
      (c) => vivo && setContenido(c),
      () => vivo && setContenido(null),
    );
    return () => {
      vivo = false;
    };
  }, [ruta]);
  return contenido;
}

function DiffEdicion({ ruta, cambios }: { ruta: string; cambios: { antes: string; despues: string }[] }) {
  const actual = useArchivo(ruta);
  const { trozos, cuenta, numeros } = useMemo(() => {
    const trozos: Trozo[] = [];
    const todas: Linea[] = [];
    let numeros = actual !== undefined && actual !== null;
    cambios.forEach((c, k) => {
      const ctx = conContexto(actual ?? null, c.antes, c.despues);
      if (!ctx) numeros = false;
      const lineas = ctx ? diffLineas(ctx.antes, ctx.despues, ctx.linea) : diffLineas(c.antes, c.despues);
      if (k > 0) trozos.push({ tipo: "salto", lineas: 0 });
      trozos.push(...recortar(lineas, 3));
      todas.push(...lineas);
    });
    return { trozos, cuenta: contar(todas), numeros };
  }, [actual, cambios]);
  if (actual === undefined) return null;
  return <VistaDiff trozos={trozos} {...cuenta} numeros={numeros} />;
}

function DiffEscritura({ ruta, contenido }: { ruta: string; contenido: string }) {
  const actual = useArchivo(ruta);
  const datos = useMemo(() => {
    if (actual === undefined) return null;
    const lineas = diffLineas(actual ?? "", contenido);
    return { trozos: recortar(lineas, 3), cuenta: contar(lineas) };
  }, [actual, contenido]);
  if (!datos) return null;
  return <VistaDiff trozos={datos.trozos} {...datos.cuenta} numeros nota={actual === null ? "archivo nuevo" : undefined} />;
}

function VistaDiff({
  trozos,
  puestas,
  quitadas,
  numeros,
  nota,
}: {
  trozos: Trozo[];
  puestas: number;
  quitadas: number;
  numeros: boolean;
  nota?: string;
}) {
  if (!puestas && !quitadas) {
    return <p className="mx-[11px] mb-2.5 text-[11.5px] text-muy">Sin cambios en el contenido.</p>;
  }
  return (
    <div className="mx-[11px] mb-2.5 overflow-hidden rounded-md border border-borde bg-fondo">
      <div className="flex items-center gap-2 border-b border-borde px-2.5 py-1 text-[11px]">
        <span className="text-ok">+{puestas}</span>
        <span className="text-mal">−{quitadas}</span>
        {nota && <span className="ml-auto text-muy">{nota}</span>}
      </div>
      <div className="max-h-[260px] overflow-auto py-1 font-mono text-[11.5px] leading-[1.55]">
        <div className="w-max min-w-full">
          {trozos.map((t, k) =>
            t.tipo === "salto" ? (
              <div key={k} className="my-0.5 border-y border-borde/60 bg-tarjeta/50 px-2.5 text-[10.5px] leading-5 text-muy">
                {t.lineas > 0 ? `··· ${t.lineas} ${t.lineas === 1 ? "línea igual" : "líneas iguales"}` : "···"}
              </div>
            ) : (
              <div
                key={k}
                className={`flex select-text ${
                  t.tipo === "pone" ? "bg-ok/[0.08]" : t.tipo === "quita" ? "bg-mal/[0.08]" : ""
                }`}
              >
                {numeros && (
                  <span className="w-9 flex-none select-none pr-1.5 text-right text-muy/80">
                    {t.tipo === "quita" ? t.antes : t.despues}
                  </span>
                )}
                <span
                  className={`w-4 flex-none select-none text-center ${
                    t.tipo === "pone" ? "text-ok" : t.tipo === "quita" ? "text-mal" : "text-muy"
                  } ${numeros ? "" : "ml-1"}`}
                >
                  {t.tipo === "pone" ? "+" : t.tipo === "quita" ? "−" : " "}
                </span>
                <span className={`whitespace-pre pr-3 ${t.tipo === "igual" ? "text-tenue" : "text-texto"}`}>
                  {t.texto || " "}
                </span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
