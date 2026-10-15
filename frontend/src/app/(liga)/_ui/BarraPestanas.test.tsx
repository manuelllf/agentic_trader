// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import comunes from "../../../../messages/es/common.json";
import cuenta from "../../../../messages/es/account.json";
import { BarraPestanas } from "./BarraPestanas";

const mensajes = { ...comunes, ...cuenta };

vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("@/lib/liga/cache", () => ({ precargar: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  sesion.estado = "fuera";
  sesion.yo = { admin: false, aal2: false };
  sesion.cerrarSesion.mockClear();
  localStorage.clear();
  delete document.documentElement.dataset.barra;
  vi.restoreAllMocks();
});

const navegacion = vi.hoisted(() => ({ ruta: "/cuenta", prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacion.ruta,
  useRouter: () => ({ prefetch: navegacion.prefetch }),
}));
const sesion = vi.hoisted(() => ({
  estado: "fuera", yo: { admin: false, aal2: false }, cerrarSesion: vi.fn(async () => {}),
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => sesion }));
vi.mock("next/link", async (original) => ({
  ...await original<typeof import("next/link")>(),
  useLinkStatus: () => ({ pending: false }),
}));

const pintar = () => renderToStaticMarkup(
  <NextIntlClientProvider locale="es" messages={mensajes}><BarraPestanas /></NextIntlClientProvider>,
);

describe("BarraPestanas", () => {
  it("sin sesi?n muestra Entrar y no muestra tres puntos", () => {
    const html = pintar();
    expect(html).toContain('href="/entrar"');
    expect(html).toContain(mensajes.account_entrar);
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain(mensajes.account_salir);
  });
  it.each([false, true])("con sesi?n muestra Salir y Panel solo si es admin (%s)", (admin) => {
    sesion.estado = "dentro";
    sesion.yo.admin = admin;
    const html = pintar();
    expect(html).toContain(mensajes.account_salir);
    expect(html).not.toContain('href="/entrar"');
    expect(html.includes(mensajes.account_panel_control)).toBe(admin);
    expect(html).not.toContain('aria-haspopup="menu"');
  });
  it.each([false, true])("respeta la verificaci?n del admin (aal2: %s)", (aal2) => {
    sesion.estado = "dentro";
    sesion.yo = { admin: true, aal2 };
    expect(pintar()).toContain(`href="${aal2 ? "/admin" : "/cuenta/verificacion?next=/admin"}"`);
  });
  it.each(["/cuenta", "/cuenta/seguridad"])("muestra Cuenta y la marca activa en %s", (ruta) => {
    navegacion.ruta = ruta;
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={mensajes}>
        <BarraPestanas />
      </NextIntlClientProvider>,
    );
    expect(html).toContain(`aria-label="${mensajes.common_barra_contraer}"`);
    const contenedor = document.createElement("div");
    contenedor.innerHTML = html;
    const enlaces = Array.from(contenedor.querySelectorAll("nav > a"), enlace => enlace.outerHTML);
    expect(enlaces).toHaveLength(5);
    const cuenta = enlaces.find((enlace) => enlace.includes('href="/cuenta"'));
    expect(cuenta).toContain("Cuenta");
    expect(cuenta).toContain('class="solo-escritorio"');
    expect(cuenta).toContain('aria-current="page"');
    expect(enlaces.filter((enlace) => enlace.includes('aria-current="page"'))).toHaveLength(1);
    expect(enlaces.filter((enlace) => !enlace.includes('class="solo-escritorio"'))).toHaveLength(4);
  });
  it("recupera la barra contraída y conserva sus etiquetas al alternar", () => {
    sesion.estado = "dentro";
    sesion.yo.admin = true;
    localStorage.setItem("liga-barra", "contraida");
    const contenedor = document.createElement("div");
    document.body.append(contenedor);
    const raiz = createRoot(contenedor);
    try {
      act(() => raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}>
        <BarraPestanas />
      </NextIntlClientProvider>));
      expect(document.documentElement.dataset.barra).toBe("contraida");
      expect(contenedor.querySelectorAll("a span.etiqueta.sr-only-escritorio")).toHaveLength(5);
      expect(Array.from(contenedor.querySelectorAll("a span.etiqueta"), e => e.textContent))
        .toEqual([mensajes.common_liga, mensajes.common_privadas, mensajes.common_crear, mensajes.common_mias, mensajes.common_cuenta]);
      expect(contenedor.querySelector(".barra-accion span")?.className).toBe("sr-only-escritorio");
      const boton = contenedor.querySelector<HTMLButtonElement>(".barra-alternar")!;
      expect(boton.getAttribute("aria-label")).toBe(mensajes.common_barra_expandir);
      expect(contenedor.querySelector(".barra-marca img")?.getAttribute("src")).toContain("/icon-192.png");
      expect(contenedor.querySelectorAll(".barra-accion span.sr-only-escritorio")).toHaveLength(2);
      act(() => contenedor.querySelector<HTMLButtonElement>("button.barra-accion")!.click());
      expect(sesion.cerrarSesion).toHaveBeenCalledTimes(1);
      act(() => boton.click());
      expect(contenedor.querySelector(".barra-accion span")?.className).toBe("");
      expect(document.documentElement.dataset.barra).toBeUndefined();
      expect(localStorage.getItem("liga-barra")).toBe("abierta");
      expect(boton.getAttribute("aria-label")).toBe(mensajes.common_barra_contraer);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
      act(() => boton.click());
      expect(document.documentElement.dataset.barra).toBe("contraida");
    } finally {
      act(() => raiz.unmount());
      contenedor.remove();
    }
  });

});
