// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/strategies.json";
import type { Novedades } from "@/lib/liga/api";
import { fecha } from "@/lib/liga/format";
import { HojaNovedades } from "./HojaNovedades";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let contenedor: HTMLDivElement;

afterEach(() => {
  if (root) act(() => root.unmount());
  contenedor?.remove();
});

const completo: Novedades = {
  desde: "2026-10-16T10:00:00+00:00",
  estrategias: [{
    estrategia_id: "estrategia", nombre: "Mi estrategia",
    semana: { dia_inicio: "2026-10-09", dia_fin: "2026-10-16", rentabilidad: 1.4,
      sp500: 0.8, puntos: 3, puesto: 7, de: 42, movimiento: 3 },
    movidas: [{ ticker: "NVDA", nombre: "NVIDIA", aportacion: 0.62 }],
    desde_lunes: { rentabilidad: 0.9, sp500: 0.5 },
    cambios: [{ accion: "quitar", ticker: "XOM", fecha: "2026-10-14", cuenta_desde: "2026-10-16", entra: null }],
  }],
};

function montar(datos = completo, alCerrar = vi.fn()) {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
  act(() => root.render(<NextIntlClientProvider locale="es" messages={mensajes}>
    <HojaNovedades novedades={datos} alCerrar={alCerrar} />
  </NextIntlClientProvider>));
  return alCerrar;
}

describe("HojaNovedades", () => {
  it("muestra la semana, las movidas, la cartera y los cambios", () => {
    montar();
    for (const titulo of ["Desde tu última visita", "Tu semana", "Qué ha movido la semana", "Tu cartera desde el lunes", "Cambios"]) {
      expect(contenedor.textContent).toContain(titulo);
    }
    expect(contenedor.textContent).toContain("Ganas 3 puntos");
    expect(contenedor.textContent).toContain(`Quitaste XOM el ${fecha("2026-10-14")}. Cuenta desde la semana del ${fecha("2026-10-16")}.`);
    expect(contenedor.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
  });

  it("muestra la empresa que entra al quitar otra", () => {
    montar({ ...completo, estrategias: [{ ...completo.estrategias[0],
      cambios: [{ accion: "quitar", ticker: "XOM", entra: "CVX", fecha: "2026-10-14", cuenta_desde: "2026-10-16" }],
    }] });
    const bloque = Array.from(contenedor.querySelectorAll("section")).find(s => s.querySelector("h3")?.textContent === "Cambios");
    expect(bloque?.textContent).toContain("Cambiaste XOM por CVX");
  });

  it("admite un caso sin semana ni cambios", () => {
    montar({ ...completo, estrategias: [{ ...completo.estrategias[0], semana: null, cambios: [] }] });
    expect(contenedor.textContent).not.toContain("Tu semana");
    expect(contenedor.textContent).not.toContain("Cambios");
    expect(contenedor.textContent).toContain("Tu cartera desde el lunes");
  });

  it("llama a alCerrar una vez al pulsar Entendido", () => {
    const alCerrar = montar();
    const boton = Array.from(contenedor.querySelectorAll("button")).find(b => b.textContent === "Entendido");
    expect(boton).toBeTruthy();
    act(() => boton!.click());
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });
});
