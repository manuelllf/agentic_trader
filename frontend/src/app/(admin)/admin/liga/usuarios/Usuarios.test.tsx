// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import common from "../../../../../../messages/es/common.json";
import personas from "../../../../../../messages/es/panelPersonas.json";
import { get, post } from "@/lib/api";
import { ListaUsuarios } from "./ListaUsuarios";
import { FichaUsuario } from "./FichaUsuario";
import { fechaEnDias, fechaFuturaValida, importeValido } from "./HojasFicha";
import type { DiasPanel, FichaPanel, FilaPanel, ListaPanel } from "./panel";

const confirmar = vi.hoisted(() => vi.fn());
const navegacion = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar, dialogo: null }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => navegacion,
  usePathname: () => "/admin/liga/usuarios",
}));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class ApiError extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const proto = HTMLElement.prototype as unknown as { showModal?: () => void; close?: () => void };
proto.showModal ??= function (this: HTMLElement) { this.setAttribute("open", ""); };
proto.close ??= function (this: HTMLElement) { this.removeAttribute("open"); };

let root: Root | undefined;
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; vi.clearAllMocks(); vi.useRealTimers(); });

async function montar(nodo: ReactNode) {
  const div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root?.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...common, ...personas }}>{nodo}</NextIntlClientProvider>));
  return div;
}
const boton = (div: HTMLElement, texto: string) => Array.from(div.querySelectorAll("button")).find(b => b.textContent === texto || b.textContent?.startsWith(texto))!;

const fila: FilaPanel = {
  id: "uno", alias: "Cuenta Uno", oculto: false, creado: "2026-01-01T12:00:00Z", roles: ["usuario", "admin"],
  suspendido: false, pro: true, visitas_total: 12, visitas_7d: 4, ultima_actividad: null, ia_mes_usd: "0.0140",
};
const lista = (total: number): ListaPanel => ({ total, filas: [fila, { ...fila, id: "dos", alias: "Cuenta Dos", pro: false, suspendido: true, roles: ["usuario"] }] });

describe("lista de usuarios", () => {
  it("muestra alias, etiquetas, visitas y coste, y enlaza a la ficha", async () => {
    vi.mocked(get).mockResolvedValue(lista(2) as never);
    const div = await montar(<ListaUsuarios />);
    expect(get).toHaveBeenCalledWith(expect.stringContaining("/liga/admin/panel-usuarios?"));
    expect(get).not.toHaveBeenCalledWith("/liga/admin/panel-usuarios/resumen");
    expect(div.textContent).toContain("Cuenta Uno");
    expect(div.textContent).toContain("admin");
    expect(div.textContent).toContain("suspendido");
    expect(div.textContent).toContain("0,01");
    expect(div.textContent).toContain("4 visitas en 7 días");
    expect(div.textContent).toContain("1 a 2 de 2");
    expect(div.querySelector("a[href='/admin/liga/usuarios/uno']")).not.toBeNull();
  });

  it("guarda filtro y orden en la URL, con un menú propio y no un select", async () => {
    vi.mocked(get).mockResolvedValue(lista(2) as never);
    const div = await montar(<ListaUsuarios />);
    expect(div.querySelector("select")).toBeNull();
    act(() => boton(div, "Suspendidas").click());
    expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?filtro=suspendidas");
    act(() => boton(div, "Ordenar").click());
    expect(div.querySelector("[role='menu']")).not.toBeNull();
    const ia = Array.from(div.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")).find(b => b.textContent === "IA este mes")!;
    act(() => ia.click());
    expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?orden=ia_mes_usd");
    expect(div.querySelector("[role='menu']")).toBeNull();
  });

  it("busca tras una pausa y pagina de cincuenta en cincuenta", async () => {
    vi.mocked(get).mockResolvedValue(lista(120) as never);
    const div = await montar(<ListaUsuarios />);
    vi.useFakeTimers();
    const campo = div.querySelector<HTMLInputElement>(".pnl-buscar input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "ana");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { vi.advanceTimersByTime(400); });
    expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?q=ana");
    act(() => boton(div, "Siguiente").click());
    expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?desde=50");
  });

  it("no pinta botones de página si cabe todo", async () => {
    vi.mocked(get).mockResolvedValue(lista(2) as never);
    const div = await montar(<ListaUsuarios />);
    expect(Array.from(div.querySelectorAll("button"), b => b.textContent)).not.toContain("Siguiente");
  });

  it("crea una cuenta desde la hoja y enseña la contraseña temporal", async () => {
    vi.mocked(get).mockResolvedValue(lista(2) as never);
    vi.mocked(post).mockResolvedValue({ id: "x", email: "a@b.es", alias: "ab", alias_aplicado: false, clave_temporal: "Clave-1" } as never);
    const div = await montar(<ListaUsuarios />);
    act(() => boton(div, "Dar de alta").click());
    const crear = boton(div, "Crear");
    expect(crear.disabled).toBe(true);
    const correo = div.querySelector<HTMLInputElement>("dialog input[type='email']")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(correo, "a@b.es");
      correo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => boton(div, "Crear").click());
    expect(post).toHaveBeenCalledWith("/liga/admin/usuarios", { email: "a@b.es", alias: null });
    expect(div.querySelector("dialog")!.textContent).toContain("Clave-1");
    expect(div.querySelector("dialog")!.textContent).toContain("«ab»");
  });
});

const usuario = {
  id: "uno", alias: "Cuenta Uno", roles: ["usuario"], plan: "gratis" as const, plan_hasta: null, pase_liga: false, pase_hasta: null,
  suspendido: false, creado: "2026-01-01T12:00:00Z", oculto: false, saldo: "3",
};
const ficha: FichaPanel = {
  ...usuario, email: "cuenta@example.com", edad: 30, edad_declarada_en: "2026-01-02T00:00:00Z", baja_solicitada: null,
  terminos: { version: "6", aceptado: true, aceptado_en: "2026-01-02T00:00:00Z" },
  actividad: { visitas_total: 9, visitas_7d: 2, ultima_visita: null, ultima_actividad: null, tiempo_30d_seg: 3700 },
  ia: { mes: { total_usd: "0", llamadas: 0, cache: 0, conversor_usd: "0", conversor_llamadas: 0, pregunta_usd: "0", pregunta_llamadas: 0,
    cobrado_pregunta_usd: "0", lectura_usd: "0", lectura_llamadas: 0, cobrado_lectura_usd: "0", cobrado_usd: "0" }, historico_usd: "0" },
  liga: { estrategias: 2, estrategias_jugando: 1, inscripciones: 3, ligas_propias: 0, ligas_miembro: 1, reportes_hechos: 0, reportes_recibidos: 0 },
};
const dias: DiasPanel = { dias: Array.from({ length: 14 }, (_, i) => ({ dia: `2026-01-${String(i + 1).padStart(2, "0")}`, visitas: i })) };

async function montarFicha(email: string | null = ficha.email) {
  vi.mocked(get).mockImplementation(async (url: string) => {
    if (url.includes("/dias?")) return dias as never;
    if (url.includes("/visitas/historial?")) return { total: 1, filas: [{ inicio: "2026-01-02T10:00:00Z", ultima_actividad: "2026-01-02T10:30:00Z" }] } as never;
    if (url.includes("/creditos?")) return { total: 1, filas: [{ id: 1, usuario_id: "uno", importe: "20", motivo: "regalo", creado: "2026-01-03T00:00:00Z", creado_por: null }] } as never;
    if (url.includes("/panel-usuarios/")) return { ...ficha, email } as never;
    if (url === "/liga/admin/usuarios/uno") return usuario as never;
    throw new Error(`URL inesperada: ${url}`);
  });
  return montar(<FichaUsuario id="uno" />);
}

describe("ficha de usuario", () => {
  it("reúne perfil, actividad, IA, liga, créditos y movimientos", async () => {
    const div = await montarFicha();
    const texto = div.textContent!;
    expect(div.querySelector("h2")?.textContent).toBe("Cuenta Uno");
    expect(texto).toContain("cuenta@example.com");
    expect(texto).toContain("30 · desde el");
    expect(texto).toContain("versión 6 · aceptada el");
    expect(texto).toContain("1 h 1 min");
    expect(texto).toContain("2 · 1 jugando");
    expect(texto).toContain("propias 0 · como miembro 1");
    expect(texto).toContain("Movimientos de créditos");
    expect(texto).toContain("Regalo");
    expect(div.querySelector("svg[role='img'] rect")).not.toBeNull();
    expect(div.querySelector("a.pp-volver")?.getAttribute("href")).toBe("/admin/liga/usuarios");
  });

  it("indica que no hay correo", async () => {
    expect((await montarFicha(null)).textContent).toContain("sin correo");
  });

  it("confirma la suspensión antes de enviarla", async () => {
    confirmar.mockResolvedValue(true);
    const div = await montarFicha();
    await act(async () => boton(div, personas.pnl_personas_suspender).click());
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: personas.pnl_personas_confirma_suspender, peligro: true }));
    expect(post).toHaveBeenCalledWith("/liga/admin/usuarios/uno/suspender", { suspendido: true });
  });

  it("cancelar la confirmación conserva la cuenta", async () => {
    confirmar.mockResolvedValue(false);
    const div = await montarFicha();
    await act(async () => boton(div, personas.pnl_personas_suspender).click());
    expect(post).not.toHaveBeenCalled();
  });

  it("da créditos con motivo desde la hoja, tras confirmar", async () => {
    confirmar.mockResolvedValue(true);
    const div = await montarFicha();
    await act(async () => boton(div, personas.pnl_personas_dar_creditos).click());
    const campo = div.querySelector<HTMLInputElement>("dialog input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "20,5");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => boton(div.querySelector("dialog")!, "Ajuste").click());
    await act(async () => boton(div.querySelector("dialog")!, personas.pnl_personas_creditos_dar).click());
    expect(post).toHaveBeenCalledWith("/liga/admin/creditos", expect.objectContaining({ usuario_id: "uno", importe: "20.5", motivo: "ajuste" }));
  });

  it("da Pro sin fecha de fin y cambia roles con su confirmación", async () => {
    confirmar.mockResolvedValue(true);
    const div = await montarFicha();
    await act(async () => boton(div, personas.pnl_personas_dar_pro).click());
    await act(async () => boton(div.querySelector("dialog")!, personas.pnl_personas_dar_pro).click());
    expect(post).toHaveBeenCalledWith("/liga/admin/usuarios/uno/plan", { hasta: null });
    await act(async () => boton(div, personas.pnl_personas_cambiar_roles).click());
    act(() => div.querySelector<HTMLButtonElement>("dialog [role='checkbox'][aria-checked='false']")!.click());
    await act(async () => boton(div.querySelector("dialog")!, personas.pnl_personas_guardar).click());
    expect(post).toHaveBeenCalledWith("/liga/admin/usuarios/uno/rol", { rol: "moderador", conceder: true });
  });
});

describe("validaciones de las hojas", () => {
  it("el importe admite coma y rechaza cero y texto", () => {
    expect(importeValido("20,5")).toBe("20.5");
    expect(importeValido("0")).toBeNull();
    expect(importeValido("abc")).toBeNull();
    expect(importeValido("1.234")).toBeNull();
  });
  it("la fecha del plazo debe existir y ser futura", () => {
    const hoy = new Date(2026, 10, 16);
    expect(fechaEnDias(30, hoy)).toBe("2026-12-16");
    expect(fechaFuturaValida("2026-12-31", hoy)).toBe(true);
    expect(fechaFuturaValida("2026-11-16", hoy)).toBe(false);
    expect(fechaFuturaValida("2026-02-31", hoy)).toBe(false);
    expect(fechaFuturaValida("31/12/2026", hoy)).toBe(false);
  });
});
