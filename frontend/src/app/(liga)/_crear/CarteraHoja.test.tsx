// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CarteraHoja } from "./CarteraHoja";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("cierra con Escape y el velo, conserva el foco y aísla los toques interiores", () => {
  const div = document.createElement("div"), root = createRoot(div), cerrar = vi.fn();
  const origen = document.createElement("button");
  document.body.append(origen, div); origen.focus();
  try {
    act(() => root.render(<CarteraHoja abierta onCerrar={cerrar}><p>Contenido</p></CarteraHoja>));
    expect(div.querySelector('[role="dialog"]')?.classList.contains("sheet")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    act(() => (div.querySelector("p") as HTMLElement).click());
    expect(cerrar).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(cerrar).toHaveBeenCalledTimes(1);
    act(() => (div.querySelector(".cartera-hoja-velo") as HTMLElement).click());
    expect(cerrar).toHaveBeenCalledTimes(2);
    act(() => root.render(<CarteraHoja abierta={false} onCerrar={cerrar}><p>Contenido</p></CarteraHoja>));
    expect(div.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(origen);
    expect(document.body.style.overflow).toBe("");
  } finally { act(() => root.unmount()); div.remove(); origen.remove(); }
});
