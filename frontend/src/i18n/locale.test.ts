import { describe, expect, it } from "vitest";
import { acceptLanguage, deviceLocale, normalizeLocale, preferredLocale, readCookie } from "./locale";
import { porcentaje, fecha, miles } from "../lib/liga/format";

describe("language resolution", () => {
  it("uses device language when the ordered language list is unavailable", () => {
    expect(deviceLocale(undefined, "en-US")).toBe("en");
    expect(deviceLocale([], "en-GB")).toBe("en");
    expect(deviceLocale(["es-MX", "en-US"], "en-US")).toBe("es");
    expect(deviceLocale(undefined, "fr-FR")).toBe("es");
  });
  it("honors browser priority and supported regional variants", () => {
    expect(preferredLocale(["fr-FR", "en-GB", "es-ES"])).toBe("en");
    expect(normalizeLocale(" ES_mx ")).toBe("es");
    expect(normalizeLocale("../en")).toBeNull();
    expect(preferredLocale(["fr"])).toBe("es");
  });
  it("honors HTTP quality and rejects excluded or invalid priorities", () => {
    expect(acceptLanguage("en;q=0.2,es;q=0.9")).toBe("es");
    expect(acceptLanguage("es;q=0,en-US;q=1")).toBe("en");
    expect(acceptLanguage("en;q=NaN,es;q=0.5")).toBe("es");
  });
  it("reads only the exact cookie and handles malformed encoding", () => {
    expect(readCookie("vennett_locale", "other_vennett_locale=en; vennett_locale=es")).toBe("es");
    expect(readCookie("vennett_locale", "vennett_locale=%GG")).toBeNull();
  });
});

describe("localized financial presentation", () => {
  it("keeps rounding and neutral zero identical in both languages", () => {
    expect(porcentaje(-0.05, 1, "en")).toBe("−0.1 %");
    expect(porcentaje(-0.05, 1, "es")).toBe("−0,1 %");
    expect(porcentaje(-0.001, 1, "en")).toBe("0.0 %");
    expect(miles(12345, "en")).toBe("12,345");
    expect(miles(12345, "es")).toBe("12.345");
  });
  it("changes date wording without changing the existing calendar boundary", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(fecha("2026-10-03T22:30:00Z", now, "es")).toBe("4 de octubre");
    expect(fecha("2026-10-03T22:30:00Z", now, "en")).toBe("October 4");
  });
});
