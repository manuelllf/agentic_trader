import { describe, expect, it } from "vitest";
import { anioDeLiga } from "./anio";
import type { Portada } from "@/lib/liga/api";

const portada = (en_juego: string | null, proxima: string | null) => ({
  en_juego: en_juego ? { dia_inicio: en_juego } : null,
  proxima: proxima ? { dia_inicio: proxima } : null,
} as unknown as Pick<Portada, "en_juego" | "proxima">);

describe("anioDeLiga", () => {
  it("prioriza la jornada en juego", () => expect(anioDeLiga(portada("2028-01-01", "2029-01-01"))).toBe(2028));
  it("usa la próxima si no hay jornada en juego", () => expect(anioDeLiga(portada(null, "2029-01-01"))).toBe(2029));
  it("usa el año actual si no hay portada", () => {
    const ahora = new Date(2027, 0, 5);
    expect(anioDeLiga(null, ahora)).toBe(2027);
    expect(anioDeLiga(undefined, ahora)).toBe(2027);
  });
  it("pasa una fecha mal formada y usa la siguiente fuente", () => expect(anioDeLiga(portada("xxxx-01-01", "2030-01-01"))).toBe(2030));
});
