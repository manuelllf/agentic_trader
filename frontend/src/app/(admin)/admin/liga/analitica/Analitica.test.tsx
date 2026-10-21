// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import AnaliticaAdmin, { type AnaliticaOut } from "./page";
import { describe, expect, it, vi } from "vitest";
import { altura, porcentaje, ritmo } from "./analitica";

describe("funciones de analítica", () => {
  it("evita dividir entre cero y redondea porcentajes", () => {
    expect(porcentaje(0, 0)).toBeNull();
    expect(porcentaje(1, 3)).toBe(33);
  });
  it("mantiene las barras positivas visibles y limita su altura", () => {
    expect(altura(0, 10)).toBe(0);
    expect(altura(1, 1000)).toBe(1.5);
    expect(altura(20, 10)).toBe(100);
    expect(altura(1, 0)).toBe(0);
  });
  it("compara el ritmo con el periodo anterior", () => {
    expect(ritmo(3, 5)).toBe("bajando");
    expect(ritmo(5, 3)).toBe("subiendo");
    expect(ritmo(3, 3)).toBe("igual");
  });
});

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../Intenciones", () => ({ Intenciones: () => <div /> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("muestra cuatro cifras y ocho semanas con altas sin fondos", async () => {
  const datos: AnaliticaOut = {
    cifras: { cuentas: 100, nuevas_7d: 9, activas_7d: 71, visitas_7d: 174, ia_mes_usd: 1, tope_mensual_usd: 5 },
    visitas_7d_anterior: 100, embudo: { altas: 45, con_estrategia: 36, apuntadas: 30, jugaron: 20 },
    cohortes: Array.from({ length: 10 }, (_, i) => ({ semana: `2026-08-${String(i + 1).padStart(2, "0")}`, altas: i, con_estrategia: 1, apuntadas: 1, jugaron: 1 })),
    visitas_dia: [{ dia: "2026-08-01", visitas: 30, cuentas: 1 }],
  };
  vi.mocked(get).mockResolvedValue(datos);
  const div = document.createElement("div");
  const root = createRoot(div);
  try {
    await act(async () => root.render(<NextIntlClientProvider locale="es" messages={mensajes}><AnaliticaAdmin /></NextIntlClientProvider>));
    expect(div.querySelectorAll(".adm-cifra")).toHaveLength(4);
    expect(div.textContent).not.toMatch(/cobrado|en juego/i);
    expect(div.textContent).toContain("+74 frente a la semana anterior");
    expect(div.querySelectorAll(".adm-tabla tbody tr")).toHaveLength(8);
    expect(div.querySelector(".adm-tabla tbody tr th")?.textContent).toContain("10");
    expect(div.querySelector(".adm-tabla [style]")).toBeNull();
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
