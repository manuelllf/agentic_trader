import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/common.json";
import { BarraPestanas } from "./BarraPestanas";

const navegacion = vi.hoisted(() => ({ ruta: "/cuenta", prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacion.ruta,
  useRouter: () => ({ prefetch: navegacion.prefetch }),
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ estado: "fuera" }) }));
vi.mock("next/link", async (original) => ({
  ...await original<typeof import("next/link")>(),
  useLinkStatus: () => ({ pending: false }),
}));

describe("BarraPestanas", () => {
  it.each(["/cuenta", "/cuenta/seguridad"])("muestra Cuenta y la marca activa en %s", (ruta) => {
    navegacion.ruta = ruta;
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={mensajes}>
        <BarraPestanas />
      </NextIntlClientProvider>,
    );
    const enlaces = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(enlaces).toHaveLength(5);
    const cuenta = enlaces.find((enlace) => enlace.includes('href="/cuenta"'));
    expect(cuenta).toContain("Cuenta");
    expect(cuenta).toContain('class="solo-escritorio"');
    expect(cuenta).toContain('aria-current="page"');
    expect(enlaces.filter((enlace) => enlace.includes('aria-current="page"'))).toHaveLength(1);
    expect(enlaces.filter((enlace) => !enlace.includes('class="solo-escritorio"'))).toHaveLength(4);
  });
});
