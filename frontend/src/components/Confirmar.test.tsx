// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const es = (await import("../../messages/es/common.json")).default as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  return { useTranslations: () => t };
});
import { useConfirmar, type OpcionesConfirmar } from "./Confirmar";
import es from "../../messages/es/common.json";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event("close")); };
}
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let api: ReturnType<typeof useConfirmar>;
function Prueba() { api = useConfirmar(); return api.dialogo; }
function montar() {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Prueba)));
}
const opciones = { titulo: es.common_confirmar, aceptar: es.common_confirmar };
function abrir(o: OpcionesConfirmar = opciones) {
  let resultado!: Promise<boolean>;
  act(() => { resultado = api.confirmar(o); });
  return resultado;
}
function botones() { return host!.querySelectorAll("button"); }
function escribir(valor: string) {
  const campo = host!.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); root = undefined; host = undefined;
});

describe("useConfirmar", () => {
  it("acepta y elimina el diálogo", async () => {
    montar(); const resultado = abrir();
    act(() => botones()[0].click());
    expect(await resultado).toBe(true); expect(host!.querySelector("dialog")).toBeNull();
  });
  it("cancela con el botón", async () => {
    montar(); const resultado = abrir();
    expect(botones()[1].textContent).toBe(es.common_cancelar);
    act(() => botones()[1].click()); expect(await resultado).toBe(false);
  });
  it("cancela con Escape", async () => {
    montar(); const resultado = abrir();
    act(() => host!.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(await resultado).toBe(false); expect(host!.querySelector("dialog")).toBeNull();
  });
  it("solo cierra al pulsar el fondo", async () => {
    montar(); const resultado = abrir(); const dialog = host!.querySelector("dialog")!;
    act(() => dialog.querySelector("h3")!.click()); expect(dialog.open).toBe(true);
    act(() => dialog.click()); expect(await resultado).toBe(false);
  });
  it("elige el rol y el foco según el peligro", async () => {
    montar(); const peligro = abrir({ ...opciones, peligro: true });
    expect(host!.querySelector("dialog")!.getAttribute("role")).toBe("alertdialog");
    expect(document.activeElement).toBe(botones()[1]);
    act(() => botones()[1].click()); await peligro;
    const normal = abrir();
    expect(host!.querySelector("dialog")!.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(botones()[0]);
    act(() => botones()[1].click()); await normal;
  });
  it("pide texto, valida espacios y devuelve el texto recortado", async () => {
    montar(); let resultado!: Promise<string | null>;
    act(() => { resultado = api.pedirTexto({ ...opciones, etiqueta: es.common_confirmar }); });
    expect(document.activeElement).toBe(host!.querySelector("textarea"));
    expect(host!.querySelector("textarea")!.maxLength).toBe(500);
    expect(botones()[0].disabled).toBe(true);
    escribir("   "); expect(botones()[0].disabled).toBe(true);
    escribir(`  ${es.common_enviar}  `); expect(botones()[0].disabled).toBe(false);
    act(() => botones()[0].click()); expect(await resultado).toBe(es.common_enviar);
    act(() => { resultado = api.pedirTexto({ ...opciones, etiqueta: es.common_confirmar }); });
    act(() => botones()[1].click()); expect(await resultado).toBeNull();
  });
  it("cancela al desmontarse y restaura el scroll", async () => {
    montar(); const overflow = document.body.style.overflow; const resultado = abrir();
    expect(document.body.style.overflow).toBe("hidden");
    act(() => root!.unmount()); root = undefined;
    expect(await resultado).toBe(false); expect(document.body.style.overflow).toBe(overflow);
  });
  it("cancela la solicitud anterior antes de abrir otra", async () => {
    montar(); const anterior = abrir(); const siguiente = abrir();
    expect(await anterior).toBe(false);
    act(() => botones()[1].click()); expect(await siguiente).toBe(false);
  });
});
