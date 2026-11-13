// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";

const { cerrarSesion, selectLocale, idioma, planes, exportar, push } = vi.hoisted(() => ({
  cerrarSesion: vi.fn().mockResolvedValue(undefined), selectLocale: vi.fn(),
  idioma: { locale: "es", changing: false, failure: false },
  planes: { visibles: false }, exportar: vi.fn(), push: { estado: "apagado" },
}));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default;
  const comun = (await import("../../../../messages/es/common.json")).default;
  const planesEs = (await import("../../../../messages/es/planes.json")).default;
  const es: Record<string, string> = { ...cuenta, ...comun, ...planesEs };
  return { ...await importOriginal<object>(), useLocale: () => "es", useTranslations: () =>
    (key: string, values?: Record<string, string>) => es[key].replace(/\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? `{${name}}`) };
});
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("@/i18n/Provider", () => ({
  useLanguage: () => ({ ...idioma, selectLocale }),
}));
vi.mock("@/lib/liga/planes", () => ({ get PLANES_VISIBLES() { return planes.visibles; } }));
vi.mock("@/lib/liga/cuenta", async (importOriginal) => ({
  ...await importOriginal<object>(), exportarMisDatos: (...args: unknown[]) => exportar(...args),
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: vi.fn() }));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
vi.mock("./usePushDispositivo", () => ({ usePushDispositivo: () => push }));
import { useSesion } from "../_sesion/SesionContext";
import { PanelCuenta } from "./PanelCuenta";
import { desmontarCuenta, montarEnCuenta, navFalsa } from "./pruebas";

const gratis: Yo = {
  pendiente: false, alias: "ejemplo", plan: "gratis", puede_crear_liga: false,
  roles: ["usuario"], admin: false, aal2: false,
};
function montar(yo: Yo = gratis, nav = navFalsa()) {
  vi.mocked(useSesion).mockReturnValue({ yo, email: "manuel@gmail.com", refrescarYo: vi.fn(), cerrarSesion } as never);
  return montarEnCuenta(createElement(PanelCuenta), nav);
}
const boton = (el: HTMLElement, texto: string) =>
  [...el.querySelectorAll("button")].find(b => b.textContent?.includes(texto)) as HTMLButtonElement;
const clic = (b: Element) => act(() => { b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

beforeEach(() => {
  Object.assign(idioma, { locale: "es", changing: false, failure: false });
  Object.assign(push, { estado: "apagado" });
  planes.visibles = false;
  exportar.mockReset();
  selectLocale.mockReset();
  cerrarSesion.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(desmontarCuenta);

describe("PanelCuenta", () => {
  it("ordena las filas y sus textos", () => {
    const { el } = montar();
    expect(el.querySelector("h1")?.textContent).toBe("Tu cuenta");
    const grupos = [...el.querySelectorAll("ul.cu-grupo")].map(g =>
      [...g.querySelectorAll("li")].map(li => li.querySelector("button, a")!.textContent));
    expect(grupos).toEqual([
      ["Eejemplom•••••@gmail.com"],
      ["Verificación en dos pasos", "Contraseña"],
      ["AvisosDesactivados", "IdiomaEspañol"],
      ["Descargar mis datos", "Borrar mi cuenta"],
      ["Cómo funciona la liga", "Primeros pasos", "Legal"],
      ["Salir"],
    ]);
    expect([...el.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/como-funciona", "/aprender"]);
    expect(el.textContent).toContain("Tu nombre lo ve la liga; tu correo, nadie.");
    expect(el.textContent).toContain("La descarga es un archivo JSON");
    expect(el.textContent).not.toContain("manuel@gmail.com");
  });
  it("la fila de tú muestra alias, inicial y correo oculto, y va a nombre", () => {
    const { el, nav } = montar();
    const fila = el.querySelector<HTMLButtonElement>(".cu-yo")!;
    expect(fila.getAttribute("aria-label")).toBe("Nombre en la liga: ejemplo");
    expect(fila.querySelector(".cu-mono")?.textContent).toBe("E");
    expect(fila.querySelector("b")?.textContent).toBe("ejemplo");
    expect(fila.querySelector("small")?.textContent).toBe("m•••••@gmail.com");
    clic(fila);
    expect(nav.ir).toHaveBeenCalledWith("nombre");
  });
  it.each([false, true])("solo muestra Activada con aal2=%s", aal2 => {
    const { el } = montar({ ...gratis, aal2 });
    expect(boton(el, "Verificación").querySelector(".valor")?.textContent).toBe(aal2 ? "Activada" : "");
  });
  it.each([
    ["cargando", false, ""], ["apagado", false, "Desactivados"], ["apagado", true, "Correo"],
    ["activo", false, "Push"], ["activo", true, "Push y correo"],
  ])("resume los avisos con push %s y correo=%s", (estado, avisos_correo, valor) => {
    push.estado = estado;
    const { el } = montar({ ...gratis, avisos_correo });
    expect(boton(el, "Avisos").querySelector(".valor")?.textContent).toBe(valor);
  });
  it("las filas que bajan van a su pantalla", () => {
    const { el, nav } = montar();
    for (const [texto, a] of [["Verificación", "verificacion"], ["Contraseña", "clave"], ["Avisos", "avisos"],
      ["Borrar mi cuenta", "borrar"], ["Legal", "legal"]]) {
      clic(boton(el, texto));
      expect(nav.ir).toHaveBeenLastCalledWith(a);
    }
  });
  it("el menú de idioma abre, marca el actual y cambia a inglés", () => {
    const { el } = montar();
    const fila = boton(el, "Idioma");
    expect(fila.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector(".cu-menu")).toBeNull();
    clic(fila);
    expect(fila.getAttribute("aria-expanded")).toBe("true");
    const menu = el.querySelector(".cu-menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items.map(b => [b.lang, b.getAttribute("aria-checked"), b.textContent])).toEqual([
      ["es", "true", "Español"], ["en", "false", "English"],
    ]);
    clic(items[1]);
    expect(selectLocale).toHaveBeenCalledWith("en");
    expect(el.querySelector(".cu-menu")).toBeNull();
  });
  it("el menú se cierra con Escape y al tocar fuera", () => {
    const { el } = montar();
    clic(boton(el, "Idioma"));
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(el.querySelector(".cu-menu")).toBeNull();
    clic(boton(el, "Idioma"));
    act(() => { el.querySelector("h1")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(el.querySelector(".cu-menu")).toBeNull();
  });
  it("desactiva el idioma mientras cambia y avisa si falla", () => {
    idioma.changing = true;
    idioma.failure = true;
    const { el } = montar();
    expect(boton(el, "Idioma").disabled).toBe(true);
    const aviso = el.querySelector('[role="alert"]')!;
    expect(aviso.textContent).toBe("No se pudo guardar el idioma. Prueba otra vez.");
    expect(aviso.classList.contains("mal")).toBe(true);
  });
  it("descargar llama a exportarMisDatos y avisa al terminar", async () => {
    exportar.mockResolvedValue({ texto: "{}" });
    const { el, nav } = montar();
    await act(async () => { clic(boton(el, "Descargar mis datos")); });
    expect(exportar).toHaveBeenCalledTimes(1);
    expect(nav.avisar).toHaveBeenCalledWith(expect.stringContaining("mis-datos-vennett.json"));
  });
  it("muestra Preparando mientras descarga y el error si falla", async () => {
    let fin!: (v: { error: string }) => void;
    exportar.mockReturnValue(new Promise(r => { fin = r; }));
    const { el } = montar();
    clic(boton(el, "Descargar mis datos"));
    const fila = boton(el, "Descargar mis datos");
    expect(fila.disabled).toBe(true);
    expect(fila.querySelector(".valor")?.textContent).toBe("Preparando…");
    await act(async () => { fin({ error: "Sin conexión" }); });
    expect(boton(el, "Descargar mis datos").disabled).toBe(false);
    const aviso = el.querySelector('[role="alert"]')!;
    expect(aviso.textContent).toBe("Sin conexión");
    expect(aviso.classList.contains("mal")).toBe(true);
  });
  it("borrar es peligro", () => {
    const { el } = montar();
    expect(boton(el, "Borrar mi cuenta").classList.contains("peligro")).toBe(true);
    expect(el.querySelector(".cu-ico.peligro")).not.toBeNull();
  });
  it("salir cierra la hoja y la sesión", async () => {
    const { el, nav } = montar();
    await act(async () => { clic(boton(el, "Salir")); });
    expect(nav.cerrar).toHaveBeenCalledTimes(1);
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
  });
  it("la fila de plan solo aparece con PLANES_VISIBLES", () => {
    expect(boton(montar().el, "Gratis")).toBeUndefined();
    desmontarCuenta();
    planes.visibles = true;
    const { el } = montar();
    const fila = boton(el, "Gratis");
    expect(fila.querySelector(".valor")?.textContent).toBe("Opciones para crear ligas");
  });
});
