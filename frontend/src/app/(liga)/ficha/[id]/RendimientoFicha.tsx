"use client";

import { InfoTip } from "@/components/InfoTip";
import { useEffect, useRef, useState } from "react";
import type { RendimientoFicha as DatosRendimiento } from "@/lib/liga/api";
import { porcentaje } from "@/lib/liga/format";

const AYUDAS: Record<string, string> = {
  sharpe: "Relaciona rentabilidad y variación de la cartera. Un valor mayor indica más retorno por unidad de riesgo; referencia sin riesgo: 0 %.",
  sortino: "Relaciona rentabilidad con las caídas, en lugar de toda la variación. Objetivo mínimo: 0 %.",
  volatilidad: "Cuánto fluctúan sus retornos. Más alta implica cambios más bruscos; cifra anualizada.",
  drawdown: "La mayor caída desde un máximo previo de la curva, en el periodo mostrado.",
};

function fmt(valor: number | null, tipo: string): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return tipo === "pct" ? `${(valor * 100).toFixed(1).replace(".", ",")} %` : valor.toFixed(2).replace(".", ",");
}

function Gráfico({ puntos }: { puntos: DatosRendimiento["serie"] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(720);
  useEffect(() => {
    const elemento = contenedor.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => {
      setAncho(Math.max(240, entrada.contentRect.width));
    });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [puntos.length]);
  if (puntos.length < 2) return <p className="meta">Aún no hay sesiones suficientes para dibujar la curva.</p>;
  const W = ancho, H = 240, L = 42, R = 12, T = 12, B = 28;
  const vals = puntos.flatMap((p) => [p.estrategia, p.sp500]);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const pad = Math.max((max - min) * .12, 1);
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => L + i * (W - L - R) / (puntos.length - 1);
  const y = (v: number) => T + (hi - v) * (H - T - B) / (hi - lo);
  const path = (key: "estrategia" | "sp500", provisional: boolean) => {
    let previous = -2;
    return puntos.map((p, i) => {
      if (p.provisional !== provisional) { previous = -2; return ""; }
      const command = previous === i - 1 && !p.salto ? "L" : "M";
      previous = i;
      return `${command}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`;
    }).filter(Boolean).join(" ");
  };
  return (
    <div ref={contenedor} className="chart" role="img" aria-label="Curva de rentabilidad total de la estrategia comparada con el S&P 500">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[lo, (lo + hi) / 2, hi].map((v) => <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "zero" : "grid"} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(0)}%</text>
        </g>)}
        <path d={path("sp500", false)} className="sp" />
        <path d={path("sp500", true)} className="sp" />
        <path d={path("estrategia", false)} className="me" />
        <path d={path("estrategia", true)} className="me" style={{ strokeDasharray: "3 4", opacity: .75 }} />
        <text x={L} y={H - 5}>{puntos[0].dia}</text>
        <text x={W - R} y={H - 5} textAnchor="end">{puntos[puntos.length - 1].dia}</text>
      </svg>
      <div className="legend2"><span><i />Estrategia</span><span><i className="d" />S&amp;P 500</span></div>
    </div>
  );
}

export function RendimientoFicha({ datos, posiciones = [] }: {
  datos: DatosRendimiento | null | undefined;
  posiciones?: { ticker: string; peso: number }[];
}) {
  const posicionMaxima = posiciones.reduce((max, p) => Math.max(max, Number(p.peso)), 0);
  const pesoInvertido = posiciones.reduce((total, p) => total + Number(p.peso), 0);
  if (!datos) return null;
  if (datos.estado === "privado") return (
    <section className="sec">
      <div className="sec-t">Rendimiento diario</div>
      <p className="meta">La serie diaria está disponible para la persona propietaria y para cuentas Pro en estrategias publicadas.</p>
    </section>
  );
  if (datos.estado === "sin_datos" || !datos.serie.length) return (
    <section className="sec">
      <div className="sec-t">Rendimiento diario</div>
      <p className="meta">Aún no hay una base de cierres completa para calcular la curva y sus métricas.</p>
      {posiciones.length > 0 && <p className="fine">
        {posiciones.length} posiciones · mayor peso {posicionMaxima.toFixed(1).replace(".", ",")} % · efectivo {Math.max(0, 100 - pesoInvertido).toFixed(1).replace(".", ",")} %
        <InfoTip text="El peso de la mayor posición indica cuánto depende la cartera de una sola empresa. El efectivo es la parte sin invertir." />
      </p>}
    </section>
  );
  const m = datos.metricas;
  const ultimo = datos.serie[datos.serie.length - 1];
  const retorno = [
    ["Estrategia", ultimo.estrategia, "%"],
    ["S&P 500", ultimo.sp500, "%"],
    ["Diferencia", ultimo.estrategia - ultimo.sp500, " pp"],
  ] as const;
  return (
    <section className="sec">
      <div className="sec-t">Rendimiento total <InfoTip text="Curva recalculada con los cierres guardados, dividendos y splits; puede diferir del resultado oficial de una jornada. El mes abierto es provisional." /></div>
      <div className="mb-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
        {retorno.map(([label, value, unit]) => <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
          <div className="text-xs" style={{ color: "var(--muted)" }}>{label}{ultimo.provisional && label === "Estrategia" ? " · provisional" : ""}</div>
          <b className="num text-base">{unit === "%" ? porcentaje(value) : porcentaje(value).replace(/%$/, "pp")}</b>
        </div>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <Gráfico puntos={datos.serie} />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {([
            ["Caída máxima", m?.max_drawdown ?? null, "pct", AYUDAS.drawdown],
            ["Volatilidad anual", m?.volatilidad ?? null, "pct", AYUDAS.volatilidad],
          ] as const).map(([label, value, kind, help]) => (
            <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>{label}<InfoTip text={help} /></div>
              <b className="num text-base">{fmt(value, kind)}</b>
            </div>
          ))}
          {posiciones.length > 0 && <div className="col-span-2 grid grid-cols-3 gap-2 rounded-xl border px-3 py-2 lg:col-span-1 lg:grid-cols-1" style={{ borderColor: "var(--line)" }}>
            <div className="col-span-3 flex items-center gap-1 text-xs lg:col-span-1" style={{ color: "var(--muted)" }}>
              Distribución <InfoTip text="Cuántas posiciones tienes, el peso de la mayor y la parte sin invertir. Un peso alto en pocas empresas concentra el riesgo." />
            </div>
            <div><small className="block text-xs" style={{ color: "var(--muted)" }}>Posiciones</small><b className="num">{posiciones.length}</b></div>
            <div><small className="block text-xs" style={{ color: "var(--muted)" }}>Mayor peso</small><b className="num">{posicionMaxima.toFixed(1).replace(".", ",")} %</b></div>
            <div><small className="block text-xs" style={{ color: "var(--muted)" }}>Efectivo</small><b className="num">{Math.max(0, 100 - pesoInvertido).toFixed(1).replace(".", ",")} %</b></div>
          </div>}
          <p className="col-span-2 text-xs leading-relaxed lg:col-span-1" style={{ color: "var(--muted)" }}>
            {m && m.observaciones < 60
              ? `Faltan observaciones: ${m.observaciones} de 60 necesarias para Sharpe, Sortino y volatilidad.`
              : `${m?.observaciones ?? 0} retornos diarios observados.`}
          </p>
        </div>
      </div>
      <details className="more">
        <summary>Más métricas</summary>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["Sharpe", m?.sharpe ?? null, AYUDAS.sharpe],
            ["Sortino", m?.sortino ?? null, AYUDAS.sortino],
          ] as const).map(([label, value, help]) => (
            <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>{label}<InfoTip text={help} /></div>
              <b className="num text-base">{fmt(value, "ratio")}</b>
            </div>
          ))}
        </div>
      </details>
      <p className="fine">{datos.metodologia} {datos.provisional_hasta && `Provisional hasta ${datos.provisional_hasta}.`}</p>
      {datos.incompleta && <p className="fine">Hay sesiones sin cierre guardado o una jornada sin base/final completo. La curva señala los saltos y las métricas diarias excluyen esos intervalos.</p>}
    </section>
  );
}
