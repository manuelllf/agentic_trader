// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ ruta: "/liga", confirmar: vi.fn(), yo: { alias: "manuel" } as unknown }));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { ...await importOriginal<object>(), useTranslations: () => (k: string, v?: Record<string, string>) => (cuenta[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => v?.[n] ?? "") };
});
vi.mock("next/navigation", () => ({ usePathname: () => estado.ruta }));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar: estado.confirmar, dialogo: null }) }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: estado.yo, yoFallo: false, refrescarYo: vi.fn() }) }));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
vi.mock("./pantallas", async () => {
  const { BarraCuenta, CuerpoCuenta, useNavCuenta, useCambiosSinGuardar } = await import("./marco");
  function Panel() {
    const { ir } = useNavCuenta();
    return createElement("div", null, createElement(BarraCuenta, { titulo: "Tu cuenta" }),
      createElement(CuerpoCuenta, null, createElement("button", { id: "ir", onClick: () => ir("nombre") }, "Nombre")));
  }
  function Nombre() {
    useCambiosSinGuardar(true);
    return createElement("div", null, createElement(BarraCuenta, { titulo: "Nombre" }), createElement(CuerpoCuenta, null, "campo"));
  }
  return { PANTALLAS: { inicio: Panel, nombre: Nombre, clave: Panel, verificacion: Panel, avisos: Nombre, legal: Panel, borrar: Panel, plan: Panel } };
});
import { ProveedorHojaCuenta, useHojaCuenta } from "./HojaCuenta";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let abrir: ReturnType<typeof useHojaCuenta> = null;
function Captura() { abrir = useHojaCuenta(); return null; }
let raiz: Root | undefined;
let el: HTMLDivElement;
function montar(hijos: ReactNode = createElement(Captura)) {
  el = document.createElement("div");
  document.body.append(el);
  raiz = createRoot(el);
  act(() => raiz!.render(createElement(ProveedorHojaCuenta, null, hijos)));
}
const pulsar = (n: Element | null) => act(() => { (n as HTMLElement).click(); });

beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  estado.ruta = "/liga";
  estado.confirmar.mockReset();
});
afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  el.remove();
  vi.useRealTimers();
});

describe("Hoja de Cuenta", () => {
  it("abre el panel con «Listo» y lo cierra", () => {
    montar();
    expect(el.querySelector("dialog")).toBeNull();
    act(() => abrir!.abrir());
    const d = el.querySelector("dialog.cu-hoja.lv-pagina")!;
    expect(d.querySelector("h2")?.textContent).toBe("Tu cuenta");
    pulsar(d.querySelector(".hoja-liga-acc"));
    act(() => { vi.advanceTimersByTime(300); });
    expect(el.querySelector("dialog")).toBeNull();
  });

  it("empuja dentro de la hoja con «‹ Cuenta» y vuelve", () => {
    montar();
    act(() => abrir!.abrir());
    pulsar(el.querySelector("#ir"));
    expect(el.querySelector("h2")?.textContent).toBe("Nombre");
    expect(el.querySelector(".cu.cu-entra")).not.toBeNull();
    const atras = el.querySelector(".cu-atras")!;
    expect(atras.textContent).toBe("Cuenta");
    expect(el.querySelector(".hoja-liga-acc")).toBeNull();
    pulsar(atras);
    expect(el.querySelector("h2")?.textContent).toBe("Tu cuenta");
    expect(el.querySelector(".cu.cu-vuelve")).not.toBeNull();
  });

  it("abre directamente en una pantalla, con el panel debajo", () => {
    montar();
    act(() => abrir!.abrir("avisos"));
    expect(el.querySelector("h2")?.textContent).toBe("Nombre");
    expect(el.querySelector(".cu-atras")).not.toBeNull();
  });

  it("con algo escrito pregunta antes de cerrar y respeta el «no»", async () => {
    montar();
    act(() => abrir!.abrir("nombre"));
    estado.confirmar.mockResolvedValue(false);
    await act(async () => { el.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(estado.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "¿Descartar los cambios?", peligro: true }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(el.querySelector("dialog")).not.toBeNull();
  });

  it("cambiar de ruta cierra la hoja", () => {
    montar();
    act(() => abrir!.abrir());
    estado.ruta = "/como-funciona";
    act(() => raiz!.render(createElement(ProveedorHojaCuenta, null, createElement(Captura))));
    expect(el.querySelector("dialog")).toBeNull();
  });
});
