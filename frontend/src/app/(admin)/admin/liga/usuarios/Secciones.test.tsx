// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import mensajes from "../../../../../../messages/es/admin.json";
import { Actividad, type Historial } from "./Actividad";
import { CosteIA } from "./CosteIA";
import { Ficha } from "./Ficha";
import { LigaEstrategias } from "./LigaEstrategias";
import type { DiasPanel, FichaPanel } from "./panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; });

async function montar(contenido: ReactNode) {
  const div = document.createElement("div");
  root = createRoot(div);
  await act(async () => root?.render(
    <NextIntlClientProvider locale="es" messages={mensajes}>
      {contenido}
    </NextIntlClientProvider>,
  ));
  return div;
}

function cuenta(): FichaPanel {
  return {
    id: "usuario-ana", alias: "ana", email: null, oculto: false, creado: "2025-01-02T10:00:00Z",
    roles: ["usuario"], suspendido: false, plan: "gratis", plan_hasta: null,
    pase_liga: false, pase_hasta: null, saldo: "1.0000",
    edad: null, edad_declarada_en: null, baja_solicitada: null,
    terminos: { version: "1", aceptado: true, aceptado_en: "2025-01-02T10:00:00Z" },
    actividad: {
      visitas_total: 24, visitas_7d: 8, ultima_visita: "2025-02-14T10:00:00Z",
      ultima_actividad: "2025-02-14T10:15:00Z", tiempo_30d_seg: 4500,
    },
    ia: {
      mes: {
        total_usd: "0.0084", llamadas: 3, cache: 2,
        conversor_usd: "0.0010", conversor_llamadas: 1,
        pregunta_usd: "0.0030", pregunta_llamadas: 1, cobrado_pregunta_usd: "0.0100",
        lectura_usd: "0.0044", lectura_llamadas: 1, cobrado_lectura_usd: "0.0200",
        cobrado_usd: "0.0300",
      },
      historico_usd: "0.0120",
    },
    liga: {
      estrategias: 2, estrategias_jugando: 1, inscripciones: 3,
      ligas_propias: 1, ligas_miembro: 2, reportes_hechos: 0, reportes_recibidos: 1,
    },
  };
}

const dias: DiasPanel["dias"] = [0, 1, 0, 0, 2, 0, 0, 3, 1, 0, 0, 2, 4, 1].map((visitas, i) => ({
  dia: `2025-02-${String(i + 1).padStart(2, "0")}`, visitas,
}));

it("muestra dolares con cuatro decimales y llamadas en singular y plural", async () => {
  const div = await montar(<CosteIA ia={cuenta().ia} />);
  expect(div.textContent).toContain("0,0084");
  expect(div.textContent).toContain("3 llamadas");
  expect(div.querySelector(".admin-par")?.textContent).toContain("1 llamada");
});

it("mantiene las seis filas de IA cuando no hay llamadas", async () => {
  const ia: FichaPanel["ia"] = {
    mes: {
      total_usd: "0", llamadas: 0, cache: 0,
      conversor_usd: "0", conversor_llamadas: 0,
      pregunta_usd: "0", pregunta_llamadas: 0, cobrado_pregunta_usd: "0",
      lectura_usd: "0", lectura_llamadas: 0, cobrado_lectura_usd: "0", cobrado_usd: "0",
    },
    historico_usd: "0",
  };
  const div = await montar(<CosteIA ia={ia} />);
  expect(div.querySelectorAll(".admin-par")).toHaveLength(6);
  expect(div.textContent).toContain("0 llamadas");
  expect(div.textContent).toContain("0,0000");
});

it("muestra el texto de email ausente", async () => {
  const div = await montar(<Ficha ficha={cuenta()} />);
  expect(div.textContent).toContain("sin email");
});

it("muestra el email y la edad declarada", async () => {
  const ficha: FichaPanel = { ...cuenta(), email: "ana@ejemplo.com", edad: 34, edad_declarada_en: "2025-01-02" };
  const div = await montar(<Ficha ficha={ficha} />);
  expect(div.textContent).toContain("ana@ejemplo.com");
  expect(div.textContent).toContain("34");
});

it("deja vacia la fecha de declaracion si falta", async () => {
  const ficha: FichaPanel = { ...cuenta(), edad: 34, edad_declarada_en: null };
  const div = await montar(<Ficha ficha={ficha} />);
  expect(div.querySelectorAll(".admin-par")[1].textContent).toContain("34 · desde el ");
});

it("muestra las estrategias propias y jugando", async () => {
  const div = await montar(<LigaEstrategias liga={cuenta().liga} />);
  expect(div.textContent).toContain("2 · 1 jugando");
});

it("dibuja los catorce dias y anuncia el total con el mensaje existente", async () => {
  const div = await montar(<Actividad actividad={cuenta().actividad} dias={dias} historial={null} desde={0} onPagina={vi.fn()} />);
  expect(div.querySelectorAll("svg rect")).toHaveLength(14);
  expect(div.querySelector("svg")?.getAttribute("aria-label"))
    .toBe(mensajes.admin_panel_chart_aria.replace("{total}", "14"));
  expect(div.textContent).toContain(mensajes.admin_loading);
});

it("dibuja alturas cero si no hay visitas", async () => {
  const vacios: DiasPanel["dias"] = dias.map(dia => ({ ...dia, visitas: 0 }));
  const historial: Historial = { total: 0, filas: [] };
  const div = await montar(<Actividad actividad={cuenta().actividad} dias={vacios} historial={historial} desde={0} onPagina={vi.fn()} />);
  expect(div.querySelectorAll("svg rect")).toHaveLength(14);
  expect(Array.from(div.querySelectorAll("svg rect"), rect => rect.getAttribute("height"))).toEqual(Array(14).fill("0"));
  expect(div.textContent).toContain(mensajes.admin_user_history_empty);
});

it("pagina el historial de diez en diez y desactiva el avance al final", async () => {
  const onPagina = vi.fn();
  const historial: Historial = {
    total: 21, filas: [{ inicio: "2025-02-14T10:00:00Z", ultima_actividad: "2025-02-14T10:15:00Z" }],
  };
  const div = await montar(<Actividad actividad={cuenta().actividad} dias={dias} historial={historial} desde={10} onPagina={onPagina} />);
  const botones = div.querySelectorAll("button");
  expect(div.textContent).toContain("11 a 20 de 21");
  act(() => botones[0].click());
  act(() => botones[1].click());
  expect(onPagina.mock.calls).toEqual([[0], [20]]);
  await act(async () => root?.render(
    <NextIntlClientProvider locale="es" messages={mensajes}>
      <Actividad actividad={cuenta().actividad} dias={dias} historial={historial} desde={20} onPagina={onPagina} />
    </NextIntlClientProvider>,
  ));
  expect(div.querySelectorAll("button")[1].disabled).toBe(true);
});
