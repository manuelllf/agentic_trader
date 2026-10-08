// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/auth.json";
import { CampoCodigo } from "./CampoCodigo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let contenedor: HTMLDivElement;

afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

function montar(inicial = "") {
  const cambio = vi.fn();
  function Padre() {
    const [value, setValue] = useState(inicial);
    return <CampoCodigo value={value} onChange={valor => { cambio(valor); setValue(valor); }} />;
  }
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}>
    <Padre />
  </NextIntlClientProvider>));
  const casillas = Array.from(contenedor.querySelectorAll("input"));
  return { casillas, cambio };
}

function escribir(casilla: HTMLInputElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(casilla, texto);
    casilla.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pegar(casilla: HTMLInputElement, texto: string) {
  const evento = new Event("paste", { bubbles: true, cancelable: true });
  const getData = vi.fn().mockReturnValue(texto);
  Object.defineProperty(evento, "clipboardData", { value: { getData } });
  act(() => casilla.dispatchEvent(evento));
  expect(getData).toHaveBeenCalledWith("text");
  expect(evento.defaultPrevented).toBe(true);
}

function tecla(casilla: HTMLInputElement, key: string) {
  act(() => casilla.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

describe("CampoCodigo", () => {
  it.each(["482913", "Tu código: 482 913", " 482\n913 77"])("reparte lo pegado en la tercera casilla: %s", texto => {
    const { casillas, cambio } = montar();
    pegar(casillas[2], texto);
    expect(casillas.map(c => c.value).join("")).toBe("482913");
    expect(cambio).toHaveBeenLastCalledWith("482913");
  });
  it("avanza el foco al escribir cada dígito sin enviar", () => {
    const { casillas, cambio } = montar();
    for (const [i, digito] of Array.from("482913").entries()) {
      act(() => casillas[i].focus());
      escribir(casillas[i], digito);
      expect(document.activeElement).toBe(casillas[Math.min(i + 1, 5)]);
    }
    expect(cambio).toHaveBeenCalledTimes(6);
    expect(casillas.map(c => c.value).join("")).toBe("482913");
  });
  it("Backspace en una casilla vacía retrocede y borra", () => {
    const { casillas, cambio } = montar("48");
    act(() => casillas[2].focus());
    tecla(casillas[2], "Backspace");
    expect(document.activeElement).toBe(casillas[1]);
    expect(cambio).toHaveBeenLastCalledWith("4");
    expect(casillas[1].value).toBe("");
  });
  it("reparte el autorrelleno desde el onChange de la primera", () => {
    const { casillas } = montar();
    expect(casillas[0].autocomplete).toBe("one-time-code");
    expect(casillas[0].maxLength).toBe(6);
    expect(casillas[1].maxLength).toBe(1);
    escribir(casillas[0], "482913");
    expect(casillas.map(c => c.value).join("")).toBe("482913");
  });
  it("ignora los no dígitos y filtra texto mixto", () => {
    const { casillas, cambio } = montar();
    escribir(casillas[0], "abc");
    pegar(casillas[2], "abc");
    expect(cambio).not.toHaveBeenCalled();
    escribir(casillas[0], "a4b8c2d9e1f3");
    expect(casillas.map(c => c.value).join("")).toBe("482913");
  });
  it("las flechas mueven el foco y enfocar selecciona el contenido", () => {
    const { casillas } = montar("482913");
    act(() => casillas[2].focus());
    expect(casillas[2].selectionStart).toBe(0);
    expect(casillas[2].selectionEnd).toBe(1);
    tecla(casillas[2], "ArrowLeft");
    expect(document.activeElement).toBe(casillas[1]);
    tecla(casillas[1], "ArrowRight");
    expect(document.activeElement).toBe(casillas[2]);
    expect(casillas[2].getAttribute("aria-label")).toBe("Cifra 3 de 6");
  });
});
