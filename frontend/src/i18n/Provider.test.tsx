// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardarIdioma } from "@/lib/liga/api";
import { LanguageProvider, useLanguage } from "./Provider";
import type { Locale } from "./locale";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/liga/cache", () => ({ refrescarPresentacion: vi.fn() }));
vi.mock("@/lib/liga/api", () => ({
  guardarIdioma: vi.fn(async (idioma: Locale): Promise<{ idioma: Locale } | string> => ({ idioma })),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Contexto = ReturnType<typeof useLanguage>;
let contexto: Contexto | undefined;
let raiz: Root | undefined;
let contenedor: HTMLDivElement | undefined;

function Captura() {
  contexto = useLanguage();
  return null;
}

async function montar(inicial: Locale): Promise<void> {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  await act(async () => {
    raiz?.render(<LanguageProvider locale={inicial} messages={{ common_idioma: "Idioma" }}><Captura /></LanguageProvider>);
  });
}

function cookie(nombre: string): string | undefined {
  return document.cookie.split(";").map(item => item.trim())
    .find(item => item.startsWith(`${nombre}=`))?.slice(nombre.length + 1);
}

function catalogoEs() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ common_idioma: "Idioma" }), { status: 200 })));
}

afterEach(async () => {
  if (raiz) await act(async () => raiz?.unmount());
  raiz = undefined;
  contenedor?.remove();
  contenedor = undefined;
  contexto = undefined;
  for (const nombre of ["vennett_locale", "vennett_visitor_locale"]) document.cookie = `${nombre}=; Path=/; Max-Age=0`;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LanguageProvider al entrar en la cuenta", () => {
  it("la elección hecha en la portada gana al idioma de la cuenta y se guarda en ella", async () => {
    document.cookie = "vennett_locale=en; Path=/";
    document.cookie = "vennett_visitor_locale=en; Path=/";
    await montar("en");
    await act(async () => contexto?.setAccount({ id: "u1", locale: "es" }));
    await vi.waitFor(() => expect(guardarIdioma).toHaveBeenCalledWith("en", "u1"));
    await vi.waitFor(() => expect(cookie("vennett_visitor_locale")).toBeUndefined());
    expect(contexto?.locale).toBe("en");
    expect(cookie("vennett_locale")).toBe("en");
  });

  it("sin idioma en la cuenta, se queda el que ya se ve y no se guarda nada", async () => {
    await montar("en");
    await act(async () => contexto?.setAccount({ id: "u2", locale: null }));
    expect(contexto?.locale).toBe("en");
    expect(guardarIdioma).not.toHaveBeenCalled();
    expect(cookie("vennett_locale")).toBeUndefined();
  });

  it("sin elección en este dispositivo, manda el idioma guardado en la cuenta", async () => {
    document.cookie = "vennett_locale=en; Path=/";
    catalogoEs();
    await montar("en");
    await act(async () => contexto?.setAccount({ id: "u3", locale: "es" }));
    await vi.waitFor(() => expect(contexto?.locale).toBe("es"));
    expect(guardarIdioma).not.toHaveBeenCalled();
    expect(cookie("vennett_locale")).toBe("es");
  });

  it("al salir de la cuenta se queda el idioma, aunque el dispositivo esté en otro", async () => {
    document.cookie = "vennett_locale=es; Path=/";
    await montar("es");
    await act(async () => contexto?.setAccount({ id: "u4", locale: "es" }));
    await act(async () => contexto?.setAccount(null));
    expect(contexto?.locale).toBe("es");
  });

  it("si no se puede guardar, la elección de la portada se conserva para reintentarlo", async () => {
    vi.mocked(guardarIdioma).mockResolvedValueOnce("sin conexión");
    document.cookie = "vennett_locale=en; Path=/";
    document.cookie = "vennett_visitor_locale=en; Path=/";
    await montar("en");
    await act(async () => contexto?.setAccount({ id: "u5", locale: "es" }));
    await vi.waitFor(() => expect(contexto?.failure).toBe(true));
    expect(cookie("vennett_visitor_locale")).toBe("en");
  });
});
