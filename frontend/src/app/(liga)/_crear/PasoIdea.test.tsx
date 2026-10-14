// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PasoIdea } from "./PasoIdea";
import { convertirFrase, getMercado, type Catalogo } from "@/lib/liga/api";
vi.mock("@/lib/liga/api", () => ({ convertirFrase: vi.fn(), getMercado: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => (k: string, v?: { count: number }) => v ? `${k} ${v.count}` : k }));
vi.mock("../_ui", () => ({ Boton: ({ children, variante: _variante, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: string }) => { void _variante; return <button {...props}>{children}</button>; } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claves = ["calidad", "maduros", "dividendo", "crecimiento", "balance", "castigadas", "pequenas"];
const catalogo = { estilos: claves.map(clave => ({ clave, reglas: [{ clave: "margen", params: { margen_pct: 17 } }], pesos: { negocio: 40 }, n_empresas: 7, reparto: "nota", max_por_sector: 3 })), reglas: [{ clave: "margen", titulo: "Margen", parametros: [] }] } as unknown as Catalogo;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); vi.clearAllMocks(); });
async function montar(mercado: unknown = { estilos: Object.fromEntries(claves.map((k, i) => [k, { pasan: 1000 + i, entran: 5 }])) }) {
  vi.mocked(getMercado).mockResolvedValue(mercado as Awaited<ReturnType<typeof getMercado>>);
  const div = document.createElement("div"); root = createRoot(div);
  const actualizarB = vi.fn(), irReglas = vi.fn(), alCambiarQuedan = vi.fn();
  await act(async () => root.render(<PasoIdea catalogo={catalogo} idea="Mi idea" reglas={[]}
    quedan={null} alCambiarQuedan={alCambiarQuedan} alCambiarIdea={vi.fn()}
    alCambiarOcupado={vi.fn()} actualizarB={actualizarB} irReglas={irReglas} />));
  return { div, actualizarB, irReglas, alCambiarQuedan };
}
it("muestra los siete estilos con el recuento de pasan", async () => {
  const { div } = await montar();
  expect(div.querySelectorAll(".idea-estilo")).toHaveLength(7);
  claves.forEach((k, i) => { expect(div.textContent).toContain(`builder_style_${k}_titulo`); expect(div.textContent).toContain(`1.00${i}`); });
});
it("carga toda la receta del estilo y pasa a Reglas", async () => {
  const { div, actualizarB, irReglas } = await montar();
  act(() => (div.querySelector(".idea-estilo-abrir") as HTMLButtonElement).click());
  act(() => (div.querySelector(".idea-estilo-detalle button") as HTMLButtonElement).click());
  const { clave: _clave, ...receta } = catalogo.estilos[0];
  void _clave;
  expect(actualizarB).toHaveBeenCalledWith({ ...receta, interpretacion: [] });
  expect(irReglas).toHaveBeenCalledOnce();
});
it("muestra las tres marcas y solo aplica la propuesta al aceptarla", async () => {
  vi.mocked(convertirFrase).mockResolvedValue({ reglas: catalogo.estilos[0].reglas,
    interpretacion: ["exacta", "aproximada", "no_disponible"].map(tipo => ({ tipo, intencion: tipo, regla: null, motivo: "Detalle" })), quedan: 2, pesos: null, pregunta: null } as Awaited<ReturnType<typeof convertirFrase>>);
  const { div, actualizarB, alCambiarQuedan } = await montar();
  await act(async () => (div.querySelector(".paso-bloque button") as HTMLButtonElement).click());
  expect(Array.from(div.querySelectorAll(".idea-propuesta li > span")).map(n => n.textContent)).toEqual(["✓", "≈", "–"]);
  expect(actualizarB).not.toHaveBeenCalled(); expect(alCambiarQuedan).toHaveBeenCalledWith(2);
  act(() => (div.querySelector(".propuesta button") as HTMLButtonElement).click());
  expect(actualizarB.mock.calls[0][0].reglas).toEqual(catalogo.estilos[0].reglas);
});
it.each([null, "Entra en tu cuenta para seguir."])("sin mercado (%s) los estilos se eligen igual, sin recuento ni avisos", async mercado => {
  const { div } = await montar(mercado);
  expect(div.querySelector('[role="alert"]')).toBeNull();
  expect(div.textContent).not.toContain("Entra en tu cuenta");
  expect(div.querySelectorAll(".idea-estilo")).toHaveLength(7);
  expect(div.querySelector(".idea-recuento")).toBeNull();
});
it("el detalle del estilo enseña sus reglas como frases cortas", async () => {
  const { div } = await montar();
  act(() => (div.querySelector(".idea-estilo-abrir") as HTMLButtonElement).click());
  expect(div.querySelector(".idea-chips .chip")?.textContent).toBe("Margen");
});
it("empezar desde cero limpia las reglas y avanza", async () => {
  const { div, actualizarB, irReglas } = await montar();
  act(() => (div.querySelector("button.link") as HTMLButtonElement).click());
  expect(actualizarB).toHaveBeenCalledWith({ reglas: [], interpretacion: [] });
  expect(irReglas).toHaveBeenCalledOnce();
});
