// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HojaUnirse } from "./Hojas";

const unirseLiga = vi.fn();
vi.mock("@/lib/liga/api", () => ({ unirseLiga: (...a: unknown[]) => unirseLiga(...a), crearLiga: vi.fn() }));
vi.mock("@/lib/liga/cache", () => ({ invalidar: vi.fn() }));
vi.mock("next/link", async () => {
  const react = await import("react");
  return { default: ({ children, href }: { children: React.ReactNode; href: string }) => react.createElement("a", { href }, children) };
});

vi.mock("next-intl", async () => {
  const [common, privadas] = await Promise.all([
    import("../../../../messages/es/common.json"), import("../../../../messages/es/privateLeagues.json"),
  ]);
  const catalogo = { ...common.default, ...privadas.default } as Record<string, string>;
  const t = (key: string) => catalogo[key] ?? key;
  return { useTranslations: () => t, useLocale: () => "es" };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom no implementa <dialog>: lo sustituimos por un atributo para que la hoja se abra.
  const proto = HTMLElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLElement) { this.setAttribute("open", ""); };
  proto.close ??= function (this: HTMLElement) { this.removeAttribute("open"); };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  unirseLiga.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const entrada = () => container.querySelector("input") as HTMLInputElement;
const boton = (texto: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement;

function escribir(valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(entrada(), valor);
  entrada().dispatchEvent(new Event("input", { bubbles: true }));
}

function pintar() {
  act(() => {
    root.render(<HojaUnirse abierta onCerrar={() => {}} onUnida={() => {}} />);
  });
}

describe("HojaUnirse", () => {
  it("deja el botón apagado hasta tener 8 caracteres válidos y los escribe en mayúsculas", () => {
    pintar();
    expect(boton("Unirme").disabled).toBe(true);
    act(() => escribir("k7m2-qx p4"));
    expect(entrada().value).toBe("K7M2QXP4");
    expect(boton("Unirme").disabled).toBe(false);
  });

  it("no admite las letras que el código no usa (I, O, 0, 1)", () => {
    pintar();
    act(() => escribir("IO01"));
    expect(entrada().value).toBe("");
  });

  it("muestra el error que devuelve el servidor y no sale de la hoja", async () => {
    unirseLiga.mockResolvedValue("Ese código no existe.");
    pintar();
    act(() => escribir("ABCD2345"));
    await act(async () => { boton("Unirme").click(); });
    expect(container.textContent).toContain("Ese código no existe.");
    expect(entrada().value).toBe("ABCD2345");
  });
});
