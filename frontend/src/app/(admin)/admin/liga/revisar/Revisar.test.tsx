// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import RevisarAdmin from "./page";

const navegacion = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("vista=moderacion"),
  useRouter: () => ({ replace: navegacion.replace }),
}));
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | undefined;
let contenedor: HTMLDivElement;

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  vi.resetAllMocks();
});

describe("Revisar", () => {
  it("selecciona moderación desde la URL y enlaza el cambio de pestaña", async () => {
    vi.mocked(get).mockResolvedValue({ total: 0, filas: [] });
    contenedor = document.createElement("div");
    document.body.append(contenedor);
    raiz = createRoot(contenedor);
    await act(async () => {
      raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}><RevisarAdmin /></NextIntlClientProvider>);
    });
    const tabs = contenedor.querySelectorAll('[role="tab"]');
    expect(tabs[1].textContent).toBe(mensajes.admin_revisar_moderacion);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(get).toHaveBeenCalledWith("/liga/moderacion/reportes?cuantos=50");
    await act(async () => { (tabs[0] as HTMLButtonElement).click(); });
    expect(navegacion.replace).toHaveBeenCalledWith("/admin/liga/revisar?vista=errores", { scroll: false });
  });
});
