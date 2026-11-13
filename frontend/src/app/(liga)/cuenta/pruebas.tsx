// Ayuda de pruebas de Cuenta: monta una pantalla dentro de ProveedorNavCuenta con una navegación falsa.
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { ProveedorNavCuenta, type NavCuenta } from "./marco";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function navFalsa(cambios: Partial<NavCuenta> = {}): NavCuenta {
  return { modo: "pagina", hondo: true, animacion: "", ir: vi.fn(), volver: vi.fn(), cerrar: vi.fn(), avisar: vi.fn(),
    marcarCambios: vi.fn(), ...cambios };
}

let raiz: Root | undefined;
let anfitrion: HTMLDivElement | undefined;

export function montarEnCuenta(ui: ReactElement, nav: NavCuenta = navFalsa()): { el: HTMLDivElement; nav: NavCuenta } {
  anfitrion = document.createElement("div");
  document.body.append(anfitrion);
  raiz = createRoot(anfitrion);
  act(() => raiz!.render(createElement(ProveedorNavCuenta, { value: nav }, ui)));
  return { el: anfitrion, nav };
}

export function desmontarCuenta(): void {
  if (raiz) act(() => raiz!.unmount());
  anfitrion?.remove();
  raiz = undefined;
  anfitrion = undefined;
}
