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

const navegacion = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => navegacion,
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
async function montar(total = lista.total) {
  vi.mocked(get).mockImplementation(async (url) => (url.endsWith("/resumen") ? resumen : { ...lista, total }) as never);
  const div = document.createElement("div");
  root = createRoot(div);
  await act(async () => root?.render(<NextIntlClientProvider locale="es" messages={mensajes}><PanelUsuarios /></NextIntlClientProvider>));
  return div;
}
it("muestra las cuentas, sus alias y el coste", async () => {
  const div = await montar();
  expect(get).not.toHaveBeenCalledWith("/liga/admin/panel-usuarios/resumen");
  expect(div.textContent).toContain("Cuenta Uno");
  expect(div.textContent).toContain("Cuenta Dos");
  expect(div.textContent).toContain("0,01");
});
it("no muestra cobrado ni el filtro Pro", async () => {
  const div = await montar();
  expect(div.textContent).not.toContain("Cobrado");
  expect(Array.from(div.querySelectorAll('[role="tab"]'), b => b.textContent)).not.toContain("Pro");
});
it("muestra el intervalo de paginación", async () => {
  expect((await montar()).textContent).toContain("1 a 2 de 2");
});
it("no invita a seleccionar una cuenta", async () => {
  expect((await montar()).textContent).not.toContain("Elige una cuenta");

});

it("mantiene filtros, orden y buscador en la URL", async () => {
  const div = await montar();
  const filtros = div.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(Array.from(filtros, b => b.textContent)).toEqual([mensajes.admin_panel_filter_all, mensajes.admin_panel_filter_active, mensajes.admin_panel_filter_suspended, mensajes.admin_panel_filter_adult]);
  act(() => filtros[2].click());
  expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?filtro=suspendidas");
  const orden = div.querySelector("select")!;
  act(() => { orden.value = "ia_mes_usd"; orden.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?orden=ia_mes_usd");
  expect(div.querySelector(".admin-buscador input")).not.toBeNull();
});
it("oculta los botones en una página y avanza de cincuenta en cincuenta", async () => {
  const div = await montar(120);
  const siguiente = Array.from(div.querySelectorAll("button")).find(b => b.textContent === mensajes.admin_next)!;
  act(() => siguiente.click());
  expect(navegacion.replace).toHaveBeenLastCalledWith("/admin/liga/usuarios?desde=50");
});
it("no pinta botones si cabe todo en una página", async () => {
  const div = await montar();
  expect(Array.from(div.querySelectorAll("button"), b => b.textContent)).not.toContain(mensajes.admin_next);
});
it("abre el alta debajo de la cabecera", async () => {
  const div = await montar();
  const alta = div.querySelector<HTMLButtonElement>("header button")!;
  act(() => alta.click());
  expect(div.querySelector("header form")).toBeNull();
  expect(div.querySelector(".adm-usuarios-alta-destino form")).not.toBeNull();
});
