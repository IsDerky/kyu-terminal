import { describe, expect, it } from "vitest";
import { contar, diffLineas, recortar } from "./diff";

describe("diffLineas", () => {
  it("marca lo quitado y lo puesto con sus números de línea", () => {
    const l = diffLineas("a\nb\nc\n", "a\nB\nc\n");
    expect(l.map((x) => [x.tipo, x.texto])).toEqual([
      ["igual", "a"],
      ["quita", "b"],
      ["pone", "B"],
      ["igual", "c"],
    ]);
    expect(l.find((x) => x.tipo === "quita")?.antes).toBe(2);
    expect(l.find((x) => x.tipo === "pone")?.despues).toBe(2);
  });

  it("archivo nuevo: todo puesto", () => {
    expect(contar(diffLineas("", "x\ny\n"))).toEqual({ puestas: 2, quitadas: 0 });
  });

  it("no distingue CRLF de LF", () => {
    expect(contar(diffLineas("a\r\nb\r\n", "a\nb\n"))).toEqual({ puestas: 0, quitadas: 0 });
  });
});

describe("recortar", () => {
  it("deja 3 líneas de contexto y un salto con las que se callan", () => {
    const antes = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const despues = antes.replace("l10", "X");
    const t = recortar(diffLineas(antes, despues));
    const saltos = t.filter((x) => x.tipo === "salto");
    expect(saltos.length).toBeGreaterThan(0);
    expect(t.filter((x) => x.tipo === "igual")).toHaveLength(6);
  });
});
