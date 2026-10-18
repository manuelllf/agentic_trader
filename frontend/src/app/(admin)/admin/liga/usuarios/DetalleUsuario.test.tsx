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
import { DetalleUsuario } from "./DetalleUsuario";
import type { FichaPanel, DiasPanel } from "./panel";
import type { Historial } from "./Actividad";

vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar: vi.fn(), dialogo: null }) }));
const usuario = {
  id: "uno", alias: "Cuenta Uno", roles: ["usuario"], plan: "gratis" as const,
  plan_hasta: null, pase_liga: false, pase_hasta: null, suspendido: false,
  creado: "2026-01-01T12:00:00Z", oculto: false, saldo: "0",
};
const ficha: FichaPanel = {
  ...usuario, email: "cuenta@example.com", edad: null, edad_declarada_en: null,
  baja_solicitada: null, terminos: { version: "1", aceptado: false, aceptado_en: null },
  actividad: { visitas_total: 0, visitas_7d: 0, ultima_visita: null, ultima_actividad: null, tiempo_30d_seg: 0 },
  ia: {
    mes: { total_usd: "0", llamadas: 0, cache: 0, conversor_usd: "0", conversor_llamadas: 0,
      pregunta_usd: "0", pregunta_llamadas: 0, cobrado_pregunta_usd: "0", lectura_usd: "0",
      lectura_llamadas: 0, cobrado_lectura_usd: "0", cobrado_usd: "0" },
    historico_usd: "0",
  },
  liga: { estrategias: 0, estrategias_jugando: 0, inscripciones: 0, ligas_propias: 0,
    ligas_miembro: 0, reportes_hechos: 0, reportes_recibidos: 0 },
};
const dias: DiasPanel = { dias: Array.from({ length: 14 }, (_, i) => ({ dia: `2026-01-${String(i + 1).padStart(2, "0")}`, visitas: 0 })) };
const movimientos: { total: number; filas: { id: number; usuario_id: string; importe: string; motivo: string; creado: string; creado_por: string | null }[] } = { total: 0, filas: [] };
const historial: Historial = { total: 0, filas: [] };
async function montar(email: string | null = ficha.email) {
  vi.mocked(get).mockImplementation(async (url) => {
    if (url.includes("/dias?")) return dias as never;
    if (url.includes("/visitas/historial?")) return historial as never;
    if (url.includes("/creditos?")) return movimientos as never;
    if (url.includes("/panel-usuarios/")) return { ...ficha, email } as never;
    if (url === "/liga/admin/usuarios/uno") return usuario as never;
    throw new Error(`URL inesperada: ${url}`);
  });
  const div = document.createElement("div");
  root = createRoot(div);
  await act(async () => root?.render(<NextIntlClientProvider locale="es" messages={mensajes}><DetalleUsuario id="uno" volver="/admin/liga/usuarios" /></NextIntlClientProvider>));
  return div;
}
it("muestra el email de la ficha", async () => {
  expect((await montar()).textContent).toContain("cuenta@example.com");
});
it("indica que no hay email", async () => {
  expect((await montar(null)).textContent).toContain("sin email");
});
it("muestra el alias como encabezado", async () => {
  expect((await montar()).querySelector("h1")?.textContent).toBe("Cuenta Uno");
});
it("representa los catorce d?as de actividad", async () => {
  expect((await montar()).querySelectorAll("svg rect")).toHaveLength(14);
});
it("permite suspender una cuenta activa", async () => {
  const botones = (await montar()).querySelectorAll("button");
  expect(Array.from(botones, (b) => b.textContent)).toContain(mensajes.admin_user_suspend);
});
