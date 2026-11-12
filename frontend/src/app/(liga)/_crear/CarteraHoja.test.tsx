// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, expect, it, vi } from "vitest";
import { CarteraHoja } from "./CarteraHoja";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };
});
it("es una hoja con su título, se cierra con Listo y no reacciona a los toques de dentro", () => {
  const div = document.createElement("div"), root = createRoot(div), cerrar = vi.fn();
  try {
    act(() => root.render(<CarteraHoja abierta onCerrar={cerrar}><p>Contenido</p></CarteraHoja>));
    const hoja = div.querySelector("dialog.hoja-liga") as HTMLDialogElement;
    expect(hoja.open).toBe(true);
    expect(hoja.querySelector("h2")?.textContent).toBe("builder_live_title");
    act(() => (div.querySelector("p") as HTMLElement).click());
    expect(cerrar).not.toHaveBeenCalled();
    act(() => (hoja.querySelector(".hoja-liga-acc.der") as HTMLButtonElement).click());
    expect(cerrar).toHaveBeenCalledTimes(1);
    act(() => root.render(<CarteraHoja abierta={false} onCerrar={cerrar}><p>Contenido</p></CarteraHoja>));
    expect(hoja.open).toBe(false);
  } finally { act(() => root.unmount()); }
});
