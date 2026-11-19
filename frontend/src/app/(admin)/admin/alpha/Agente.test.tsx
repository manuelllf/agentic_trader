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
import Decisiones from "./Decisiones";
import { TareasDelDia } from "./Dia";
import { eventosDe, type Textos } from "./lienzo";
import { tituloDecision } from "./textos";

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
  ultima_decision: null, decisiones_total: 0, dia: "2026-11-15", dia_anterior: null, eventos: [], despertares: [],
};
const DIA_VACIO = { fecha: "2026-11-15", programa: [], ejecuciones: [], eventos: [], decisiones: [], ordenes_ejecutadas: 0 };
const SIN_CICLO = { ciclo: null, en_curso: false, decision_id: null, items: [] };
/** El servicio del agente para Hoy: cada ruta con su forma. */
const rutasHoy = (url: string) => json(url.includes("/v1/dia/") ? DIA_VACIO : url.includes("/v1/ciclo/") ? SIN_CICLO
  : url.includes("/v1/informes") ? { items: [] } : HOY_VACIO);
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

describe("Alpha: Hoy", () => {
  it("el agente en sombra y sin IA enseña estados vacíos reales, sin datos de ejemplo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => rutasHoy(url)));
    const v = await pintar(<AgenteRaiz />);
    const t = textoDe(v);
    expect(t).toContain("En sombra");
    expect(t).toContain("Decide pero no opera");
    expect(t).toContain("Sin posiciones todavía");
    expect(t).toContain("Sin decisiones todavía");
    expect(t).toContain("Todas las decisiones");
    expect(t).toContain("El día, en hora de Nueva York y de Madrid");
    expect(t).toContain("Sin tareas este día");
    expect(t).toContain("Ahora no está pensando; repite la última");
    expect(t).not.toMatch(/TSM|KNSL|HRMY/);
  });

  it("sin URL o con la API caída, muestra «El agente no está disponible» y reintenta", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("x")).mockImplementation(async (url: string) => rutasHoy(url));
    vi.stubGlobal("fetch", f);
    const v = await pintar(<AgenteRaiz />);
    expect(textoDe(v)).toContain("El agente no está disponible");
    await act(async () => { boton("Reintentar").click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(String(f.mock.calls[1][0])).toBe("https://agente.test/v1/hoy");
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
    const f = vi.fn().mockImplementation(async (url: string) => rutasHoy(url));
    vi.stubGlobal("fetch", f);
    const v = await pintar(<AgenteRaiz />);
    await act(async () => { boton("Informes").click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(textoDe(v)).toContain("Sin informes todavía");
    expect(f.mock.calls.some(c => String(c[0]).endsWith("/v1/informes"))).toBe(true);
  });
});

describe("Alpha: tu cartera de IBKR en Hoy", () => {
  it("enseña valor, P&L y posiciones con el formato común y sincroniza a petición", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => rutasHoy(url)));
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
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => rutasHoy(url)));
    const v = await pintar(<AgenteRaiz />);
    expect(textoDe(v)).not.toContain("Tu cartera de IBKR");
    expect(getPersonal).not.toHaveBeenCalled();
  });
});

describe("Alpha: gráfica", () => {
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

describe("Alpha: Control", () => {
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

describe("Alpha: todas las decisiones", () => {
  const RESUMEN = { id: 7, fecha: "2026-11-16", tipo: "operar", sombra: true, veredicto: "aprobada", razonamiento: "r",
    creado: "2026-11-16T23:46:30Z", operaciones: [{ ticker: "RDDT", lado: "compra" }, { ticker: "MSFT", lado: "compra" }] };

  it("las agrupa por día con su título y busca al dejar de escribir", async () => {
    const f = vi.fn().mockImplementation(async (url: string) => json(url.includes("/v1/diario") ? { items: [] } : { items: [RESUMEN], siguiente: null }));
    vi.stubGlobal("fetch", f);
    try {
      const v = await pintar(<Decisiones />);
      expect(String(f.mock.calls[0][0])).toBe("https://agente.test/v1/decisiones?limite=100");
      expect(textoDe(v)).toContain("Lunes, 16 nov");
      expect(textoDe(v)).toContain("Compra RDDT y MSFT");
      expect(textoDe(v)).toContain("Aprobada · En sombra");
      expect(v.querySelector(".pnl-grupo a")?.getAttribute("href")).toBe("/admin/alpha/decisiones/7?desde=decisiones");
      vi.useFakeTimers();
      const campo = v.querySelector("input")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "crudo");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(f.mock.calls.some(c => String(c[0]) === "https://agente.test/v1/diario?q=crudo")).toBe(true);
      expect(textoDe(v)).toContain("Nada con «crudo»");
    } finally { vi.useRealTimers(); }
  });

  it("el título junta las empresas por lado y sin operaciones usa el tipo", () => {
    const t = ((k: string) => ({ pnl_agente_lado_compra: "Compra", pnl_agente_lado_venta: "Venta", pnl_agente_dec_tipo_nada: "Sin operar" }[k] ?? k)) as never;
    expect(tituloDecision([{ ticker: "A", lado: "compra" }, { ticker: "B", lado: "venta" }, { ticker: "C", lado: "compra" }], "operar", t, "es"))
      .toBe("Compra A y C y Venta B");
    expect(tituloDecision([], "nada", t, "es")).toBe("Sin operar");
  });
});

describe("Alpha: el día", () => {
  it("cada tarea sale con lo que hizo, lo que falló y lo pendiente a su hora", async () => {
    const dia = {
      fecha: "2026-11-16", ordenes_ejecutadas: 0,
      programa: [{ tarea: "vigia_previo", hora: "2026-11-16T13:45:00Z" }, { tarea: "ejecucion", hora: "2026-11-16T14:35:00Z" },
        { tarea: "despertar", hora: "2026-11-16T22:30:00Z" }, { tarea: "consolidacion", hora: "2099-11-17T00:30:00Z" }],
      ejecuciones: [
        { id: 1, tarea: "vigia_previo", fecha_ny: "2026-11-16", estado: "hecha", empezada: "2026-11-16T13:45:00Z", terminada: "2026-11-16T13:46:00Z", error: null },
        { id: 2, tarea: "ejecucion", fecha_ny: "2026-11-16", estado: "fallida", empezada: "2026-11-16T14:35:00Z", terminada: "2026-11-16T14:36:00Z", error: "sin precio; detalle" },
        { id: 3, tarea: "despertar", fecha_ny: "2026-11-16", estado: "hecha", empezada: "2026-11-16T22:30:00Z", terminada: "2026-11-16T22:47:00Z", error: null }],
      eventos: [
        { id: 9, ocurrido: "2026-11-16T13:46:00Z", origen: "sistema", tipo: "premarket", ticker: null, datos: { empresas: 30, con_precio: 22, movimientos: 2 }, ejecucion_id: 1 },
        { id: 10, ocurrido: "2026-11-16T22:47:00Z", origen: "ciclo", tipo: "decision", ticker: null, datos: { decision_id: 3 }, ejecucion_id: 3 }],
      decisiones: [{ id: 3, fecha: "2026-11-16", tipo: "operar", sombra: true, veredicto: "aprobada", razonamiento: "", creado: "2026-11-16T22:40:00Z", operaciones: [{ ticker: "RDDT", lado: "compra" }] }],
    };
    const v = await pintar(<TareasDelDia dia={dia as never} />);
    const t = textoDe(v);
    expect(t).toContain("2 movimientos fuertes en el premarket");
    expect(t).toContain("sin precio");
    expect(t).not.toContain("detalle");
    expect(t).toContain("Compra RDDT · en sombra");
    expect(t).toContain("Ordena lo aprendido");
    // Cada hora sale en Nueva York y en Madrid (en noviembre, 6 horas de diferencia).
    expect(t).toContain("08:46 NY");
    expect(t).toContain("14:46 Madrid");
    expect(t).toContain("17:47 NY");
    expect(t).toContain("23:47 Madrid");
    expect(v.querySelectorAll("li.hecho")).toHaveLength(2);
    expect(v.querySelectorAll("li.fallo")).toHaveLength(1);
    expect(v.querySelectorAll("li.pendiente")).toHaveLength(1);
  });
});

describe("Alpha: En vivo", () => {
  const T = new Proxy({}, { get: (_, k: string) => (k === "pipe" ? { limites: ["", ""], revisor: ["", ""], ordenes: ["", ""], diario: ["", ""] }
    : k === "lista" ? (xs: string[]) => xs.join(", ") : (...a: unknown[]) => `${k}${a.length ? `(${a.join(",")})` : ""}`) }) as unknown as Textos;
  const llamada = (id: number, creado: string, latencia: number, extra: object) => ({ id, etapa: "agente", paso: id, modelo: "deepseek-flash", enviado: [],
    respuesta: "", razonamiento: "Mira la cartera.", herramientas_pedidas: [], coste_usd: "0.001", latencia_ms: latencia, ok: true, error: null, creado, ...extra });

  it("las herramientas de una vuelta salen juntas y duran el hueco real hasta la siguiente llamada", () => {
    const ll = [
      llamada(1, "2026-11-16T23:46:40Z", 2000, { herramientas_pedidas: [{ id: "a", function: { name: "price", arguments: "{\"tickers\":[\"AAA\",\"BBB\"]}" } },
        { id: "b", function: { name: "portfolio", arguments: "{}" } }] }),
      llamada(2, "2026-11-16T23:46:50Z", 4000, { enviado: [{ role: "tool", tool_call_id: "b", content: "{\"cash\": 5000}" }] }),
    ];
    const r = eventosDe(ll as never, null, T);
    const herr = r.eventos.find(e => e.tipo === "herr")!;
    expect(herr.tipo === "herr" && herr.grupos.map(g => [g.nombre, g.ida])).toEqual([["price", "AAA, BBB"], ["portfolio", ""]]);
    // De que acaba la llamada 1 (40 s) a que empieza la 2 (50 − 4 = 46 s): 6 s reales.
    expect(herr.real).toBe(6);
    expect(r.eventos.map(e => e.tipo)).toEqual(["despertar", "piensa", "herr", "piensa"]);
  });

  it("un ciclo en curso acaba en la vuelta que está pensando, sin hora de fin", () => {
    const r = eventosDe([llamada(1, "2026-11-16T23:46:40Z", 2000, {})] as never, null, T, true);
    const ultimo = r.eventos.at(-1)!;
    expect(ultimo.tipo === "piensa" && ultimo.abierta).toBe(true);
    expect(ultimo.hasta).toBeNull();
  });
});

describe("Alpha: cómo llegó aquí", () => {
  const vuelta = (paso: number, extra: object) => ({
    id: paso, etapa: "agente", paso, modelo: "m", enviado: [], respuesta: "", razonamiento: null, herramientas_pedidas: [],
    coste_usd: "0.0015", latencia_ms: 1200, ok: true, error: null, creado: "2026-11-17T23:46:39Z", ...extra,
  });
  const LLAMADAS = [
    vuelta(1, {
      enviado: [{ role: "system", content: "Eres el agente" }, { role: "user", content: "Contexto de hoy" }],
      razonamiento: "Let me screen the watchlist first.",
      herramientas_pedidas: [{ id: "c1", function: { name: "screen", arguments: "{\"sort\": \"drawdown\"}" } },
        { id: "c2", function: { name: "valuation", arguments: "{\"ticker\": \"TSM\"}" } }],
    }),
    vuelta(2, {
      enviado: [
        { role: "tool", tool_call_id: "c1", content: JSON.stringify({ universe: 2, shown: 2, sort: "drawdown", columns: "ticker close", rows: ["AAA 10.5 -3.2 41 -12.3", "BBB 20 1 55 -2"] }) },
        { role: "tool", tool_call_id: "c2", content: JSON.stringify({ error: "sin datos" }) },
        { role: "user", content: "Last turn: no more tools are available." }],
      respuesta: JSON.stringify({ decision: { tipo: "operar", operaciones: [{ lado: "compra", ticker: "RDDT" }] } }),
    }),
    { ...vuelta(3, { respuesta: JSON.stringify({ verdict: "approve", reason: "Encaja" }) }), id: 3, etapa: "revisor", paso: 1 },
  ];
  const conLlamadas = (items: unknown[]) => vi.fn((url: string) => Promise.resolve(json(
    url.endsWith("/llamadas") ? { items } : {
      id: 3, ejecucion_id: 5, fecha_ny: "2026-11-17", tipo: "operar", sombra: true, playbook_version_id: 1,
      propuesta: { operaciones: [] }, razonamiento: "Compro RDDT", previsiones: [], revisor_veredicto: "aprobada",
      revisor_motivo: null, modelo: "deepseek", creado: "2026-11-17T23:46:30Z", ordenes: [],
    })));

  it("lista cada vuelta y empuja el resultado de una herramienta dentro de la misma hoja", async () => {
    vi.stubGlobal("fetch", conLlamadas(LLAMADAS));
    const { default: Decision } = await import("./Decision");
    const v = await pintar(<Decision id="3" />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const t = textoDe(v);
    expect(t).toContain("Cómo llegó aquí");
    // Las herramientas van con su nombre real, nunca traducidas.
    expect(t).toContain("screen y valuation");
    expect(t).toContain("Decisión final");
    expect(t).toContain("Operar · compra RDDT");
    expect(t).toContain("2 vueltas del agente y el revisor");
    expect(t).toContain("Verlo en vivo");
    await act(async () => { boton("screen y valuation").click(); });
    const hoja = document.querySelector("dialog.hoja-liga[open]")!;
    expect(textoDe(hoja)).toContain("Vuelta 1");
    expect(textoDe(hoja)).toContain("Lo que tenía al despertar");
    expect(textoDe(hoja)).toContain("Let me screen the watchlist first.");
    expect(textoDe(hoja)).toContain("sin datos");
    const enHoja = (texto: string) => [...hoja.querySelectorAll("button")].find(b => textoDe(b).startsWith(texto))!;
    expect(textoDe(hoja)).toContain("valuation · TSM");
    await act(async () => { enHoja("screen").click(); });
    expect(textoDe(hoja.querySelector("h2")!)).toBe("screen");
    expect(textoDe(hoja)).toContain("AAA");
    expect(textoDe(hoja)).toContain("−12,3 %");
    await act(async () => { hoja.querySelector<HTMLButtonElement>(".hoja-liga-acc.atras")!.click(); });
    expect(textoDe(hoja.querySelector("h2")!)).toBe("Vuelta 1");
  });

  it("una decisión anterior al registro lo dice en vez de quedarse en blanco", async () => {
    vi.stubGlobal("fetch", conLlamadas([]));
    const { default: Decision } = await import("./Decision");
    const v = await pintar(<Decision id="2" />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(textoDe(v)).toContain("Sin registro de pasos");
  });
});
