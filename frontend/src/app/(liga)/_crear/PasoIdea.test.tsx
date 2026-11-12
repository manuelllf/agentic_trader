// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { PasoIdea } from "./PasoIdea";
import { convertirFrase, enviarIntencion, getMercado, type Catalogo } from "@/lib/liga/api";
vi.mock("@/lib/liga/api", () => ({ convertirFrase: vi.fn(), enviarIntencion: vi.fn(), getMercado: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => (k: string, v?: { count: number }) => v ? `${k} ${v.count}` : k }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };
});
const claves = ["calidad", "maduros", "dividendo", "crecimiento", "balance", "castigadas", "pequenas"];
const catalogo = { estilos: claves.map(clave => ({ clave, reglas: [{ clave: "margen", params: { margen_pct: 17 } }], pesos: { negocio: 40 }, n_empresas: 7, reparto: "nota", max_por_sector: 3 })), reglas: [{ clave: "margen", titulo: "Margen", parametros: [] }] } as unknown as Catalogo;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); vi.clearAllMocks(); });
async function montar(mercado: unknown = { n: 4873, estilos: Object.fromEntries(claves.map((k, i) => [k, { pasan: 1000 + i, entran: 5 }])) }) {
  vi.mocked(getMercado).mockResolvedValue(mercado as Awaited<ReturnType<typeof getMercado>>);
  const div = document.createElement("div"); root = createRoot(div);
  const actualizarB = vi.fn(), irReglas = vi.fn(), alCambiarQuedan = vi.fn();
  await act(async () => root.render(<PasoIdea catalogo={catalogo} idea="Mi idea" reglas={[]}
    quedan={null} alCambiarQuedan={alCambiarQuedan} alCambiarIdea={vi.fn()}
    alCambiarOcupado={vi.fn()} actualizarB={actualizarB} irReglas={irReglas} />));
  return { div, actualizarB, irReglas, alCambiarQuedan };
}
const hojas = (div: HTMLElement) => Array.from(div.querySelectorAll("dialog.hoja-liga")) as HTMLDialogElement[];
const hojaAbierta = (div: HTMLElement) => hojas(div).find(d => d.open);
const pulsar = (el: Element | null | undefined) => act(() => (el as HTMLButtonElement).click());

it("muestra los siete estilos en una lista, con el recuento de los que pasan hoy", async () => {
  const { div } = await montar();
  expect(div.querySelectorAll(".idea-estilo")).toHaveLength(7);
  claves.forEach((k, i) => { expect(div.textContent).toContain(`builder_style_${k}_titulo`); expect(div.textContent).toContain(`1.00${i}`); });
});
it("el estilo abre su hoja y Empezar carga toda la receta y pasa a Reglas", async () => {
  const { div, actualizarB, irReglas } = await montar();
  pulsar(div.querySelector(".idea-estilo"));
  const hoja = hojaAbierta(div)!;
  expect(hoja.textContent).toContain("builder_style_calidad_mira");
  pulsar(hoja.querySelector(".hoja-liga-acc.der"));
  const { clave: _clave, ...receta } = catalogo.estilos[0];
  void _clave;
  expect(actualizarB).toHaveBeenCalledWith({ ...receta, interpretacion: [] });
  expect(irReglas).toHaveBeenCalledOnce();
});
it("muestra las tres marcas y solo aplica la propuesta al aceptarla", async () => {
  vi.mocked(convertirFrase).mockResolvedValue({ reglas: catalogo.estilos[0].reglas,
    interpretacion: ["exacta", "aproximada", "no_disponible"].map(tipo => ({ tipo, intencion: tipo, regla: null, motivo: "Detalle" })), quedan: 2, pesos: null, pregunta: null } as Awaited<ReturnType<typeof convertirFrase>>);
  const { div, actualizarB, alCambiarQuedan } = await montar();
  await act(async () => (div.querySelector(".cr-fila-accion button") as HTMLButtonElement).click());
  expect(Array.from(div.querySelectorAll(".cr-marca"), n => n.textContent)).toEqual(["✓", "≈", "–"]);
  expect(actualizarB).not.toHaveBeenCalled(); expect(alCambiarQuedan).toHaveBeenCalledWith(2);
  pulsar(div.querySelector(".cr-bloque-boton button"));
  expect(actualizarB.mock.calls[0][0].reglas).toEqual(catalogo.estilos[0].reglas);
});
it.each([null, "Entra en tu cuenta para seguir."])("sin mercado (%s) los estilos se eligen igual, sin recuento ni avisos", async mercado => {
  const { div } = await montar(mercado);
  expect(div.querySelector('[role="alert"]')).toBeNull();
  expect(div.textContent).not.toContain("Entra en tu cuenta");
  expect(div.querySelectorAll(".idea-estilo")).toHaveLength(7);
  expect(div.querySelector(".idea-recuento")).toBeNull();
});
it("la hoja del estilo enseña sus reglas, una por fila", async () => {
  const { div } = await montar();
  pulsar(div.querySelector(".idea-estilo"));
  expect(hojaAbierta(div)!.querySelector(".cr-reglas-estilo .cr-celda .t")?.textContent).toBe("Margen");
});
it("empezar desde cero limpia las reglas y avanza", async () => {
  const { div, actualizarB, irReglas } = await montar();
  pulsar(Array.from(div.querySelectorAll("button.cr-celda")).find(b => b.textContent === "builder_idea_cero"));
  expect(actualizarB).toHaveBeenCalledWith({ reglas: [], interpretacion: [] });
  expect(irReglas).toHaveBeenCalledOnce();
});

function abrirIntencion(div: HTMLDivElement) {
  pulsar(Array.from(div.querySelectorAll(".cr-pie button")).find(b => b.textContent === "builder_intencion_abrir"));
}
function escribirIntencion(div: HTMLDivElement, texto: string) {
  const campo = div.querySelector("#idea-intencion-texto") as HTMLTextAreaElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const hojaIntencion = (div: HTMLElement) => div.querySelector("#idea-intencion-texto")!.closest("dialog") as HTMLDialogElement;
it("el enlace abre la hoja para sugerir una medida", async () => {
  const { div } = await montar();
  expect(hojaIntencion(div).open).toBe(false);
  abrirIntencion(div);
  expect(hojaIntencion(div).open).toBe(true);
  expect(hojaIntencion(div).textContent).toContain("builder_intencion_ayuda");
  expect((div.querySelector("#idea-intencion-texto") as HTMLTextAreaElement).maxLength).toBe(160);
  expect((hojaIntencion(div).querySelector(".hoja-liga-acc.der") as HTMLButtonElement).disabled).toBe(true);
});
it("el contador cuenta los caracteres escritos", async () => {
  const { div } = await montar(); abrirIntencion(div);
  escribirIntencion(div, "Hola");
  expect(hojaIntencion(div).querySelector('[aria-live="polite"]')?.textContent).toBe("4/160");
});
it("envía el texto recortado y al tener éxito cierra la hoja, la vacía y lo confirma", async () => {
  vi.mocked(enviarIntencion).mockResolvedValue(null);
  const { div } = await montar(); abrirIntencion(div);
  escribirIntencion(div, "  Dividendos  ");
  await act(async () => (hojaIntencion(div).querySelector(".hoja-liga-acc.der") as HTMLButtonElement).click());
  expect(enviarIntencion).toHaveBeenCalledWith("Dividendos");
  expect(div.querySelector(".cr-toast")?.textContent).toContain("builder_intencion_ok");
  expect(hojaIntencion(div).open).toBe(false);
  expect((div.querySelector("#idea-intencion-texto") as HTMLTextAreaElement).value).toBe("");
});
it.each([
  "Ya has enviado varias peticiones hoy. Vuelve mañana.",
  "Escribe una frase de hasta 160 caracteres.",
  "You've already sent several requests today. Come back tomorrow.",
])("muestra tal cual el aviso de la intención: %s", async texto => {
    vi.mocked(enviarIntencion).mockResolvedValue(texto);
    const { div } = await montar(); abrirIntencion(div);
    escribirIntencion(div, "Dividendos");
    await act(async () => (hojaIntencion(div).querySelector(".hoja-liga-acc.der") as HTMLButtonElement).click());
    expect(hojaIntencion(div).querySelector('[role="alert"]')?.textContent).toBe(texto);
    expect(hojaIntencion(div).open).toBe(true);
  });
it("cancelar cierra la hoja y vacía el texto", async () => {
  const { div } = await montar(); abrirIntencion(div);
  escribirIntencion(div, "  ");
  expect((hojaIntencion(div).querySelector(".hoja-liga-acc.der") as HTMLButtonElement).disabled).toBe(true);
  escribirIntencion(div, "Algo");
  pulsar(hojaIntencion(div).querySelector(".hoja-liga-acc:not(.der)"));
  expect(hojaIntencion(div).open).toBe(false);
  expect((div.querySelector("#idea-intencion-texto") as HTMLTextAreaElement).value).toBe("");
});
