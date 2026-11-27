import { beforeEach, describe, expect, it } from "vitest";
import { aplanar, heredar, repartoInicial, tamanos } from "./tamanos";

beforeEach(() => tamanos.clear());

describe("tamanos", () => {
  it("a partes iguales si no se sabe nada", () => {
    expect(repartoInicial("d", ["a", "b"])).toEqual({ a: 50, b: 50 });
  });

  it("los guardados al restaurar, normalizados a 100", () => {
    expect(repartoInicial("d", ["a", "b"], [30, 90])).toEqual({ a: 25, b: 75 });
  });

  it("un hijo nuevo se lleva lo que falta", () => {
    tamanos.set("d", { a: 70 });
    const r = repartoInicial("d", ["a", "b"]);
    expect(r.a).toBeCloseTo(70);
    expect(r.b).toBeCloseTo(30);
  });

  it("heredar pasa el % al que sustituye", () => {
    tamanos.set("d", { a: 40, b: 60 });
    heredar("b", "c");
    expect(tamanos.get("d")).toEqual({ a: 40, c: 60 });
  });

  it("aplanar reparte el % del hijo entre los nietos según sus pesos", () => {
    tamanos.set("p", { x: 50, h: 50 });
    tamanos.set("h", { n1: 25, n2: 75 });
    aplanar("p", "h", ["n1", "n2"]);
    expect(tamanos.get("p")).toEqual({ x: 50, n1: 12.5, n2: 37.5 });
  });
});
