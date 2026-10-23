// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import mensajes from "../../../../messages/es/strategies.json";
import builder from "../../../../messages/es/builder.json";
import type { Ventana } from "@/lib/liga/api";
import { ProximaCartera } from "./VentanaCambios";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let contenedor: HTMLDivElement;

afterEach(() => {
  if (root) act(() => root.unmount());
  contenedor?.remove();
});

const ventana: Ventana = {
  estrategia_id: "estrategia", fase: "siguiente", jornada_id: 1,
  cierra: "2026-10-30T22:00:00Z", cartera: [], quitadas: [], quitadas_formacion: [],
  proxima: [
    { ticker: "AAPL", nombre: "Apple", sector: "Tecnología", peso: 50 },
    { ticker: "MSFT", nombre: "Microsoft", sector: "Tecnología", peso: 50 },
  ],
};

function montar(datos: Ventana) {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
  act(() => root.render(<NextIntlClientProvider locale="es" messages={{ ...mensajes, ...builder }}>
    <ProximaCartera ventana={datos} />
  </NextIntlClientProvider>));
}

describe("ProximaCartera", () => {
  it("muestra el título y las dos empresas de la semana que viene", () => {
    montar(ventana);
    expect(contenedor.querySelector("h2")?.textContent).toBe("Tu cartera de la semana que viene");
    expect(contenedor.textContent).toContain("Apple");
    expect(contenedor.textContent).toContain("Microsoft");
  });

  it("no muestra nada sin cartera próxima", () => {
    montar({ ...ventana, proxima: null });
    expect(contenedor.innerHTML).toBe("");
  });
});
