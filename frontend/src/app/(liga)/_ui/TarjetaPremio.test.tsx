// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/es/league.json";
import { TarjetaPremio } from "./TarjetaPremio";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
function queryByRole(rol: "checkbox") {
  return container.querySelector(`input[type="checkbox"], [role="${rol}"]`);
}
function render(visible = true) {
  act(() => root.render(<NextIntlClientProvider locale="es" messages={messages}>
    <TarjetaPremio premio={{ visible }} />
  </NextIntlClientProvider>));
}
it("muestra el título y enlaza las bases", () => {
  render();
  expect(container.querySelector("h2")?.textContent).toBe(messages.premio_titulo);
  const enlace = container.querySelector("a");
  expect(enlace?.textContent).toBe(messages.premio_bases);
  expect(enlace?.getAttribute("href")).toBe("/legal/bases-premio");
});
it("no muestra una tarjeta oculta", () => { render(false); expect(container.innerHTML).toBe(""); });
it("no ofrece ninguna casilla", () => { render(); expect(queryByRole("checkbox")).toBeNull(); });
