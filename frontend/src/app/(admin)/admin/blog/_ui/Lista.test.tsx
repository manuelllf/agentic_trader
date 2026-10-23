// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import mensajes from "../../../../../../messages/es/blogAdmin.json";
import { listarArticulos, resumenBoletin } from "@/lib/blog/admin";
import Lista from "./Lista";
vi.mock("@/lib/blog/admin", () => ({ listarArticulos: vi.fn(), resumenBoletin: vi.fn() }));
let root: Root;
let div: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); div?.remove(); vi.resetAllMocks(); });
it("muestra un solo botón para crear el artículo cuando no hay ninguno", async () => {
  vi.mocked(listarArticulos).mockResolvedValue([]);
  vi.mocked(resumenBoletin).mockResolvedValue({ suscriptores: [], envios: [] });
  div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div);
  await act(async () => root.render(<NextIntlClientProvider locale="es" messages={mensajes}><Lista /></NextIntlClientProvider>));
  expect(div.querySelectorAll('a[href="/admin/blog/nuevo"]')).toHaveLength(1);
});
