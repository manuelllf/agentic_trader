// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrdenLista } from "./OrdenLista";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let contenedor: HTMLDivElement;

afterEach(() => act(() => raiz.unmount()));

function montar(valor = "a", onChange = vi.fn()) {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz.render(<OrdenLista etiquetaGrupo="Ordenar" valor={valor}
    opciones={[{ valor: "a", etiqueta: "A" }, { valor: "b", etiqueta: "B" }]} onChange={onChange} />));
  return { onChange };
}

describe("OrdenLista", () => {
  it("marca la opción elegida y etiqueta el grupo", () => {
    montar();
    expect(contenedor.querySelector('[aria-label="Ordenar"]')).not.toBeNull();
    expect(contenedor.querySelectorAll("button")[0].getAttribute("aria-pressed")).toBe("true");
    expect(contenedor.querySelectorAll("button")[1].getAttribute("aria-pressed")).toBe("false");
  });
  it("notifica la opción pulsada, también si ya está activa", () => {
    const { onChange } = montar();
    act(() => contenedor.querySelectorAll("button")[1].click());
    act(() => contenedor.querySelectorAll("button")[0].click());
    expect(onChange).toHaveBeenNthCalledWith(1, "b");
    expect(onChange).toHaveBeenNthCalledWith(2, "a");
  });
});
