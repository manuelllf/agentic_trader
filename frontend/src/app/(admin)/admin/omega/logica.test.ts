import { describe, expect, it } from "vitest";
import {
  clasificarCandidatos, costePorLlamada, empatesPorFecha, listoParaGate, numeroTecleado, puedeReintentar, resultadoHistorial, separarAlertas,
} from "./logica";
import type { Candidato, Cuenta, Senal } from "./types";

const senal = (extra: Partial<Senal>): Senal => ({
  id: 1, ticker: "ANET", sector: "Tech", tipo: "zigzag", entry_date: "2026-11-10", entry_price: 100, ref_label: "pico_referencia", ref_price: 120,
  caida_pct: 16, resuelta: false, exit_date: null, ret: 5, motivo: null, dias: 3, estado: "nueva", gate_resultado: null, gate_detalle: "", ...extra,
});
const cand = (extra: Partial<Candidato>): Candidato => ({
  id: 1, ticker: "PLTR", nombre: "Palantir", fecha_evaluacion: "2026-11-10", filtro_sector_pass: null, filtro_sector_detalle: "", estadistica_pass: null,
  estadistica_detalle: "", gate_pass: null, gate_detalle: "", decision: "pendiente", decidido_por: "sistema", ...extra,
});

describe("logica de Omega", () => {
  it("separa alertas, posiciones y las que esperan el gate", () => {
    const r = separarAlertas([senal({ id: 1 }), senal({ id: 2, estado: "cuidado", gate_resultado: "pasa" }), senal({ id: 3, estado: "ejecutada", gate_resultado: "pasa" })]);
    expect(r.pendientes.map((s) => s.id)).toEqual([1, 2]);
    expect(r.posiciones.map((s) => s.id)).toEqual([3]);
    expect(r.sinGate.map((s) => s.id)).toEqual([1]);
  });

  it("agrupa los empates por fecha de entrada", () => {
    const g = empatesPorFecha([senal({ id: 1 }), senal({ id: 2 }), senal({ id: 3, entry_date: "2026-11-11" })]);
    expect(g.get("2026-11-10")).toHaveLength(2);
    expect(g.get("2026-11-11")).toHaveLength(1);
  });

  it("clasifica candidatos: por revisar, evaluados y listos para el gate", () => {
    const { porRevisar, evaluados, listos } = clasificarCandidatos([
      cand({ id: 1 }),
      cand({ id: 2, filtro_sector_pass: true, estadistica_pass: true }),
      cand({ id: 3, filtro_sector_pass: false, estadistica_pass: false }),
      cand({ id: 4, filtro_sector_pass: true, estadistica_pass: true, gate_pass: true }),
      cand({ id: 5, decision: "incorporado" }),
    ]);
    expect(porRevisar.map((c) => c.id)).toEqual([1, 2]);
    expect(evaluados.map((c) => c.id)).toEqual([3, 4]);
    expect(listos.map((c) => c.id)).toEqual([2]);
  });

  it("solo deja reintentar los filtros antes del gate y cuando ya se comprobaron", () => {
    expect(puedeReintentar(cand({ filtro_sector_pass: false, estadistica_pass: false }))).toBe(true);
    expect(puedeReintentar(cand({}))).toBe(false);
    expect(puedeReintentar(cand({ filtro_sector_pass: true, estadistica_pass: true, gate_pass: true }))).toBe(false);
    expect(listoParaGate(cand({ filtro_sector_pass: true, estadistica_pass: true }))).toBe(true);
    expect(listoParaGate(cand({ filtro_sector_pass: true, estadistica_pass: true, gate_pass: false }))).toBe(false);
  });

  it("calcula el coste medio por llamada del gate", () => {
    const cuenta = (gastado: string, n: number) => ({ gate_gastado_usd: gastado, gate_llamadas: n }) as Cuenta;
    expect(costePorLlamada(cuenta("0.38", 61))).toBeCloseTo(0.00623, 4);
    expect(costePorLlamada(cuenta("0", 0))).toBeNull();
    expect(costePorLlamada(null)).toBeNull();
  });

  it("el resultado del historial va contra tu compra real y distingue la venta a mano", () => {
    const enCurso = resultadoHistorial(senal({ ejecucion: { acciones: 1, precio: 50, comision: 0, notas: "", ejecutada_at: "" } }), 55);
    expect(enCurso.enCurso).toBe(true);
    expect(enCurso.ret).toBeCloseTo(10);
    const manual = resultadoHistorial(senal({ estado: "vendida", cierre_manual: { acciones: 1, ret: 7, ret_sistema: 4, exit_date: null } }), null);
    expect(manual).toMatchObject({ cerradaAMano: true, enCurso: false, ret: 7, soloSistema: 4 });
    expect(resultadoHistorial(senal({ resuelta: true, ret: 9 }), 200).ret).toBe(9);
  });

  it("acepta coma decimal y rechaza lo que no es número", () => {
    expect(numeroTecleado("12,5")).toBe(12.5);
    expect(numeroTecleado(" 3 ")).toBe(3);
    expect(numeroTecleado("")).toBeNaN();
    expect(numeroTecleado("abc")).toBeNaN();
  });
});
