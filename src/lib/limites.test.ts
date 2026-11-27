import { describe, expect, it } from "vitest";
import { agotada, peor, porcentaje, vigente, type Limite } from "./limites";

const ahora = () => Math.floor(Date.now() / 1000);
const limite = (sesion: number, semana: number, estado = "allowed"): Limite => ({
  estado,
  sesion: { uso: sesion, reinicio: ahora() + 3600, estado },
  semana: { uso: semana, reinicio: ahora() + 86400, estado },
  hora: Date.now(),
});

describe("límites de cuenta", () => {
  it("una ventana ya reiniciada no cuenta", () => {
    expect(vigente({ uso: 0.9, reinicio: ahora() - 10, estado: "" })).toBeNull();
  });

  it("peor = la de más uso", () => {
    expect(peor(limite(0.3, 0.6))?.nombre).toBe("semana");
    expect(peor(limite(0.7, 0.6))?.nombre).toBe("sesion");
  });

  it("agotada al 90 % o si la rechazan", () => {
    expect(agotada(limite(0.89, 0.1))).toBe(false);
    expect(agotada(limite(0.9, 0.1))).toBe(true);
    expect(agotada(limite(0.1, 0.1, "rejected"))).toBe(true);
  });

  it("porcentaje entre 0 y 100", () => {
    expect(porcentaje({ uso: 1.4, reinicio: 0, estado: "" })).toBe(100);
    expect(porcentaje({ uso: 0.314, reinicio: 0, estado: "" })).toBe(31);
  });
});
