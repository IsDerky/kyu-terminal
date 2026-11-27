// Modo, modelo, esfuerzo, catálogo de Claude Code y cuentas.
import { abrirClaude, cerrarClaude, controlClaude, type ConfigVista } from "../nucleo";
import { opcionPor } from "../agentes";
import { catalogoGuardado, esfuerzos, guardarCatalogo, guardarPrefs, modeloDe, modosDisponibles, type Catalogo, type Preferencias } from "../claudeOpciones";
import { useClaude, conversacion, siguienteId, cambiar, añadir } from "./estado";
import { opcionesDe, cambiarOpcionAgente } from "./sitios";

export function guardarCatalogoDe(r: Catalogo) {
  if (!r?.models?.length) return;
  guardarCatalogo(r);
  useClaude.setState({ catalogo: catalogoGuardado() });
}

let probado = false;

/** Una vez por sesión de Kyu, arranca Claude un momento solo para pedirle comandos y modelos (no
 *  gasta tokens): el guardado puede ser de una versión anterior de Claude Code. */
export async function cargarCatalogo(carpeta: string | null) {
  if (probado) return;
  probado = true;
  let id: number | null = null;
  try {
    id = await abrirClaude(carpeta, {}, () => {});
    guardarCatalogoDe(await controlClaude<Catalogo>(id, { subtype: "initialize" }));
  } catch {
    // Sin catálogo los menús salen con lo mínimo.
  } finally {
    if (id !== null) void cerrarClaude(id);
  }
}

function recordar(p: Partial<Preferencias>) {
  const prefs = { ...useClaude.getState().prefs, ...p };
  guardarPrefs(prefs);
  useClaude.setState({ prefs });
}

/** Cambia el modo de permisos: en vivo si Claude ya está en marcha, si no al arrancar. */
export async function cambiarModo(espacio: string, modo: string) {
  const c = conversacion(espacio);
  cambiar(espacio, () => ({ modo }));
  recordar({ modo });
  if (c.claudeId === null) return;
  try {
    await controlClaude(c.claudeId, { subtype: "set_permission_mode", mode: modo });
  } catch (e) {
    cambiar(espacio, () => ({ modo: c.modo }));
    añadir(espacio, { tipo: "error", texto: `No se pudo cambiar el modo: ${e}` });
  }
}

/** Mayús+Tab: el siguiente modo. */
export function siguienteModo(espacio: string) {
  const c = conversacion(espacio);
  if (c.agente) {
    const o = opcionPor(opcionesDe(c), "mode");
    if (!o?.valores.length) return;
    const i = o.valores.findIndex((v) => v.valor === o.actual);
    void cambiarOpcionAgente(espacio, o.id, o.valores[(i + 1) % o.valores.length].valor);
    return;
  }
  const lista = modosDisponibles(modeloDe(useClaude.getState().catalogo, c.eleccionModelo));
  const i = lista.findIndex((m) => m.id === c.modo);
  void cambiarModo(espacio, lista[(i + 1) % lista.length].id);
}

export async function cambiarModelo(espacio: string, modelo: string | null) {
  const c = conversacion(espacio);
  // Si el modelo nuevo no admite el esfuerzo elegido, se vuelve al predeterminado.
  const niveles = esfuerzos(modeloDe(useClaude.getState().catalogo, modelo));
  const esfuerzo = c.esfuerzo && niveles.includes(c.esfuerzo) ? c.esfuerzo : null;
  cambiar(espacio, () => ({ eleccionModelo: modelo, esfuerzo }));
  recordar({ modelo, esfuerzo });
  if (c.claudeId === null) return;
  try {
    await controlClaude(c.claudeId, { subtype: "set_model", model: modelo ?? "default" });
    if (esfuerzo !== c.esfuerzo) await controlClaude(c.claudeId, { subtype: "apply_flag_settings", settings: { effortLevel: esfuerzo } });
    añadir(espacio, { tipo: "aviso", texto: "Modelo cambiado: se nota a partir del próximo mensaje" });
  } catch (e) {
    cambiar(espacio, () => ({ eleccionModelo: c.eleccionModelo, esfuerzo: c.esfuerzo }));
    añadir(espacio, { tipo: "error", texto: `No se pudo cambiar el modelo: ${e}` });
  }
}

/** «max» solo vale al arrancar (Claude Code no lo admite en caliente). */
export const esfuerzoEnCaliente = (nivel: string | null) => nivel !== "max";

export async function cambiarEsfuerzo(espacio: string, esfuerzo: string | null) {
  const c = conversacion(espacio);
  if (c.claudeId !== null && !esfuerzoEnCaliente(esfuerzo)) return;
  cambiar(espacio, () => ({ esfuerzo }));
  recordar({ esfuerzo });
  if (c.claudeId === null) return;
  try {
    await controlClaude(c.claudeId, { subtype: "apply_flag_settings", settings: { effortLevel: esfuerzo } });
  } catch (e) {
    cambiar(espacio, () => ({ esfuerzo: c.esfuerzo }));
    añadir(espacio, { tipo: "error", texto: `No se pudo cambiar el esfuerzo: ${e}` });
  }
}

/**
 * Al leer kyu.toml: qué cuentas hay y si hay sugerencias. Las conversaciones con una cuenta que
 * ya no existe vuelven a la de siempre.
 */
export function configurarClaude({
  cuentas_claude: cuentas,
  cuentas_antigravity: cuentasAntigravity,
  sugerencias_claude: sugerencias,
}: ConfigVista) {
  useClaude.setState((s) => {
    const vale = (x: string | null, lista: string[]) => (x && lista.includes(x) ? x : null);
    const prefs = { ...s.prefs, cuenta: vale(s.prefs.cuenta, cuentas) };
    guardarPrefs(prefs);
    const conversaciones = Object.fromEntries(
      Object.entries(s.conversaciones).map(([id, c]) => [
        id,
        {
          ...c,
          cuenta: c.agente === "antigravity" ? vale(c.cuenta, cuentasAntigravity) : c.agente ? null : vale(c.cuenta, cuentas),
        },
      ]),
    );
    return { cuentas, cuentasAntigravity, sugerencias, prefs, conversaciones };
  });
}

export const cuentaValida = (x: string | null) => (x && useClaude.getState().cuentas.includes(x) ? x : null);

/**
 * Cambia la cuenta de la conversación. Si Claude está en marcha (y sin hacer nada), se cierra
 * y con el próximo mensaje sigue la misma conversación con la otra cuenta (`--resume`).
 */
export function cambiarCuenta(espacio: string, cuenta: string | null) {
  const c = conversacion(espacio);
  if (c.estado === "arrancando" || c.estado === "pensando" || cuenta === c.cuenta) return;
  if (!c.agente) recordar({ cuenta });
  if (c.claudeId === null) {
    cambiar(espacio, () => ({ cuenta }));
    return;
  }
  void cerrarClaude(c.claudeId);
  cambiar(espacio, (x) => ({
    cuenta,
    claudeId: null,
    generacion: siguienteId(),
    estado: "cerrado",
    reanudar: x.sesion,
    sugerencia: null,
  }));
  añadir(espacio, { tipo: "aviso", texto: `Cuenta: ${cuenta ?? "la de siempre"} · la conversación sigue con el próximo mensaje` });
}
