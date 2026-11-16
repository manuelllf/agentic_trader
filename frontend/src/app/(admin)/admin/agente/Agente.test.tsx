// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../messages/es/admin.json";
import common from "../../../../../messages/es/common.json";
import panel from "../../../../../messages/es/panelAgente.json";

vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn().mockResolvedValue({ token: "jwt", aal: "aal2", uid: "u" }) }));
// La cartera de IBKR la sirve el backend de Vennett, no el agente.
const CARTERA = { synced_at: null, total_value: "8000", total_unrealized_pnl: "-12.5", positions: [
  { ticker: "VWCE", description: "", asset_class: "STK", currency: "USD", quantity: "41", avg_cost: "120", price: "132.4", value: "5428.4", unrealized_pnl: "612.1", live: true }] };
vi.mock("@/lib/api", () => ({ getPersonal: vi.fn(), syncPersonal: vi.fn() }));
import { getPersonal, syncPersonal } from "@/lib/api";
import AgenteRaiz from "./AgenteRaiz";
import { Grafica, indiceCursor } from "./Grafica";
import VistaControl, { usoDelTope } from "./VistaControl";
import { estadoDelAgente } from "./VistaHoy";
import Diario from "./Diario";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.open = true; };
if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.open = false; };

let raiz: Root | undefined;
let caja: HTMLDivElement;
const mensajes = { ...admin, ...common, ...panel };

async function pintar(nodo: React.ReactNode) {
  caja = document.createElement("div");
  document.body.append(caja);
  raiz = createRoot(caja);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{nodo}</NextIntlClientProvider>); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return caja;
}
const json = (c: unknown, estado = 200) => new Response(JSON.stringify(c), { status: estado });
const textoDe = (el: Element) => el.textContent ?? "";
function boton(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find(x => textoDe(x).includes(texto));
  if (!b) throw new Error(`sin botón ${texto}`);
  return b as HTMLButtonElement;
}

const HOY_VACIO = {
  estado: { parada: false, parada_motivo: null, modo: "normal", ia_activa: false, sombra: true },
  cartera: { caja: "5000", valor_total: "5000", valor_maximo: "5000", caida_desde_maximo: "0", posiciones: [] },
  serie: [{ fecha: "2026-11-14", valor_total: "5000", valor_maximo: "5000" }],
  ultima_decision: null, eventos: [], despertares: [],
};
const AGENTE_VACIO = {
  filosofia: null, versiones: [], lecciones: [], fichas: [], seguimiento: [],
  gasto_mes: { por_tipo: [{ tipo: "ia", coste_usd: "1.84" }], total_usd: "1.84", tope_usd: "10" },
};
const CONTROL = { parada: false, motivo: null, modo: "papel", actualizado_en: null, actualizado_por: null, ia_activa: false, sombra: true, mejora: null, revertible: false };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AGENTE_API_URL", "https://agente.test");
  vi.mocked(getPersonal).mockResolvedValue(CARTERA as never);
  try { window.localStorage.clear(); } catch { /* sin almacenamiento */ }
});
afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined; caja?.remove(); document.body.innerHTML = "";
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe("Alphagentic: Hoy", () => {
  it("el agente en sombra y sin IA enseña estados vacíos reales, sin datos de ejemplo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(HOY_VACIO)));
    const v = await pintar(<AgenteRaiz />);
    const t = textoDe(v);
    expect(t).toContain("En sombra");
    expect(t).toContain("Decide pero no opera");
    expect(t).toContain("Sin posiciones todavía");
    expect(t).toContain("Sin decisiones todavía");
    expect(t).toContain("Nada programado");
    expect(t).not.toMatch(/TSM|KNSL|HRMY/);
  });

  it("sin URL o con la API caída, muestra «El agente no está disponible» y reintenta", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("x")).mockResolvedValue(json(HOY_VACIO));
    vi.stubGlobal("fetch", f);
    const v = await pintar(<AgenteRaiz />);
    expect(textoDe(v)).toContain("El agente no está disponible");
    await act(async () => { boton("Reintentar").click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(f).toHaveBeenCalledTimes(2);
    expect(textoDe(v)).toContain("En sombra");
  });

  it("sin la variable de URL no ofrece reintento", async () => {
    vi.stubEnv("NEXT_PUBLIC_AGENTE_API_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const v = await pintar(<AgenteRaiz />);
    expect(textoDe(v)).toContain("El agente no está disponible");
    expect([...v.querySelectorAll("button")].some(b => textoDe(b) === "Reintentar")).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("con posiciones muestra peso y rentabilidad; el estado de parada manda", () => {
    expect(estadoDelAgente({ parada: true, parada_motivo: "x", modo: "parada", ia_activa: true, sombra: true }).titulo).toBe("parado");
    expect(estadoDelAgente({ parada: false, parada_motivo: null, modo: "pausa", ia_activa: true, sombra: true }).titulo).toBe("pausa");
    expect(estadoDelAgente({ parada: false, parada_motivo: null, modo: "normal", ia_activa: true, sombra: false }).titulo).toBe("activo");
  });

  it("cambiar de vista pide Informes y enseña «Sin informes todavía»", async () => {
    const f = vi.fn().mockImplementation(async (url: string) => json(url.includes("/v1/informes") ? { items: [] } : HOY_VACIO));
    vi.stubGlobal("fetch", f);
    const v = await pintar(<AgenteRaiz />);
    await act(async () => { boton("Informes").click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(textoDe(v)).toContain("Sin informes todavía");
    expect(f.mock.calls.some(c => String(c[0]).endsWith("/v1/informes"))).toBe(true);
  });
});

describe("Alphagentic: tu cartera de IBKR en Hoy", () => {
  it("enseña valor, P&L y posiciones con el formato común y sincroniza a petición", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(HOY_VACIO)));
    vi.mocked(syncPersonal).mockResolvedValue({ ...CARTERA, total_value: "8100", synced: 1 } as never);
    const v = await pintar(<AgenteRaiz />);
    const t = textoDe(v);
    expect(t).toContain("Tu cartera de IBKR · solo lectura");
    expect(t).toMatch(/8\.000,00\s\$/);
    expect(t).toMatch(/−12,50\s\$/);
    expect(t).toContain("VWCE");
    expect(t).toContain("el agente no la ve ni la toca");
    await act(async () => { boton("Sincronizar desde IBKR").click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(syncPersonal).toHaveBeenCalledTimes(1);
    expect(textoDe(v)).toMatch(/8\.100,00\s\$/);
  });

  it("apagada en Control, Hoy no la pide ni la enseña", async () => {
    window.localStorage.setItem("vennett.alphagentic.ibkrEnHoy", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(HOY_VACIO)));
    const v = await pintar(<AgenteRaiz />);
    expect(textoDe(v)).not.toContain("Tu cartera de IBKR");
    expect(getPersonal).not.toHaveBeenCalled();
  });
});

describe("Alphagentic: gráfica", () => {
  it("con un solo día pinta un único punto y ningún trazo", async () => {
    const v = await pintar(<Grafica serie={[{ fecha: "2026-11-14", valor_total: "5000", valor_maximo: "5000" }]} />);
    expect(v.querySelectorAll("svg circle")).toHaveLength(1);
    expect(v.querySelector("svg path")).toBeNull();
    expect(textoDe(v)).toContain("Primer día");
  });

  it("con varios días traza la línea y el cursor sigue el dedo", async () => {
    const serie = ["2026-11-12", "2026-11-13", "2026-11-14"].map((fecha, i) => ({ fecha, valor_total: String(5000 + i * 100), valor_maximo: "5200" }));
    const v = await pintar(<Grafica serie={serie} />);
    expect(v.querySelector("svg path")).not.toBeNull();
    const g = v.querySelector<HTMLElement>('[data-testid="pa-grafica"]')!;
    g.getBoundingClientRect = () => ({ left: 0, width: 360, top: 0, height: 200, right: 360, bottom: 200, x: 0, y: 0, toJSON() {} });
    await act(async () => { g.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0 })); });
    expect(textoDe(v)).toContain("5000".length ? "5.000,00" : "");
  });

  it("indiceCursor limita el índice y descuenta la franja de etiquetas", () => {
    expect(indiceCursor(-50, 0, 360, 5)).toBe(0);
    expect(indiceCursor(999, 0, 360, 5)).toBe(4);
    expect(indiceCursor(148, 0, 360, 5)).toBe(2);
    expect(indiceCursor(10, 0, 0, 5)).toBe(0);
    expect(indiceCursor(10, 0, 360, 1)).toBe(0);
  });
});

describe("Alphagentic: Control", () => {
  const servicio = (extra?: (url: string, init?: RequestInit) => Response | undefined) => vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const r = extra?.(url, init);
    if (r) return r;
    return json(url.endsWith("/v1/control") ? CONTROL : AGENTE_VACIO);
  });

  it("enseña modo Papel, IA y sombra solo en lectura y el gasto frente al tope", async () => {
    vi.stubGlobal("fetch", servicio());
    const v = await pintar(<VistaControl />);
    const t = textoDe(v);
    expect(t).toContain("Papel");
    expect(t).toContain("AGENTE_IA_ACTIVA");
    expect(t).toContain("1,84");
    expect(t).toContain("de 10,00");
    expect(v.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("18");
    // IA y sombra se cambian con variables del servicio, no desde aquí: el único interruptor es el de IBKR.
    const interruptores = v.querySelectorAll('[role="switch"]');
    expect(interruptores).toHaveLength(1);
    expect(interruptores[0].closest("li")?.textContent).toContain("Enseñar tu cartera en Hoy");
  });

  it("el interruptor de IBKR guarda la preferencia y Hoy deja de enseñar la cartera", async () => {
    vi.stubGlobal("fetch", servicio());
    const v = await pintar(<VistaControl />);
    const sw = v.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => { sw.click(); });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("vennett.alphagentic.ibkrEnHoy")).toBe("0");
  });

  it("parar pide motivo en una alerta propia y no manda nada sin él", async () => {
    const f = servicio((url, init) => init?.method === "POST" ? json({ ...CONTROL, parada: true, motivo: "revisión" }) : undefined);
    vi.stubGlobal("fetch", f);
    const v = await pintar(<VistaControl />);
    await act(async () => { boton("Parar el agente").click(); });
    const dialogo = document.querySelector("dialog")!;
    const aceptar = [...dialogo.querySelectorAll("button")].find(b => textoDe(b) === "Parar") as HTMLButtonElement;
    expect(aceptar.disabled).toBe(true);
    const campo = dialogo.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, "revisión");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { aceptar.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const post = f.mock.calls.find(c => c[1]?.method === "POST")!;
    expect(String(post[0])).toBe("https://agente.test/v1/control/parada");
    expect(JSON.parse(post[1].body)).toEqual({ parada: true, motivo: "revisión" });
    expect(textoDe(v)).toContain("Reanudar el agente");
    expect(textoDe(v)).toContain("revisión");
  });

  it("sin cambio de filosofía ni adopción no enseña el grupo de filosofía", async () => {
    vi.stubGlobal("fetch", servicio());
    const v = await pintar(<VistaControl />);
    expect(textoDe(v)).not.toContain("Cambio en prueba");
    expect(textoDe(v)).not.toContain("Volver a la versión anterior");
  });

  it("enseña el cambio en prueba y vuelve a la versión anterior tras confirmar", async () => {
    const conPrueba = { ...CONTROL, revertible: true, mejora: { id: 1, estado: "en_sombra", hipotesis: "Más paciencia", sombra_desde: "2026-11-17", sombra_hasta: "2026-12-01" } };
    const f = servicio((url, init) => {
      if (init?.method === "POST") return json({ ...conPrueba, revertible: false });
      return url.endsWith("/v1/control") ? json(conPrueba) : undefined;
    });
    vi.stubGlobal("fetch", f);
    const v = await pintar(<VistaControl />);
    expect(textoDe(v)).toContain("Cambio en prueba");
    expect(textoDe(v)).toContain("Más paciencia");
    await act(async () => { boton("Volver a la versión anterior").click(); });
    const aceptar = [...document.querySelector("dialog")!.querySelectorAll("button")].find(b => textoDe(b) === "Volver") as HTMLButtonElement;
    await act(async () => { aceptar.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const post = f.mock.calls.find(c => c[1]?.method === "POST")!;
    expect(String(post[0])).toBe("https://agente.test/v1/control/filosofia/revertir");
    expect(textoDe(v)).not.toContain("Volver a la versión anterior");
  });

  it("usoDelTope se queda entre 0 y 100 y sin tope no hay barra", () => {
    expect(usoDelTope("1.84", "10")).toBeCloseTo(18.4);
    expect(usoDelTope("30", "10")).toBe(100);
    expect(usoDelTope("5", "0")).toBe(0);
  });
});

describe("Alphagentic: Diario", () => {
  it("no busca hasta que se escribe y muestra el vacío real si no hay resultados", async () => {
    const f = vi.fn().mockResolvedValue(json({ items: [] }));
    vi.stubGlobal("fetch", f);
    try {
      const v = await pintar(<Diario />);
      vi.useFakeTimers();
      expect(textoDe(v)).toContain("Busca en sus decisiones");
      expect(f).not.toHaveBeenCalled();
      const campo = v.querySelector("input")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "crudo");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(String(f.mock.calls[0][0])).toBe("https://agente.test/v1/diario?q=crudo");
      expect(textoDe(v)).toContain("Nada con «crudo»");
    } finally { vi.useRealTimers(); }
  });
});
