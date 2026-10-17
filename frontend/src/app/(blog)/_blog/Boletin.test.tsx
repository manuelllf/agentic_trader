// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../../../messages/es/blog.json";
import Boletin from "./Boletin";

vi.mock("@/components/TurnstileWidget", () => ({ default: ({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) =>
  <button type="button" data-reset={resetKey} onClick={() => onToken("captcha-token")}>Captcha</button> }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const textos = {
  titulo: es.blog_newsletter_title, intro: es.blog_newsletter_intro, nota: es.blog_newsletter_note,
  correo: es.blog_newsletter_email, boton: es.blog_newsletter_button, revisaTitulo: es.blog_newsletter_check_title,
  revisaTexto: es.blog_newsletter_check_text, error: es.blog_newsletter_error,
};
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function montar() { act(() => root.render(<Boletin idioma="es" variante="pagina" textos={textos} />)); }
function rellenar() {
  const input = host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "persona@example.test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>("button[data-reset]")!.click();
  });
}
async function enviar() {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
describe("Boletin", () => {
  it("no renderiza sin clave publica", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  "); montar(); expect(host.innerHTML).toBe("");
  });
  it("muestra correo obligatorio y deshabilita el envio sin token", () => {
    montar(); const input = host.querySelector("input")!;
    expect(input.type).toBe("email"); expect(input.autocomplete).toBe("email"); expect(input.required).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
  it("envia el correo en el cuerpo y muestra la confirmacion con 202", async () => {
    fetchMock.mockResolvedValue({ status: 202 }); montar(); rellenar(); await enviar();
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/blog/boletin", expect.objectContaining({
      method: "POST", body: JSON.stringify({ correo: "persona@example.test", idioma: "es", turnstile: "captcha-token" }),
    }));
    expect(host.textContent).toContain(es.blog_newsletter_check_title);
    expect(host.textContent).toContain("persona@example.test"); expect(host.querySelector("form")).toBeNull();
  });
  it("muestra detail con 403 y reinicia el captcha", async () => {
    fetchMock.mockResolvedValue({ status: 403, json: async () => ({ detail: "Captcha rechazado" }) });
    montar(); rellenar(); await enviar();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Captcha rechazado");
    expect(host.querySelector("button[data-reset]")!.getAttribute("data-reset")).toBe("1");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
  it("muestra el error generico cuando falla la red", async () => {
    fetchMock.mockRejectedValue(new Error("offline")); montar(); rellenar(); await enviar();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(es.blog_newsletter_error);
  });
});
