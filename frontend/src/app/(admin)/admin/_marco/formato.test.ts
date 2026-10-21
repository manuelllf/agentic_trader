import { afterEach, describe, expect, it, vi } from "vitest";
import { dolares, euros, numero, porcentajeSimple, porcentajeConSigno, fechaCorta, fechaHora, hace } from "./formato";

afterEach(() => vi.useRealTimers());
describe.each(["es", "en"])("formato %s", locale => {
  it("formatea importes con dos decimales y el mínimo en dólares", () => {
    const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
    expect(dolares("3.9", locale)).toBe(usd.format(3.9));
    expect(dolares(0.001, locale)).toBe(`<${usd.format(0.01)}`);
    expect(dolares(0, locale)).toBe(usd.format(0));
    expect(dolares(0.005, locale)).toBe(usd.format(0.005));
    expect(euros("3.9", locale)).toBe(new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(3.9));
    expect(euros(0.001, locale)).toBe(new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(0));
  });
  it("formatea enteros y porcentajes", () => {
    expect(numero("1234567.2", locale)).toBe(locale === "es" ? "1.234.567" : "1,234,567");
    expect(porcentajeSimple(78, locale)).toBe("78\u00a0%");
    expect(porcentajeSimple(78.2, locale, 1)).toBe(locale === "es" ? "78,2\u00a0%" : "78.2\u00a0%");
    expect(porcentajeConSigno(1.4, locale)).toBe(locale === "es" ? "+1,4\u00a0%" : "+1.4\u00a0%");
    expect(porcentajeConSigno(-0.8, locale)).toBe(locale === "es" ? "−0,8\u00a0%" : "−0.8\u00a0%");
    expect(porcentajeConSigno(0, locale)).toBe(locale === "es" ? "0,0\u00a0%" : "0.0\u00a0%");
    expect(porcentajeConSigno(-0.001, locale)).not.toMatch(/[+−-]/);
  });
  it("formatea fechas, añade el año distinto y conserva el día UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    expect(fechaCorta("2026-10-16", locale)).toBe(locale === "es" ? "16 oct" : "Oct 16");
    expect(fechaCorta("2025-10-16", locale)).toBe(locale === "es" ? "16 oct 2025" : "Oct 16, 2025");
    const instante = "2026-10-21T16:56:00Z";
    expect(fechaHora(instante, locale)).toBe(new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(instante)));
  });
  it("expresa tiempos relativos y usa fecha desde siete días", () => {
    const ahora = new Date("2026-10-21T12:00:00Z");
    expect(hace("2026-10-21T11:59:40Z", locale, ahora)).toBe(locale === "es" ? "ahora" : "now");
    expect(hace("2026-10-21T11:58:00Z", locale, ahora)).toBe(locale === "es" ? "hace 2 minutos" : "2 minutes ago");
    expect(hace("2026-10-21T10:00:00Z", locale, ahora)).toBe(locale === "es" ? "hace 2 horas" : "2 hours ago");
    expect(hace("2026-10-15T12:00:00Z", locale, ahora)).toBe(locale === "es" ? "hace 6 días" : "6 days ago");
    expect(hace("2026-10-14T12:00:00Z", locale, ahora)).toBe(fechaCorta("2026-10-14T12:00:00Z", locale));
  });
});
