// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalogo, Ficha } from "@/lib/liga/api";
import { MetodologiaFicha } from "./MetodologiaFicha";

vi.mock("next-intl", async () => {
  const [builder, strategies] = await Promise.all([
    import("../../../../../messages/es/builder.json"), import("../../../../../messages/es/strategies.json"),
  ]);
  const catalogo = { ...builder.default, ...strategies.default } as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalogo = {
  sectores: { tech: "Tecnología", salud: "Salud" },
  reglas: [
    { clave: "sectores", titulo: "Sectores", parametros: [{ nombre: "lista", etiqueta: "Sectores", tipo: "sectores", minimo: null, maximo: null, paso: null }] },
    { clave: "deuda", titulo: "Deuda baja", parametros: [{ nombre: "maximo", etiqueta: "Máx", tipo: "numero", minimo: 0, maximo: 10, paso: 1, defecto: 2 }] },
  ],
} as unknown as Catalogo;

const base = {
  id: "e1", nombre: "Foso", casa: null, autor: "Ana", estado: "jugando", visibilidad: "publicada", es_dueno: false,
  jornadas: [], posiciones: [], casa_metodologia: null, cada_dia_1: "revisar",
  receta: {
    id: 1, idea: "Empresas con foso", catalogo_version: 1, creada: "2026-01-01", pregunta: null,
    reglas: [{ clave: "sectores", params: { lista: ["tech", "salud"] } }, { clave: "deuda", params: { maximo: 2 } }],
    pesos: { negocio: 60, precio: 40, deuda: 0 }, n_empresas: 5, reparto: "igual", max_por_sector: 0, excluidas: ["TSLA", "META"],
  },
} as unknown as Ficha;

let root: Root;
let div: HTMLDivElement;
beforeEach(() => { div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div); });
afterEach(() => { act(() => root.unmount()); div.remove(); });

function pintar(ficha: Ficha, extra: Partial<{ puedeCopiar: boolean; onCopiar: () => void }> = {}) {
  act(() => root.render(<MetodologiaFicha ficha={ficha} catalogo={catalogo} puedeCopiar={extra.puedeCopiar ?? false}
    ocupado={false} onCopiar={extra.onCopiar ?? (() => {})} />));
}

describe("MetodologiaFicha", () => {
  it("casa con pasos: resumen y lista numerada", () => {
    pintar({ ...base, casa: "alpha", receta: null, casa_metodologia: { resumen: "Elige por calidad", pasos: [
      { titulo: "Filtra", texto: "Quita lo caro" }, { titulo: "Ordena", texto: "Por puntos" }] } } as Ficha);
    expect(div.querySelector(".fi-celda.texto")?.textContent).toBe("Elige por calidad");
    const pasos = div.querySelectorAll("ol.fi-grupo li.fi-celda.fi-paso");
    expect(pasos).toHaveLength(2);
    expect(pasos[1].textContent).toBe("2OrdenaPor puntos");
    expect(div.querySelector(".lv-pie")).toBeNull();
  });

  it("casa sin pasos: avisa de que no son públicos", () => {
    pintar({ ...base, casa: "omega", receta: null, casa_metodologia: { resumen: "Resumen", pasos: [] } } as Ficha);
    expect(div.querySelector("ol")).toBeNull();
    expect(div.querySelector(".fi-pie-grupo")?.textContent).toBe("Sus pasos completos no son públicos.");
  });

  it("privada: estado vacío con candado", () => {
    pintar({ ...base, receta: null });
    expect(div.querySelector(".fi-vacio svg")).not.toBeNull();
    expect(div.querySelector(".fi-vacio h2")?.textContent).toBe("Su método es privado");
    expect(div.querySelector(".fi-grupo")).toBeNull();
  });

  it("receta completa: reglas, pesos, cartera y excluidas", () => {
    pintar(base);
    const reglas = div.querySelectorAll("ul.fi-grupo")[0].querySelectorAll("li");
    expect(reglas).toHaveLength(2);
    expect(reglas[0].className).toBe("fi-celda apilada");
    expect(reglas[0].querySelector(".t")?.textContent).toBe("Sectores");
    expect(reglas[0].querySelector(".valor")?.textContent).toBe("Tecnología, Salud");
    expect(reglas[1].className).toBe("fi-celda");
    expect(reglas[1].querySelector(".valor")?.textContent).toBe("máx. 2");

    const pesos = div.querySelectorAll("li.fi-peso");
    expect(pesos).toHaveLength(2);
    expect(pesos[0].querySelector(".valor")?.textContent).toBe("60 %");
    expect((pesos[0].querySelector(".barra i") as HTMLElement).style.width).toBe("60%");

    const texto = div.textContent ?? "";
    expect(texto).toContain("Hasta 5");
    expect(texto).toContain("Sin límite");
    expect(texto).toContain("Pesos iguales");
    expect(texto).toContain("Se revisa");
    expect(texto).toContain("TSLA, META");
    expect(div.querySelector(".lv-pie")).not.toBeNull();
  });

  it("cartera con tope por sector y sin dato de Cada mes", () => {
    pintar({ ...base, cada_dia_1: null, receta: { ...base.receta!, max_por_sector: 2, reparto: "puntos", excluidas: [] } });
    const texto = div.textContent ?? "";
    expect(texto).toContain("Máx. 2");
    expect(texto).not.toContain("Cada mes");
    expect(texto).not.toContain("Excluidas");
  });

  it("el botón de copiar solo sale con puedeCopiar y llama al callback", () => {
    pintar(base);
    expect(div.querySelector("button.fi-boton")).toBeNull();
    const onCopiar = vi.fn();
    pintar(base, { puedeCopiar: true, onCopiar });
    const boton = div.querySelector("button.fi-boton.tintado") as HTMLButtonElement;
    act(() => boton.click());
    expect(onCopiar).toHaveBeenCalledTimes(1);
  });
});
