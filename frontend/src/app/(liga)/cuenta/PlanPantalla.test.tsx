// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";

const mocks = vi.hoisted(() => ({ visibles: true, yo: { alias: "ejemplo" } as Partial<Yo> | null }));
vi.mock("@/lib/liga/planes", () => ({ get PLANES_VISIBLES() { return mocks.visibles; } }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: mocks.yo }) }));
vi.mock("./PlanCuenta", () => ({ PlanCuenta: ({ yo }: { yo: Yo }) => createElement("div", { id: "plan" }, yo.alias) }));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { ...await importOriginal<object>(), useTranslations: () => (key: string) => cuenta[key] ?? key };
});
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
import { PlanPantalla } from "./PlanPantalla";
import { desmontarCuenta, montarEnCuenta } from "./pruebas";

afterEach(() => { desmontarCuenta(); mocks.visibles = true; });

describe("PlanPantalla", () => {
  it("pinta la barra y PlanCuenta con la sesión", () => {
    const { el } = montarEnCuenta(createElement(PlanPantalla));
    expect(el.querySelector("h1")?.textContent).toBe("Acceso");
    expect(el.querySelector("#plan")?.textContent).toBe("ejemplo");
  });
  it("no pinta nada con los planes ocultos", () => {
    mocks.visibles = false;
    const { el } = montarEnCuenta(createElement(PlanPantalla));
    expect(el.innerHTML).toBe("");
  });
});
