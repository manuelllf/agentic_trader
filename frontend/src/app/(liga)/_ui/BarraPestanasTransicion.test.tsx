// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { indiceDePestana, navegarConTransicion, terminarTransicion } from "./BarraPestanas";

vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("@/lib/liga/cache", () => ({ precargar: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/liga",
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("../_sesion/SesionContext", () => ({
  useSesion: () => ({ estado: "fuera", yo: null, cerrarSesion: vi.fn() }),
}));

describe("indiceDePestana", () => {
  it.each([
    ["liga", 0], ["privadas", 1], ["crear", 2], ["mias", 3],
  ])("la pastilla de %s va en la posición %i", (clave, posicion) => {
    expect(indiceDePestana(clave)).toBe(posicion);
  });

  it("Cuenta vive en el menú de móvil: sin pestaña visible no hay pastilla", () => {
    expect(indiceDePestana("cuenta")).toBeNull();
    expect(indiceDePestana(null)).toBeNull();
  });
});

describe("navegarConTransicion", () => {
  it("sin transición de vista en el navegador, cambia de ruta sin animar", () => {
    const push = vi.fn();
    navegarConTransicion("/privadas", { push }, {} as Document);
    expect(push).toHaveBeenCalledWith("/privadas");
  });

  it("con transición de vista, la ruta cambia dentro de ella y la termina la barra nueva", async () => {
    const push = vi.fn();
    let cambio: Promise<void> | undefined;
    const doc = {
      startViewTransition: vi.fn((callback: () => Promise<void>) => {
        cambio = callback();
        return {};
      }),
    } as unknown as Document;

    navegarConTransicion("/crear", { push }, doc);

    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/crear");
    terminarTransicion();
    await expect(cambio).resolves.toBeUndefined();
  });

  it("terminar sin transición pendiente no hace nada", () => {
    expect(() => terminarTransicion()).not.toThrow();
  });
});
