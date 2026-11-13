// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  const legal = (await import("../../../../messages/es/legal.json")).default as Record<string, string>;
  const es = { ...legal, ...cuenta };
  return { ...await importOriginal<object>(), useTranslations: () => (key: string) => es[key] ?? key };
});
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
import { LegalCuenta } from "./LegalCuenta";
import { desmontarCuenta, montarEnCuenta } from "./pruebas";

afterEach(desmontarCuenta);

describe("LegalCuenta", () => {
  it("lista los cinco enlaces legales con su destino", () => {
    const { el } = montarEnCuenta(createElement(LegalCuenta));
    const enlaces = [...el.querySelectorAll("a")].map(a => [a.textContent, a.getAttribute("href")]);
    expect(enlaces).toEqual([
      ["Aviso legal", "/legal/aviso"], ["Privacidad", "/legal/privacidad"], ["Términos", "/legal/terminos"],
      ["Cookies", "/legal/cookies"], ["Bases del premio anual", "/legal/bases-premio"],
    ]);
    expect(el.querySelector("h1")?.textContent).toBe("Legal");
  });
});
