import { describe, expect, it } from "vitest";
import { diferenciaCartera } from "./diferencias";

describe("diferenciaCartera", () => {
  it("entra", () => expect(diferenciaCartera([], ["A"])).toEqual({ entra: ["A"], sale: [] }));
  it("sale", () => expect(diferenciaCartera(["A"], [])).toEqual({ entra: [], sale: ["A"] }));
  it("sin cambios, incluso al reordenar", () => expect(diferenciaCartera(["A", "B"], ["B", "A"])).toEqual({ entra: [], sale: [] }));
  it("cambio mixto", () => expect(diferenciaCartera(["A", "B"], ["B", "C"])).toEqual({ entra: ["C"], sale: ["A"] }));
});
