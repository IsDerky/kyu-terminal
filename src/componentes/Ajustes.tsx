import { useEffect, useState } from "react";
import { Bell, Keyboard, Palette, SlidersHorizontal, SquareTerminal, Check, FileCog, type LucideIcon } from "lucide-react";
import { guardarAjuste, leerAjustes, type AjustesVista, type ConfigVista } from "../lib/nucleo";
import { useKyu } from "../lib/estado";
import { IconoPerfil, Mascota } from "./iconos";

type Seccion = "general" | "perfiles" | "aspecto" | "claude" | "atajos" | "avisos";

const SECCIONES: { id: Seccion; nombre: string; icono: LucideIcon | "claude" }[] = [
  { id: "general", nombre: "General", icono: SlidersHorizontal },
  { id: "perfiles", nombre: "Perfiles", icono: SquareTerminal },
  { id: "aspecto", nombre: "Aspecto", icono: Palette },
  { id: "claude", nombre: "Claude", icono: "claude" },
  { id: "atajos", nombre: "Atajos", icono: Keyboard },
  { id: "avisos", nombre: "Avisos", icono: Bell },
];

const ATAJOS: [string, string][] = [
  ["Paleta de órdenes", "Ctrl+Mayús+P"],
  ["Ajustes", "Ctrl+,"],
  ["Panel de Claude", "Ctrl+Mayús+C"],
  ["Nueva pestaña", "Ctrl+Mayús+T"],
  ["Nuevo espacio", "Ctrl+Mayús+N"],
  ["Dividir a la derecha", "Ctrl+Mayús+D"],
  ["Dividir abajo", "Ctrl+Mayús+E"],
  ["Cerrar pestaña", "Ctrl+Mayús+W"],
  ["Siguiente / anterior pestaña", "Ctrl+Tab · Ctrl+Mayús+Tab"],
  ["Ir al espacio 1-9", "Ctrl+1 … Ctrl+9"],
  ["Mover el foco entre paneles", "Alt+flechas"],
  ["Buscar en el terminal", "Ctrl+F"],
  ["Grabar el panel a GIF (empezar / parar)", "Ctrl+Mayús+G"],
  ["Aceptar sugerencia · palabra a palabra", "→ · Ctrl+→"],
  ["Otra sugerencia · quitarla", "↓ ↑ · Esc"],
  ["Abrir archivo:línea en Kyu · en VS Code", "Ctrl+clic · Mayús+clic"],
];

/**
 * Pestaña de Ajustes (Ctrl+,). Todo lo que se cambia aquí se guarda al momento en kyu.toml,
 * que sigue siendo la fuente: sus comentarios y el resto de claves no se tocan.
 */
export default function Ajustes({ config, alCambiar }: { config: ConfigVista; alCambiar: () => void }) {
  const [seccion, setSeccion] = useState<Seccion>("general");
  const [a, setA] = useState<AjustesVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const recargar = () => leerAjustes().then(setA, (e) => setError(String(e)));
  useEffect(() => void recargar(), []);

  const guardar = async (clave: string, valor: unknown) => {
    try {
      await guardarAjuste(clave, valor);
      setError(null);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 1500);
      await recargar();
      alCambiar();
    } catch (e) {
      setError(String(e));
    }
  };

  if (!a) return <div className="flex-1 p-6 text-tenue">{error ?? "Cargando…"}</div>;

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-52 flex-none flex-col gap-0.5 border-r border-borde p-3">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSeccion(s.id)}
            className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] ${
              seccion === s.id ? "bg-hover text-texto" : "text-tenue hover:text-texto"
            }`}
          >
            {s.icono === "claude" ? <Mascota alto={10} /> : <s.icono size={14} strokeWidth={1.8} />}
            {s.nombre}
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-1.5 px-1 pt-3 text-[11.5px] text-muy">
          <button
            type="button"
            onClick={() => {
              const k = useKyu.getState();
              k.ponerAjustes(false);
              if (a.existe) k.abrirArchivo(a.ruta, 1, 1);
            }}
            disabled={!a.existe}
            title={a.existe ? a.ruta : "Aún no existe: se crea al cambiar algo aquí"}
            className="flex items-center gap-1.5 text-left text-tenue hover:text-texto disabled:text-muy"
          >
            <FileCog size={13} strokeWidth={1.8} />
            Abrir kyu.toml
          </button>
          <span className={a.existe ? "break-all" : ""}>{a.existe ? a.ruta : "kyu.toml se creará al cambiar algo"}</span>
        </div>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[640px]">
          <div className="mb-1 flex items-center gap-3">
            <h2 className="text-[16px] font-semibold">{SECCIONES.find((s) => s.id === seccion)?.nombre}</h2>
            {guardado && (
              <span className="flex items-center gap-1 text-[11.5px] text-ok">
                <Check size={12} /> Guardado en kyu.toml
              </span>
            )}
          </div>
          {error && <p className="mb-3 rounded-md border border-mal/30 bg-mal/[0.05] px-3 py-2 text-[12px] text-mal">{error}</p>}

          {seccion === "general" && (
            <>
              <Explicacion>Cómo se comporta el terminal.</Explicacion>
              <Campo titulo="Autocompletado" detalle="Sugerencia en gris mientras escribes. Se aplica a las pestañas nuevas.">
                <Interruptor valor={a.autocompletado} alCambiar={(v) => void guardar("autocompletado", v ? null : false)} />
              </Campo>
              <Campo titulo="Prompt de Kyu" detalle="Los bloques con título y la flecha. Apágalo para usar el de tu perfil (oh-my-posh…). Pestañas nuevas.">
                <Interruptor valor={!a.sin_prompt} alCambiar={(v) => void guardar("sin_prompt", v ? null : true)} />
              </Campo>
            </>
          )}

          {seccion === "perfiles" && (
            <>
              <Explicacion>
                Qué abre cada pestaña nueva. {a.perfiles_propios ? "Salen de kyu.toml." : "Son los que hay en este equipo; para cambiarlos, añade [[perfiles]] en kyu.toml."}
              </Explicacion>
              <div className="flex flex-col gap-1.5">
                {a.perfiles.map((p, i) => (
                  <div key={p.nombre} className="flex items-center gap-3 rounded-lg border border-borde bg-tarjeta px-3 py-2.5">
                    <span className="grid size-8 place-items-center rounded-md" style={{ background: `${p.color ?? "#8b8b96"}1f` }}>
                      <IconoPerfil perfil={{ nombre: p.nombre, color: p.color ?? "#8b8b96", icono: p.icono ?? "terminal" }} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <b className="text-[13px] font-semibold">{p.nombre}</b>
                      <div className="truncate font-mono text-[11.5px] text-muy">{p.orden}</div>
                    </div>
                    {i === 0 ? (
                      <span className="rounded-full border border-acento/40 bg-acento/10 px-2 py-0.5 text-[11px] text-acento2">predeterminado</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void guardar("perfil_predeterminado", p.nombre)}
                        className="rounded-full border border-borde2 px-2 py-0.5 text-[11px] text-tenue hover:text-texto"
                      >
                        Usar por defecto
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {seccion === "aspecto" && (
            <>
              <Explicacion>Se aplica al momento en todos los terminales.</Explicacion>
              <Campo titulo="Fuente" detalle="Una Nerd Font instalada (para los iconos).">
                <select
                  value={a.fuente ?? ""}
                  onChange={(e) => void guardar("fuente", e.target.value || null)}
                  className="h-8 rounded-md border border-borde2 bg-fondo px-2 text-[12.5px] text-texto outline-none focus:border-acento/60"
                >
                  <option value="">Automática ({config.fuente.split(",")[0].replace(/"/g, "")})</option>
                  {a.fuentes_conocidas.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  {a.fuente && !a.fuentes_conocidas.includes(a.fuente) && <option value={a.fuente}>{a.fuente}</option>}
                </select>
              </Campo>
              <Campo titulo="Tamaño" detalle="En puntos.">
                <Numero valor={a.fuente_tamano} min={9} max={28} paso={0.5} alCambiar={(v) => void guardar("tema.fuente_tamano", v)} />
              </Campo>
              <Campo titulo="Colores" detalle="Los 16 colores ANSI del tema Sobrio. Se cambian en kyu.toml ([tema] ansi = […]).">
                <div className="flex gap-1">
                  {config.tema.ansi.slice(0, 8).map((c, i) => (
                    <i key={i} className="block size-5 rounded border border-borde" style={{ background: c }} />
                  ))}
                </div>
              </Campo>
            </>
          )}

          {seccion === "claude" && (
            <>
              <Explicacion>El panel de Claude (Ctrl+Mayús+C) arranca Claude Code en la carpeta del terminal con el foco.</Explicacion>
              <Campo
                titulo="Ruta de Claude Code"
                detalle={a.claude_encontrado ? `Se usa: ${a.claude_encontrado}` : "No se encuentra claude: instálalo o pon aquí su ruta."}
              >
                <Texto valor={a.claude ?? ""} marcador="claude del PATH" alCambiar={(v) => void guardar("claude", v || null)} />
              </Campo>
              <Campo titulo="Herramientas de Kyu" detalle="Claude puede ejecutar órdenes en un panel «Claude» a la vista (siempre con tu permiso) y leer tus terminales.">
                <span className="text-[12px] text-ok">Activas</span>
              </Campo>
            </>
          )}

          {seccion === "atajos" && (
            <>
              <Explicacion>Los atajos de Kyu. De momento no se pueden cambiar.</Explicacion>
              <div className="overflow-hidden rounded-lg border border-borde">
                {ATAJOS.map(([que, tecla]) => (
                  <div key={que} className="flex items-center justify-between border-b border-borde px-3 py-2 text-[12.5px] last:border-b-0">
                    <span className="text-tenue">{que}</span>
                    <kbd className="rounded border border-borde2 bg-hover px-1.5 font-ui text-[11.5px] text-texto">{tecla}</kbd>
                  </div>
                ))}
              </div>
            </>
          )}

          {seccion === "avisos" && (
            <>
              <Explicacion>Aviso de Windows cuando termina una orden larga y no estás mirando Kyu.</Explicacion>
              <Campo titulo="Avisar a partir de" detalle="Segundos que tiene que tardar la orden. 0 = no avisar nunca.">
                <Numero valor={a.aviso_segundos} min={0} max={3600} paso={1} sufijo="s" alCambiar={(v) => void guardar("aviso_segundos", v === 10 ? null : v)} />
              </Campo>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Explicacion({ children }: { children: React.ReactNode }) {
  return <p className="mb-5 text-[12.5px] text-tenue">{children}</p>;
}

function Campo({ titulo, detalle, children }: { titulo: string; detalle: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-t border-borde py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{titulo}</div>
        <div className="text-[11.5px] text-muy">{detalle}</div>
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

function Interruptor({ valor, alCambiar }: { valor: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={valor}
      onClick={() => alCambiar(!valor)}
      className={`relative h-5 w-9 rounded-full transition-colors ${valor ? "bg-acento" : "bg-borde2"}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${valor ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function Numero({
  valor,
  min,
  max,
  paso,
  sufijo,
  alCambiar,
}: {
  valor: number;
  min: number;
  max: number;
  paso: number;
  sufijo?: string;
  alCambiar: (v: number) => void;
}) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  const fijar = () => {
    const n = Number(texto.replace(",", "."));
    if (!Number.isFinite(n)) return setTexto(String(valor));
    const v = Math.min(max, Math.max(min, Math.round(n / paso) * paso));
    setTexto(String(v));
    if (v !== valor) alCambiar(v);
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={fijar}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-20 rounded-md border border-borde2 bg-fondo px-2 text-right text-[12.5px] tabular-nums text-texto outline-none focus:border-acento/60"
      />
      {sufijo && <span className="text-[12px] text-muy">{sufijo}</span>}
    </span>
  );
}

function Texto({ valor, marcador, alCambiar }: { valor: string; marcador: string; alCambiar: (v: string) => void }) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  return (
    <input
      value={texto}
      placeholder={marcador}
      spellCheck={false}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => texto.trim() !== valor && alCambiar(texto.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-8 w-72 rounded-md border border-borde2 bg-fondo px-2 font-mono text-[12px] text-texto outline-none placeholder:text-muy focus:border-acento/60"
    />
  );
}
