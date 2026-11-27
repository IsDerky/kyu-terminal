import { describe, expect, it, vi } from "vitest";

// pasosDe solo lee texto; lo que habla con Tauri y las terminales no hace falta.
vi.mock("./claude", () => ({ useClaude: { subscribe: () => () => {}, getState: () => ({}) }, espacioDe: () => "", enfocarCaja: () => {} }));
vi.mock("./terminales", () => ({ sesion: () => undefined, perfilesConfigurados: () => [] }));
vi.mock("./nucleo", () => ({ escribirPty: async () => {} }));

const { esRunbook, pasosDe } = await import("./runbook");

const texto = [
  "**Paso 1** · En WSL:",
  "```bash",
  "./deploy.sh check",
  "```",
  "Luego, en el servidor (`ssh web`):",
  "```",
  "systemctl status postfix",
  "```",
  "Y otra vez aquí:",
  "```sh",
  "echo listo",
  "```",
  "Esto no es una orden:",
  "```json",
  '{ "a": 1 }',
  "```",
].join("\n");

describe("pasosDe", () => {
  it("cada bloque de shell con su terminal; JSON fuera", () => {
    const p = pasosDe(texto);
    expect(p.map((x) => [x.codigo, x.destino])).toEqual([
      ["./deploy.sh check", { tipo: "wsl" }],
      ["systemctl status postfix", { tipo: "ssh", host: "web" }],
      ["echo listo", { tipo: "wsl" }],
    ]);
  });

  it("el título es la línea de encima, sin Markdown ni dos puntos", () => {
    expect(pasosDe(texto)[0].titulo).toBe("Paso 1 · En WSL");
  });

  it("sin pista ni lenguaje, va donde el anterior", () => {
    const p = pasosDe("En el servidor (`ssh web`):\n```bash\nuptime\n```\n\n```\ndf -h\n```");
    expect(p[1].destino).toEqual({ tipo: "ssh", host: "web" });
  });
});

describe("esRunbook", () => {
  it("dos pasos o uno que dice «Paso N»", () => {
    const uno = "Ejecuta:\n```powershell\nGet-Date\n```";
    expect(esRunbook(uno, pasosDe(uno))).toBe(false);
    const conPaso = "Paso 1: \n```powershell\nGet-Date\n```";
    expect(esRunbook(conPaso, pasosDe(conPaso))).toBe(true);
    expect(esRunbook(texto, pasosDe(texto))).toBe(true);
  });
});
