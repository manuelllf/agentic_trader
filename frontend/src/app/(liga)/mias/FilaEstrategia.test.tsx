// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Estrategia } from "@/lib/liga/api";
import { FilaEstrategia, type AccionesFila, type Pildora } from "./FilaEstrategia";

vi.mock("next-intl", async () => {
  const [builder, strategies] = await Promise.all([
    import("../../../../messages/es/builder.json"), import("../../../../messages/es/strategies.json"),
  ]);
  const catalogo = { ...builder.default, ...strategies.default } as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a> }));
vi.mock("@/lib/liga/ficha", () => ({ precargarFicha: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: Estrategia = {
  id: "e1", nombre: "Dividendo creciente", escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68" },
  visibilidad: "privada", declara_posiciones: null, destacable: false, estado: "jugando", cada_dia_1: "revisar",
  oculta: false, receta_id: 1, opta_premio: false, creada: "2026-11-01", actualizada: "2026-11-01",
} as Estrategia;

let root: Root;
let div: HTMLDivElement;
beforeEach(() => { div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div); });
afterEach(() => { act(() => root.unmount()); div.remove(); });

function pintar(cambios: Partial<Estrategia> = {}, pildora: Pildora | null = null) {
  const acciones: AccionesFila = { alCiclar: vi.fn(), alApuntar: vi.fn(), alEditar: vi.fn(), alCadaMes: vi.fn(),
    alPremio: vi.fn(), alQuitar: vi.fn(), alBorrar: vi.fn() };
  act(() => root.render(<ul><FilaEstrategia estrategia={{ ...base, ...cambios }} sub="3.º de 48 · 15 pts" nuevo={false}
    pildora={pildora} ocupada={false} acciones={acciones} /></ul>));
  return acciones;
}
const abrirMenu = () => act(() => (div.querySelector(".mi-mas") as HTMLButtonElement).click());
const opciones = () => Array.from(div.querySelectorAll(".mi-menu button"), (b) => b.textContent);
const opcion = (texto: string) => Array.from(div.querySelectorAll<HTMLButtonElement>(".mi-menu button")).find((b) => b.textContent === texto)!;

describe("FilaEstrategia", () => {
  it("abre la ficha al tocar la fila y la píldora cambia el dato de la lista", () => {
    const acciones = pintar({}, { texto: "+2,5", clase: "bien", etiqueta: "+2,5, cambiar dato" });
    expect(div.querySelector("a.mi-abre")?.getAttribute("href")).toBe("/ficha/e1");
    const pildora = div.querySelector("button.lv-pildora") as HTMLButtonElement;
    expect(pildora.className).toBe("lv-pildora bien");
    act(() => pildora.click());
    expect(acciones.alCiclar).toHaveBeenCalledOnce();
  });

  it("una que juega: editar, cada mes y el premio, sin acciones de peligro", () => {
    pintar({ estado: "jugando", cada_dia_1: "mantener" });
    abrirMenu();
    expect(opciones()).toEqual(["Editar", "Revisarla", "Mantenerla", "Opta al premio"]);
    expect(opcion("Mantenerla").getAttribute("aria-checked")).toBe("true");
    expect(div.querySelector(".mi-menu .peligro")).toBeNull();
  });

  it("elegir el premio llama a la acción, cierra el menú y la que ya opta no se puede volver a elegir", () => {
    const acciones = pintar({ estado: "apuntada" });
    abrirMenu();
    act(() => opcion("Opta al premio").click());
    expect(acciones.alPremio).toHaveBeenCalledOnce();
    expect(div.querySelector(".mi-menu")).toBeNull();

    pintar({ estado: "apuntada", opta_premio: true });
    abrirMenu();
    expect(opcion("Opta al premio").disabled).toBe(true);
    expect(opcion("Opta al premio").getAttribute("aria-checked")).toBe("true");
  });

  it("una apuntada se puede quitar de la jornada, en rojo", () => {
    const acciones = pintar({ estado: "apuntada" });
    abrirMenu();
    const quitar = opcion("Quitar de la jornada");
    expect(quitar.className).toBe("peligro");
    act(() => quitar.click());
    expect(acciones.alQuitar).toHaveBeenCalledOnce();
  });

  it("un borrador lleva Apuntar a la vista y en el menú solo editar y borrar", () => {
    const acciones = pintar({ estado: "borrador", opta_premio: false });
    const apuntar = div.querySelector("button.mi-apuntar") as HTMLButtonElement;
    expect(apuntar.textContent).toBe("Apuntar");
    act(() => apuntar.click());
    expect(acciones.alApuntar).toHaveBeenCalledOnce();
    abrirMenu();
    expect(opciones()).toEqual(["Editar", "Borrar"]);
  });

  it("tocar fuera o Escape cierra el menú", () => {
    pintar();
    abrirMenu();
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(div.querySelector(".mi-menu")).toBeNull();
    abrirMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(div.querySelector(".mi-menu")).toBeNull();
  });
});
