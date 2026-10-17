// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/es/league.json";
import { TarjetaPremio } from "./TarjetaPremio";
import { confirmarMayorEdad } from "@/lib/liga/api";

vi.mock("@/lib/liga/api", () => ({ confirmarMayorEdad: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
function render(visible = true, sesion = false) {
  act(() => root.render(<NextIntlClientProvider locale="es" messages={messages}>
    <TarjetaPremio premio={{ visible }} sesion={sesion} confirmada={false} />
  </NextIntlClientProvider>));
}
it("no muestra una tarjeta oculta", () => { render(false); expect(container.innerHTML).toBe(""); });
it("enlaza las bases", () => {
  render(); expect(container.querySelector("a")?.getAttribute("href")).toBe("/legal/bases-premio");
});
it("no ofrece la casilla sin sesión", () => { render(); expect(container.querySelector("input")).toBeNull(); });
it("guarda la confirmación", async () => {
  vi.mocked(confirmarMayorEdad).mockResolvedValue({ confirmada: true });
  render(true, true);
  await act(async () => container.querySelector("input")!.click());
  expect(confirmarMayorEdad).toHaveBeenCalledWith(true);
  expect(container.querySelector("input")!.checked).toBe(true);
});
