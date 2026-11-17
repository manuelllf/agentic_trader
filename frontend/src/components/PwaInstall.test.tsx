// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PwaInstall from "./PwaInstall";


const textos = { titulo: "Instalar Vennett", texto: "Instala Vennett en tu móvil.", accion: "Instalar" };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

function evento() {
  const e = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(e, { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: "dismissed" }) });
  return e;
}

it("registra el service worker, muestra el aviso con sus textos y lo marca como visto", async () => {
  const register = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  await act(async () => root.render(<PwaInstall textos={textos} />));
  expect(register).toHaveBeenCalledWith("/sw.js");
  act(() => { window.dispatchEvent(evento()); });
  const aviso = container.querySelector(".pwa-install");
  expect(aviso?.getAttribute("aria-label")).toBe("Instalar Vennett");
  expect(aviso?.textContent).toContain("Instala Vennett en tu móvil.");
  expect(aviso?.querySelector("button")?.textContent).toBe("Instalar");
  expect(localStorage.getItem("pwa_install_seen")).toBe("1");
});

it("en un navegador que ya lo vio, no vuelve a salir en ninguna página", async () => {
  localStorage.setItem("pwa_install_seen", "1");
  await act(async () => root.render(<PwaInstall textos={textos} />));
  act(() => { window.dispatchEvent(evento()); });
  expect(container.querySelector(".pwa-install")).toBeNull();
});
