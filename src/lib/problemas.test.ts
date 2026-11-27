import { describe, expect, it } from "vitest";
import { esDeProblemas, leerProblemas } from "./problemas";

describe("leerProblemas", () => {
  it("tsc con paréntesis y con --pretty", () => {
    const p = leerProblemas("src/a.ts(3,5): error TS2322: Type 'x' is not assignable.\nsrc/b.tsx:7:2 - error TS2304: Cannot find name 'y'.");
    expect(p).toEqual([
      { ruta: "src/a.ts", linea: 3, columna: 5, nivel: "error", codigo: "TS2322", mensaje: "Type 'x' is not assignable." },
      { ruta: "src/b.tsx", linea: 7, columna: 2, nivel: "error", codigo: "TS2304", mensaje: "Cannot find name 'y'." },
    ]);
  });

  it("rustc: la cabecera y la ruta unas líneas más abajo", () => {
    const p = leerProblemas("warning[unused_variables]: unused variable: `x`\n  --> src/main.rs:4:9\n   |\nerror: could not compile `kyu`");
    expect(p).toEqual([{ ruta: "src/main.rs", linea: 4, columna: 9, nivel: "aviso", codigo: "unused_variables", mensaje: "unused variable: `x`" }]);
  });

  it("eslint stylish", () => {
    const p = leerProblemas("src/app.tsx\n  3:10  warning  'a' is defined but never used  no-unused-vars\n  8:1   error    Missing semicolon  semi\n\n");
    expect(p.map((x) => [x.linea, x.nivel, x.codigo])).toEqual([
      [3, "aviso", "no-unused-vars"],
      [8, "error", "semi"],
    ]);
  });

  it("next build: ruta sola y «Type error» debajo", () => {
    const p = leerProblemas("./src/app/page.tsx:12:7\nType error: Property 'x' does not exist.");
    expect(p[0]).toMatchObject({ ruta: "./src/app/page.tsx", linea: 12, mensaje: "Property 'x' does not exist." });
  });

  it("quita los colores y no repite", () => {
    const linea = "\x1b[31msrc/a.ts(1,1): error TS1: mal\x1b[0m";
    expect(leerProblemas(`${linea}\n${linea}`)).toHaveLength(1);
  });
});

describe("esDeProblemas", () => {
  it("reconoce compilaciones y linters", () => {
    for (const o of ["pnpm tipos", "cargo clippy --all-targets", "npx tsc -b", "pnpm run build", "eslint ."]) {
      expect(esDeProblemas(o), o).toBe(o !== "pnpm tipos");
    }
  });
});
