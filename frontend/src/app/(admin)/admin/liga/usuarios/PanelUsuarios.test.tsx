// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";

vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class ApiError extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; vi.clearAllMocks(); });
import { PanelUsuarios } from "./PanelUsuarios";
import type { FilaPanel, ResumenPanel, ListaPanel } from "./panel";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/liga/usuarios",
}));
const resumen: ResumenPanel = {
  cuentas: 8, nuevas_7d: 2, activas_7d: 5, visitas_7d: 46,
  pro_vigentes: 1, pases_vigentes: 0, ia_mes_usd: "0.0140",
  cobrado_mes_usd: "0.07", tope_mensual_usd: "20",
};
const fila: FilaPanel = {
  id: "uno", alias: "Cuenta Uno", oculto: false, creado: "2026-01-01T12:00:00Z",
  roles: ["usuario"], suspendido: false, pro: true, visitas_total: 12,
  visitas_7d: 4, ultima_actividad: null, ia_mes_usd: "0.0140",
};
const lista: ListaPanel = { total: 2, filas: [fila, { ...fila, id: "dos", alias: "Cuenta Dos", pro: false }] };
async function montar() {
  vi.mocked(get).mockImplementation(async (url) => (url.endsWith("/resumen") ? resumen : lista) as never);
  const div = document.createElement("div");
  root = createRoot(div);
  await act(async () => root?.render(<NextIntlClientProvider locale="es" messages={mensajes}><PanelUsuarios /></NextIntlClientProvider>));
  return div;
}
it("muestra las cuentas, sus alias y el coste", async () => {
  const div = await montar();
  expect(div.textContent).toContain("8 · 2 nuevas en 7 días");
  expect(div.textContent).toContain("Cuenta Uno");
  expect(div.textContent).toContain("Cuenta Dos");
  expect(div.textContent).toContain("0,0140");
});
it("etiqueta la cuenta Pro", async () => {
  const div = await montar();
  expect(div.querySelector("li a")?.textContent).toContain("pro");
});
it("muestra el intervalo de paginaci?n", async () => {
  expect((await montar()).textContent).toContain("1 a 2 de 2");
});
it("invita a seleccionar una cuenta", async () => {
  expect((await montar()).textContent).toContain("Elige una cuenta para ver su ficha.");
});
