// Caja donde se escribe a Claude o al agente: menciones, comandos con /, adjuntos, imágenes y la cola.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Clock, ListPlus, Pencil, Square, X } from "lucide-react";
import { añadirImagenes, nombreAgente, comandosDe, ARRASTRE_RUTA, mencionDe, enviar, parar, quitarAdjunto, quitarDeCola, quitarImagen, quitarSeleccion, sacarDeCola, responder, tomarBorrador, useClaude, type Conversacion, type EnCola } from "../lib/claude";
import { type Comando } from "../lib/claudeOpciones";
import { AvisoLimite, BarraOpciones, filtrarComandos, MenuComandos } from "./ControlesClaude";
import { TiraTareas } from "./Tareas";
import { mencionEnCursor, MenuArchivos, Miniaturas } from "./AdjuntosClaude";
import { imagenesDe } from "../lib/imagenes";
import { buscarArchivos } from "../lib/nucleo";
import { SIN_COMANDOS, SIN_IMAGENES } from "./PanelClaude";
import { RecuadroOrden, RecuadroSeleccion } from "./EntradasClaude";

export function CajaEntrada({
  enfocar = false,
  grande,
  espacio,
  c,
  carpeta,
  ocupado,
  permiso,
  esPlan,
  esPregunta = false,
}: {
  /** Al pasar a true (su panel gana el foco), el cursor va a la caja. */
  enfocar?: boolean;
  espacio: string;
  c: Conversacion;
  carpeta: string | null;
  ocupado: boolean;
  permiso: number | null;
  /** El permiso pendiente es un plan (ExitPlanMode). */
  esPlan: boolean;
  /** El permiso pendiente son preguntas (AskUserQuestion). */
  esPregunta?: boolean;
  grande: boolean;
}) {
  const [texto, setTexto] = useState("");
  const borrador = useClaude((s) => s.borradores[espacio]);
  useEffect(() => {
    if (borrador === undefined) return;
    const t = tomarBorrador(espacio) ?? "";
    // Lo que ya hubiera escrito en la caja se queda detrás.
    const antes = area.current?.value.trim() ?? "";
    const nuevo = antes && t ? `${t}\n\n${antes}` : t || antes;
    setTexto(nuevo);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(t.length, t.length);
    });
  }, [borrador, espacio]);
  useEffect(() => {
    // Sin robarle el foco a lo que ya esté dentro de este panel (texto seleccionado, botones).
    if (enfocar && !area.current?.closest("[data-panel]")?.contains(document.activeElement)) area.current?.focus();
  }, [enfocar]);
  const adjunto =useClaude((s) => s.adjuntos[espacio]);
  const imagenes = useClaude((s) => s.imagenes[espacio] ?? SIN_IMAGENES);
  const selector = useRef<HTMLInputElement>(null);
  // @archivo: lo escrito tras la @ del cursor, los archivos que encajan y cuál está elegido.
  const [cursor, setCursor] = useState(0);
  const [rutas, setRutas] = useState<string[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegidoA, setElegidoA] = useState(0);
  const [sinMenuA, setSinMenuA] = useState(false);
  const mencion = permiso === null && !sinMenuA && carpeta ? mencionEnCursor(texto, cursor) : null;
  const consulta = mencion?.[1] ?? null;
  const selA = Math.min(elegidoA, Math.max(0, rutas.length - 1));
  // La respuesta que propone Claude, solo con la caja vacía y nada pendiente.
  const seleccion = useClaude((s) => s.selecciones[espacio]);
  const sugerencia = permiso === null && !ocupado && !adjunto && !seleccion && !imagenes.length ? c.sugerencia : null;

  useEffect(() => {
    if (consulta === null || !carpeta) return;
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      buscarArchivos(carpeta, consulta)
        .then((r) => vivo && (setRutas(r), setElegidoA(0)))
        .catch(() => vivo && setRutas([]))
        .finally(() => vivo && setBuscando(false));
    }, 70);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [consulta, carpeta]);

  const ponerRuta = (ruta: string) => {
    if (!mencion) return;
    const [desde] = mencion;
    // Las rutas con espacios van entre comillas, como en `claude`.
    const r = /\s/.test(ruta) ? `"${ruta}"` : ruta;
    // En una carpeta se sigue escribiendo dentro de ella; en un archivo se cierra con un espacio.
    const pon = `@${r}${ruta.endsWith("/") ? "" : " "}`;
    const nuevo = texto.slice(0, desde) + pon + texto.slice(cursor);
    setTexto(nuevo);
    const pos = desde + pon.length;
    setCursor(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  const insertar = (s: string) => {
    const el = area.current;
    const pos = el?.selectionStart ?? texto.length;
    const antes = texto.slice(0, pos);
    const hueco = antes && !/\s$/.test(antes) ? " " : "";
    const nuevo = antes + hueco + s + texto.slice(pos);
    const fin = pos + hueco.length + s.length;
    setTexto(nuevo);
    setCursor(fin);
    setSinMenuA(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(fin, fin);
    });
  };
  const deClaude = useClaude((s) => s.catalogo?.commands ?? SIN_COMANDOS);
  const lista = comandosDe(c, deClaude);
  const area = useRef<HTMLTextAreaElement>(null);
  const [elegido, setElegido] = useState(0);
  const [sinMenu, setSinMenu] = useState(false);
  const comandos = permiso === null && !sinMenu ? filtrarComandos(lista, texto) : null;
  const sel = comandos ? Math.min(elegido, Math.max(0, comandos.length - 1)) : 0;

  const completar = (cmd: Comando) => {
    setTexto(`/${cmd.name} `);
    setElegido(0);
    area.current?.focus();
  };

  // Crece con el texto hasta unas 8 líneas.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 170)}px`;
  }, [texto]);

  const conAlgo = !!texto.trim() || !!adjunto || !!seleccion || imagenes.length > 0;
  // Con Claude trabajando, `enviar` lo deja en cola.
  const mandar = () => {
    if (!conAlgo) return;
    setTexto("");
    void enviar(espacio, texto.trim());
  };
  const editarDeCola = (id: number) => {
    const t = sacarDeCola(espacio, id);
    setTexto((antes) => (antes.trim() ? `${antes}\n${t}` : t));
    requestAnimationFrame(() => area.current?.focus());
  };

  // Rutas soltadas en el panel (insertarEnCaja): van donde esté el cursor.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const alInsertar = (e: Event) => insertar((e as CustomEvent<string>).detail);
    el.addEventListener("kyu-insertar", alInsertar);
    return () => el.removeEventListener("kyu-insertar", alInsertar);
  });
  const [encima, setEncima] = useState(false);

  return (
    <div className={`flex-none border-t border-borde px-3 pb-3 pt-2.5 ${grande ? "border-t-0" : ""}`}>
      <div className={grande ? "mx-auto w-full max-w-[780px]" : undefined}>
      <Cola espacio={espacio} alEditar={editarDeCola} />
      {/* Pegado al borde de arriba de la caja, como una pestaña. */}
      <TiraTareas c={c} />
      {!c.agente && <AvisoLimite espacio={espacio} c={c} />}
      <div
        // Una pestaña de archivo soltada sobre la caja queda como @ruta (en vez de moverse).
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ARRASTRE_RUTA)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          setEncima(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setEncima(false);
        }}
        onDrop={(e) => {
          const ruta = e.dataTransfer.getData(ARRASTRE_RUTA);
          setEncima(false);
          if (!ruta) return;
          e.preventDefault();
          e.stopPropagation();
          insertar(mencionDe(ruta, carpeta) + " ");
        }}
        className={`relative rounded-[10px] border bg-fondo focus-within:border-[#3a3a42] ${encima ? "border-acento" : "border-borde2"}`}
      >
        {comandos && <MenuComandos comandos={comandos} elegido={sel} alElegir={completar} alPasar={setElegido} />}
        {!comandos && mencion && (
          <MenuArchivos rutas={rutas} elegido={selA} buscando={buscando} alElegir={ponerRuta} alPasar={setElegidoA} />
        )}
        {imagenes.length > 0 && <Miniaturas imagenes={imagenes} alQuitar={(id) => quitarImagen(espacio, id)} />}
        {adjunto && (
          <div className="flex px-2 pt-2">
            <RecuadroOrden a={adjunto} onQuitar={() => quitarAdjunto(espacio)} />
          </div>
        )}
        {seleccion && (
          <div className="flex px-2 pt-2">
            <RecuadroSeleccion s={seleccion} onQuitar={() => quitarSeleccion(espacio)} />
          </div>
        )}
        <textarea
          data-cid={espacio}
          ref={area}
          rows={2}
          value={texto}
          spellCheck={false}
          placeholder={
            permiso !== null
              ? esPregunta
                ? "Elige arriba · Esc no responde · o escribe aquí tu respuesta"
                : esPlan
                ? "Intro aprueba · Esc sigue planificando · o escribe qué cambiar"
                : "Intro permite · Esc deniega · o escribe qué hacer en su lugar"
              : adjunto
                ? "Pregunta sobre esta orden, o Intro para que la revise"
                : seleccion
                  ? "Pregunta sobre la selección, o Intro para que la explique"
                  : imagenes.length
                  ? "Pregunta sobre la imagen"
                  : ocupado
                    ? "Lo que escribas queda en cola · Esc para"
                    : sugerencia
                      ? `${sugerencia}  · Tab`
                      : c.agente
                        ? `Escribe a ${nombreAgente(c)} · @ archivos · / comandos`
                        : "Escribe a Claude · @ archivos · / comandos"
          }
          onChange={(e) => {
            setTexto(e.target.value);
            setCursor(e.target.selectionStart);
            setElegido(0);
            setSinMenu(false);
            setSinMenuA(false);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const archivos = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (!archivos.length) return;
            e.preventDefault();
            void imagenesDe(archivos).then((l) => añadirImagenes(espacio, l));
          }}
          onKeyDown={(e) => {
            // Menú de archivos abierto: lo mismo que el de comandos.
            if (!comandos && mencion && rutas.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setElegidoA((selA + d + rutas.length) % rutas.length);
                return;
              }
              if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
                e.preventDefault();
                ponerRuta(rutas[selA]);
                return;
              }
            }
            // Mientras busca, Tab no saca el foco de la caja.
            if (!comandos && mencion && e.key === "Tab") {
              e.preventDefault();
              return;
            }
            if (!comandos && mencion && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setSinMenuA(true);
              return;
            }
            // Menú de comandos abierto: flechas, Tab/Intro y Esc son suyos.
            if (comandos && comandos.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setElegido((sel + d + comandos.length) % comandos.length);
                return;
              }
              if ((e.key === "Tab" && !e.shiftKey) || (e.key === "Enter" && !e.shiftKey)) {
                const cmd = comandos[sel];
                // Intro sobre un comando ya escrito entero lo manda.
                if (!(e.key === "Enter" && texto.trim() === `/${cmd.name}`)) {
                  e.preventDefault();
                  completar(cmd);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSinMenu(true);
                return;
              }
            }
            // Caja vacía con una sugerencia de Claude: Tab la escribe (para mandarla o retocarla).
            if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && sugerencia && !texto) {
              e.preventDefault();
              setTexto(sugerencia);
              setCursor(sugerencia.length);
              requestAnimationFrame(() => area.current?.setSelectionRange(sugerencia.length, sugerencia.length));
              return;
            }
            if (permiso !== null) {
              // Con texto, Intro deniega y le dice a Claude qué hacer en su lugar; sin texto
              // (y con Esc) lo resuelve el panel.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && texto.trim()) {
                e.preventDefault();
                const t = texto.trim();
                setTexto("");
                void responder(espacio, permiso, "denegar", t);
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              mandar();
            } else if (e.key === "Escape" && ocupado) {
              e.preventDefault();
              parar(espacio);
            }
          }}
          className="block min-h-[44px] w-full resize-none bg-transparent pb-1 pl-2.5 pr-2.5 pt-[9px] text-[13px] text-texto outline-none placeholder:text-muy"
        />
        <BarraOpciones
          espacio={espacio}
          c={c}
          alArroba={() => insertar("@")}
          alImagen={() => selector.current?.click()}
        />
        <input
          ref={selector}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void imagenesDe(e.target.files).then((l) => añadirImagenes(espacio, l));
            e.target.value = "";
          }}
        />
        {ocupado ? (
          <>
            {conAlgo && permiso === null && (
              <button
                type="button"
                title={`Dejar en cola (Intro): sale al acabar ${nombreAgente(c)}`}
                onClick={mandar}
                className="absolute bottom-1 right-9 grid size-6 place-items-center rounded-lg bg-texto text-fondo"
              >
                <ListPlus size={14} strokeWidth={2.2} />
              </button>
            )}
            <button
              type="button"
              title="Parar (Esc)"
              onClick={() => parar(espacio)}
              className="absolute bottom-1 right-1.5 grid size-6 place-items-center rounded-lg bg-hover text-texto hover:bg-borde2"
            >
              <Square size={11} fill="currentColor" />
            </button>
          </>
        ) : (
          <button
            type="button"
            title="Enviar (Intro)"
            onClick={mandar}
            disabled={!texto.trim() && !adjunto && !seleccion && !imagenes.length}
            className="absolute bottom-1 right-1.5 grid size-6 place-items-center rounded-lg bg-texto text-fondo disabled:bg-hover disabled:text-muy"
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

const SIN_COLA: EnCola[] = [];

/** Mensajes en cola encima de la caja: salen solos al acabar Claude; se pueden editar o quitar. */
function Cola({ espacio, alEditar }: { espacio: string; alEditar: (id: number) => void }) {
  const cola = useClaude((s) => s.colas[espacio] ?? SIN_COLA);
  if (!cola.length) return null;
  return (
    <div className="mb-1.5 flex flex-col gap-1">
      {cola.map((m, i) => {
        const extra = [m.adjunto && "orden", m.seleccion && "selección", m.imagenes.length && `${m.imagenes.length} img`].filter(Boolean);
        return (
          <div
            key={m.id}
            className="group flex h-7 items-center gap-2 rounded-md border border-dashed border-borde2 bg-fondo/60 pl-2 pr-1 text-[12px] text-tenue"
          >
            <Clock size={11} className="flex-none text-muy" />
            <span className="flex-none text-[10.5px] uppercase tracking-wide text-muy">{i === 0 ? "Siguiente" : `En cola ${i + 1}`}</span>
            <span className="min-w-0 flex-1 truncate text-texto/80" title={m.texto}>
              {m.texto.split("\n")[0] || "(solo lo adjunto)"}
            </span>
            {extra.length > 0 && <span className="flex-none text-[10.5px] text-muy">+ {extra.join(", ")}</span>}
            <button
              type="button"
              title="Editar: vuelve a la caja"
              onClick={() => alEditar(m.id)}
              className="grid size-5 flex-none place-items-center rounded text-muy hover:bg-hover hover:text-texto"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              title="Quitar de la cola"
              onClick={() => quitarDeCola(espacio, m.id)}
              className="grid size-5 flex-none place-items-center rounded text-muy hover:bg-hover hover:text-texto"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
