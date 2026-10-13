// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CarteraViva } from "./CarteraViva";
vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => (k: string) => k }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("resalta entradas y tacha salidas durante seis segundos", () => {
  vi.useFakeTimers();
  const div = document.createElement("div"), root = createRoot(div);
  try {
    act(() => root.render(<CarteraViva elegidas={[{ ticker: "A", nombre: "Nueva", peso: 20 }]} pasan={10} huecos={1} entran={["A"]} salen={[{ ticker: "B", nombre: "Anterior", peso: 20 }]} />));
    expect(div.querySelector(".entra")?.textContent).toContain("Nueva");
    expect(div.querySelector(".sale s")?.textContent).toBe("B");
    expect(div.querySelector(".hueco")).not.toBeNull();
    act(() => vi.advanceTimersByTime(5999));
    expect(div.querySelector(".sale")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(div.querySelector(".sale")).toBeNull();
    expect(div.querySelector(".entra")).toBeNull();
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});
