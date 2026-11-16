import { describe, expect, it } from "vitest";
import { moverMes } from "./mes";

describe("moverMes", () => {
  it("cruza el año hacia atrás y hacia delante", () => {
    expect(moverMes("2026-01", -1)).toBe("2025-12");
    expect(moverMes("2026-12", 1)).toBe("2027-01");
    expect(moverMes("2026-11", 0)).toBe("2026-11");
  });
});
