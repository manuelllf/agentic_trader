// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hoja } from "./Hoja";

let raiz: Root;
let contenedor: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const proto = HTMLElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLElement) { this.setAttribute("open", ""); };
  proto.close ??= function (this: HTMLElement) { this.removeAttribute("open"); };
  HTMLElement.prototype.setPointerCapture ??= () => {};
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
});

afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

function pintar(onCerrar: () => void) {
  act(() => {
    raiz.render(<Hoja abierta titulo="Miembros" cancelar="Cancelar" accion="Listo" onCerrar={onCerrar}>
      <p>contenido</p>
    </Hoja>);
  });
}

function arrastrar(elemento: Element, desde: number, hasta: number) {
  elemento.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: desde, pointerId: 1 }));
  elemento.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: hasta, pointerId: 1 }));
  elemento.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientY: hasta, pointerId: 1 }));
}

describe("Hoja: arrastrar hacia abajo para cerrar", () => {
  it("cierra al bajar más del umbral desde el título", () => {
    const onCerrar = vi.fn();
    pintar(onCerrar);
    arrastrar(contenedor.querySelector(".hoja-liga-nav")!, 100, 260);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("cierra al bajar más del umbral desde el asa", () => {
    const onCerrar = vi.fn();
    pintar(onCerrar);
    arrastrar(contenedor.querySelector(".hoja-liga-agarre")!, 100, 260);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("no cierra si se baja poco y vuelve a su sitio", () => {
    const onCerrar = vi.fn();
    pintar(onCerrar);
    const cuerpo = contenedor.querySelector<HTMLElement>(".hoja-liga-cuerpo")!;
    arrastrar(contenedor.querySelector(".hoja-liga-nav")!, 100, 140);
    expect(onCerrar).not.toHaveBeenCalled();
    expect(cuerpo.style.transform).toBe("");
  });

  it("un toque en Listo sigue cerrando sin arrastrar", () => {
    const onCerrar = vi.fn();
    pintar(onCerrar);
    const listo = contenedor.querySelector<HTMLButtonElement>(".hoja-liga-acc.der")!;
    act(() => listo.click());
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
