// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useDeshacer } from "./useDeshacer";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("restaura una copia independiente del borrador y agrupa un arrastre", () => {
  let hook!: ReturnType<typeof useDeshacer>;
  function Prueba() { hook = useDeshacer(); return null; }
  const root = createRoot(document.createElement("div"));
  const b = { reglas: [{ clave: "regla", params: { minimo: 10 } }], pesos: { negocio: 20 }, n_empresas: 5, reparto: "igual", max_por_sector: 2, excluidas: ["A"] };
  try {
    act(() => root.render(<Prueba />));
    act(() => hook.guardar(b));
    b.reglas[0].params.minimo = 99;
    let copia: ReturnType<typeof hook.recuperar>;
    act(() => { copia = hook.recuperar(); });
    expect(copia!).toEqual({ ...b, reglas: [{ clave: "regla", params: { minimo: 10 } }] });
    expect(hook.disponible).toBe(false);
    act(() => hook.iniciar(b));
    act(() => hook.guardar({ ...b, n_empresas: 6 }));
    act(() => hook.terminar({ ...b, n_empresas: 8 }));
    act(() => { copia = hook.recuperar(); });
    expect(copia!.n_empresas).toBe(5);
    act(() => { hook.iniciar(b); hook.terminar(b); });
    expect(hook.disponible).toBe(false);
  } finally { act(() => root.unmount()); }
});
