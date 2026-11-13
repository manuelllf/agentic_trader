// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardarVolver } from "@/lib/liga/volver";
import { CabeceraFicha } from "./CabeceraFicha";

const atrasMock = vi.fn();
const empujarMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: atrasMock, push: empujarMock }) }));
vi.mock("next-intl", async () => {
  const estrategias = await import("../../../../../messages/es/strategies.json");
  const catalogo = estrategias.default as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let div: HTMLDivElement;
beforeEach(() => {
  div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div);
  atrasMock.mockClear(); empujarMock.mockClear(); window.sessionStorage.clear();
});
afterEach(() => { act(() => root.unmount()); div.remove(); });

function pintar(props: Partial<React.ComponentProps<typeof CabeceraFicha>> = {}) {
  const onCopiar = vi.fn(), onReportar = vi.fn();
  act(() => root.render(<CabeceraFicha nombre="Dividendo" idEstrategia="e1" esDueno={false} puedeCopiar ocupado={false}
    onCopiar={onCopiar} onReportar={onReportar} {...props} />));
  return { onCopiar, onReportar };
}
const abrirMenu = () => act(() => (div.querySelector(".fi-mas") as HTMLButtonElement).click());
const opciones = () => Array.from(div.querySelectorAll(".fi-menu button"), (b) => b.textContent);

describe("CabeceraFicha", () => {
  it("el dueño ve Editar con el enlace a Crear y ningún menú", () => {
    pintar({ esDueno: true });
    const enlace = div.querySelector("a.fi-accion") as HTMLAnchorElement;
    expect(enlace.textContent).toBe("Editar");
    expect(enlace.getAttribute("href")).toBe("/crear/e1");
    expect(div.querySelector(".fi-mas")).toBeNull();
  });

  it("una ajena publicada enseña Copiar y ajustar y Reportar, y llaman a sus funciones", () => {
    const { onCopiar, onReportar } = pintar();
    expect(div.querySelector(".fi-menu")).toBeNull();
    abrirMenu();
    expect(opciones()).toEqual(["Copiar y ajustar", "Reportar"]);
    act(() => (div.querySelectorAll(".fi-menu button")[0] as HTMLButtonElement).click());
    expect(onCopiar).toHaveBeenCalledTimes(1);
    expect(div.querySelector(".fi-menu")).toBeNull();
    abrirMenu();
    act(() => (div.querySelectorAll(".fi-menu button")[1] as HTMLButtonElement).click());
    expect(onReportar).toHaveBeenCalledTimes(1);
  });

  it("sin puedeCopiar solo queda Reportar", () => {
    pintar({ puedeCopiar: false });
    abrirMenu();
    expect(opciones()).toEqual(["Reportar"]);
  });

  it("ocupado deshabilita las opciones", () => {
    pintar({ ocupado: true });
    abrirMenu();
    expect(Array.from(div.querySelectorAll(".fi-menu button"), (b) => (b as HTMLButtonElement).disabled)).toEqual([true, true]);
  });

  it("se cierra con Escape y al tocar fuera", () => {
    pintar();
    abrirMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(div.querySelector(".fi-menu")).toBeNull();
    abrirMenu();
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(div.querySelector(".fi-menu")).toBeNull();
  });

  it("el chevron dice Liga por defecto y lo guardado si lo hay", () => {
    pintar();
    expect(div.querySelector(".fi-atras span")?.textContent).toBe("Liga");
    expect(div.querySelector(".fi-atras")?.getAttribute("aria-label")).toBe("Volver a Liga");
    act(() => root.unmount());
    root = createRoot(div);
    guardarVolver("Mías", "/mias", "e1");
    pintar();
    expect(div.querySelector(".fi-atras span")?.textContent).toBe("Mías");
  });

  it("atrás vuelve en el historial, o va a la ruta guardada si no hay historial", () => {
    guardarVolver("Mías", "/mias", "e1");
    pintar();
    const boton = div.querySelector(".fi-atras") as HTMLButtonElement;
    vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    act(() => boton.click());
    expect(atrasMock).toHaveBeenCalledTimes(1);
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    act(() => boton.click());
    expect(empujarMock).toHaveBeenCalledWith("/mias");
  });
});
