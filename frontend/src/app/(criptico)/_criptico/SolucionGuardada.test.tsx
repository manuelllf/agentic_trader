// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/criptico/api";
import type { Acertijo, Detalle } from "@/lib/criptico/tipos";
import es from "../../../../messages/es/criptico.json";
import { traductor } from "./textos";
import Juego from "./Juego";
import SolucionGuardada from "./SolucionGuardada";

vi.mock("@/lib/criptico/api", () => ({
  comprobar: vi.fn(), resuelto: vi.fn(), solucion: vi.fn(), letra: vi.fn(), numero: vi.fn(), suscribir: vi.fn(), indice: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ ApiError: class extends Error { status = 404; } }));

const a: Acertijo = { id: 7, numero: 12, idioma: "es", fecha: "2026-11-13", nivel: "media", longitud: 6,
  pista: [{ texto: "Ruegos ", papel: "mat" }, { texto: "alocados ", papel: "ind" }, { texto: "por una póliza", papel: "def" }],
  ayudas: { def: "Póliza", ind: "Anagrama", mat: "Ruegos" }, media: null, n_media: null };
const detalle: Detalle = { respuesta: "SEGURO", palabra: "seguro", resolucion: "RUEGOS alocados = SEGURO",
  concepto: "Contrato que cubre un riesgo.", ejemplo: "Un seguro de hogar.", regla_catalogo: null };
const t = traductor("es", es);

describe("Solución guardada de un día pasado", () => {
  it("va en el HTML del servidor, plegada, con la respuesta y la explicación", () => {
    const html = renderToString(<SolucionGuardada acertijo={a} detalle={detalle} t={t} />).replaceAll("<!-- -->", "");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    for (const texto of ["Solución y explicación", "Con la respuesta", "SEGURO", "(6)", "La pista, desmontada",
      "RUEGOS alocados = SEGURO", "Qué es «seguro»", "Contrato que cubre un riesgo.", "Un seguro de hogar."]) expect(html).toContain(texto);
  });

  describe("dentro del juego", () => {
    let root: Root;
    let nodo: HTMLDivElement;
    beforeEach(() => {
      vi.resetAllMocks();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
      localStorage.clear();
      nodo = document.createElement("div"); document.body.append(nodo); root = createRoot(nodo);
      vi.mocked(api.indice).mockResolvedValue([]);
      vi.mocked(api.solucion).mockResolvedValue({ detalle });
    });
    afterEach(async () => { await act(async () => { root.unmount(); }); nodo.remove(); vi.unstubAllGlobals(); });

    it("sale en los días pasados, no en el de hoy, y desaparece al ver la solución", async () => {
      await act(async () => { root.render(<Juego acertijo={a} textos={es} detalle={detalle} ultimoNumero={16} />); });
      expect(nodo.querySelector("details.cr-solucion")).not.toBeNull();
      await act(async () => { root.render(<Juego acertijo={{ ...a, id: 8, numero: 16 }} textos={es} ultimoNumero={16} />); });
      expect(nodo.querySelector("details.cr-solucion")).toBeNull();
      await act(async () => { root.render(<Juego acertijo={a} textos={es} detalle={detalle} ultimoNumero={16} />); });
      const ver = [...nodo.querySelectorAll("button")].find(b => b.textContent === "Ver la solución")!;
      await act(async () => { ver.click(); });
      expect(nodo.querySelector("details.cr-solucion")).toBeNull();
      expect(nodo.textContent).toContain("Solución vista");
      expect(nodo.textContent).toContain("Contrato que cubre un riesgo.");
    });

    it("el pie del juego y el archivo de la cabecera son enlaces", async () => {
      await act(async () => { root.render(<Juego acertijo={a} textos={es} ultimoNumero={16} />); });
      expect(nodo.querySelector('a.cr-icono')?.getAttribute("href")).toBe("/criptico/archivo");
      expect(nodo.querySelector('a.cr-icono')?.hasAttribute("aria-current")).toBe(false);
      expect([...nodo.querySelectorAll("footer a")].map(x => x.getAttribute("href")))
        .toEqual(["/quienes-somos", "/politica-editorial", "/legal/aviso", "/legal/privacidad", "/legal/cookies"]);
    });
  });
});
