// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...resto }: { href: unknown; children?: React.ReactNode }) =>
    React.createElement("a", { href: typeof href === "string" ? href : JSON.stringify(href), ...resto }, children) };
});
import Enlace from "./Enlace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let host: HTMLDivElement | undefined;

function hrefs(idioma: string, destinos: string[]): (string | null)[] {
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
  act(() => raiz!.render(
    <NextIntlClientProvider locale={idioma} messages={{}}>
      {destinos.map(d => <Enlace key={d} href={d}>x</Enlace>)}
    </NextIntlClientProvider>));
  return [...host.querySelectorAll("a")].map(a => a.getAttribute("href"));
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  host?.remove(); raiz = undefined; host = undefined;
});

describe("Enlace", () => {
  it("en inglés lleva las páginas públicas a su versión /en, con query y fragmento", () => {
    expect(hrefs("en", ["/", "/liga", "/liga?vista=tabla", "/entrar?next=/crear", "/legal/terminos#a",
      "/aprender/que-es-la-liga", "/como-funciona"])).toEqual([
      "/en", "/en/liga", "/en/liga?vista=tabla", "/en/entrar?next=/crear", "/en/legal/terminos#a",
      "/en/aprender/que-es-la-liga", "/en/como-funciona"]);
  });

  it("en español no cambia nada", () => {
    expect(hrefs("es", ["/", "/liga", "/entrar?next=/crear"])).toEqual(["/", "/liga", "/entrar?next=/crear"]);
  });

  it("no toca lo privado, lo externo ni lo que ya lleva /en", () => {
    const destinos = ["/crear", "/mias", "/cuenta/plan", "/ficha/1", "#derechos", "https://x.test/liga",
      "mailto:a@b.c", "/en/blog", "/blog/uno", "/en/criptico", "/en/liga"];
    expect(hrefs("en", destinos)).toEqual(destinos);
  });
});
