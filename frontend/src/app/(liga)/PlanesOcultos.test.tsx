import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ visible: false, sesion: vi.fn() }));
vi.mock("@/lib/liga/planes", () => ({ get PLANES_VISIBLES() { return config.visible; } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(), getTranslations: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./_sesion/SesionContext", () => ({ useSesionRequerida: config.sesion }));
vi.mock("./planes/PlanesPublicos", () => ({ PlanesPublicos: () => <div>Opciones públicas</div> }));
vi.mock("./cuenta/PlanCuenta", () => ({ PlanCuenta: () => <div>Opciones de cuenta</div> }));
vi.mock("./cuenta/MarcoCuenta", () => ({ MarcoCuenta: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import Planes, { generateMetadata } from "./planes/page";
import Plan from "./cuenta/plan/page";

beforeEach(() => {
  config.visible = false;
  config.sesion.mockReset().mockReturnValue({ yo: { plan: "gratis" } });
});

it("las páginas ocultas y sus metadatos responden como una ruta inexistente", async () => {
  expect(() => renderToStaticMarkup(<Planes />)).toThrow(";404");
  expect(() => renderToStaticMarkup(<Plan />)).toThrow(";404");
  expect(config.sesion).toHaveBeenCalledWith("/cuenta/plan");
  await expect(generateMetadata()).rejects.toThrow(";404");
});

it("una sola flag vuelve a habilitar ambas páginas", () => {
  config.visible = true;
  expect(renderToStaticMarkup(<Planes />)).toContain("Opciones públicas");
  expect(renderToStaticMarkup(<Plan />)).toContain("Opciones de cuenta");
});
