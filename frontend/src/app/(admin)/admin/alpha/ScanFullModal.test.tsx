// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ScanFull } from "@/lib/api";
import { ScanFullButton } from "./ScanFullModal";

const { getScanFull } = vi.hoisted(() => ({ getScanFull: vi.fn() }));
vi.mock("@/lib/api", () => ({ getScanFull }));
vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => (key: string) => key }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

it("marca solo los finalistas con filtro explícitamente falso", async () => {
  const scan: ScanFull = {
    at: "2026-10-13T10:00:00Z", cadence: "decisión/full", decide: true,
    regime: "", vix: null, outlook: "", universe: null, counters: {}, cost: null, issues: [],
    construction: { summary: "", cash_pct: 100, items: [], omitted: [] },
    finalists: [false, true, null].map((pasa_filtro_tecnico, i) => ({
      ticker: ["BTC-USD", "AAA", "OLD"][i], pasa_filtro_tecnico,
      sector: "", prescore: 90, price: null, market_cap: null, mid_score: null,
      deep_score: 90, high_52w: null, headline: null, selected: false, funded: false,
      weight_pct: null, error: null,
    })),
  };
  getScanFull.mockResolvedValue({ scan });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ScanFullButton)));
  await act(async () => host!.querySelector("button")!.click());
  const marcas = host.querySelectorAll(".alpha-scan-fuera-filtro");
  expect(marcas).toHaveLength(1);
  expect(marcas[0].textContent).toBe("alpha_scan_fuera_filtro");
  expect(marcas[0].closest("tr")?.textContent).toContain("BTC-USD");
});
