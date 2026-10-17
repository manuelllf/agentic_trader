// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../../../messages/es/blog.json";
import DarseDeBaja from "./DarseDeBaja";

const url = vi.hoisted(() => ({ query: "token=token-secreto&correo=ignorado%40example.test" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(url.query) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const textos = { boton: es.blog_unsubscribe_button, espera: es.blog_unsubscribe_wait, exito: es.blog_unsubscribe_success,
  invalido: es.blog_unsubscribe_invalid, error: es.blog_newsletter_error };
beforeEach(() => {
  url.query = "token=token-secreto&correo=ignorado%40example.test";
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function montar() { act(() => root.render(<DarseDeBaja textos={textos} />)); }
async function pulsar() { await act(async () => { host.querySelector("button")!.click(); }); }
describe("DarseDeBaja", () => {
  it("solo envia el token de la URL tras pulsar y muestra el exito", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); montar();
    expect(fetchMock).not.toHaveBeenCalled(); await pulsar();
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/blog/boletin/baja", expect.objectContaining({
      method: "POST", body: JSON.stringify({ token: "token-secreto" }),
    }));
    expect(host.textContent).toContain(textos.exito); expect(host.querySelector("button")).toBeNull();
  });
  it("muestra el enlace invalido cuando ok es false", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: false }) }); montar(); await pulsar();
    expect(host.textContent).toContain(textos.invalido);
  });
  it("sin token no ofrece accion ni hace peticiones", () => {
    url.query = "correo=ignorado%40example.test"; montar();
    expect(host.textContent).toContain(textos.invalido); expect(host.querySelector("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("deshabilita el boton y muestra la espera durante la peticion", async () => {
    let resolver!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { resolver = resolve; })); montar();
    act(() => host.querySelector("button")!.click());
    expect(host.querySelector("button")!.disabled).toBe(true); expect(host.textContent).toContain(textos.espera);
    await act(async () => { resolver({ ok: true, json: async () => ({ ok: true }) }); });
    expect(host.textContent).toContain(textos.exito);
  });
  it("muestra detail en errores y permite reintentar", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ detail: "Error del servidor" }) }); montar(); await pulsar();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Error del servidor");
    expect(host.querySelector("button")!.disabled).toBe(false);
  });
});
