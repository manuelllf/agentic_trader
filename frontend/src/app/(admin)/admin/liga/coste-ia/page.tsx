"use client";

// Panel de coste de IA (plan §10.5 y §16, F6): por finalidad y mes, lo que pagamos (llm_call.cost_usd)
// contra lo que cobramos (créditos liquidados a dólares) — cifras contadas, no estimadas.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";

type FilaCoste = {
  finalidad: "conversor" | "pregunta" | "lectura";
  pagado_usd: string; cobrado_usd: string; llamadas: number; cache_hits: number;
  ratio: string | null; bajo_objetivo: boolean;
};
type CosteIA = {
  mes: string; filas: FilaCoste[]; total_pagado_usd: string; total_cobrado_usd: string;
  tope_mensual_usd: string | null; margen_objetivo: string;
};

const ETIQUETA: Record<string, string> = {
  conversor: "Conversor", pregunta: "Pregunta", lectura: "Lectura a fondo",
};
const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");
const mesActual = () => new Date().toISOString().slice(0, 7);
const dolares = (v: string) => `$${Number(v).toFixed(4)}`;

function CosteIAPanel() {
  const [mes, setMes] = useState(mesActual());
  const [datos, setDatos] = useState<CosteIA | null>(null);
  const [fallo, setFallo] = useState("");

  // Solo vale la última petición lanzada: una respuesta lenta de otro mes no pisa a la nueva.
  const ultima = useRef(0);
  const cargar = useCallback((m: string) => {
    setDatos(null); setFallo("");
    const n = ++ultima.current;
    get<CosteIA>(`/liga/admin/coste-ia?mes=${m}`)
      .then((r) => { if (n === ultima.current) setDatos(r); })
      .catch((e) => { if (n === ultima.current) setFallo(error(e)); });
  }, []);
  useEffect(() => cargar(mes), [cargar, mes]);

  const gastoAlto = datos?.tope_mensual_usd != null
    && Number(datos.total_pagado_usd) >= Number(datos.tope_mensual_usd) * 0.8;

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>← Liguilla</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Coste de IA</h1>

      <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
             className="mt-3 min-h-[44px] rounded-lg border px-3 text-white"
             style={{ background: "#141413", borderColor: "#303030" }} />

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!datos ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>
      ) : (
        <>
          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <p className="text-white">
              Pagado: <b>{dolares(datos.total_pagado_usd)}</b> · Cobrado: <b>{dolares(datos.total_cobrado_usd)}</b>
            </p>
            <p className="mt-1" style={{ color: gastoAlto ? "#e6a667" : "#898781" }}>
              Tope mensual: {datos.tope_mensual_usd != null ? dolares(datos.tope_mensual_usd) : "sin fijar"}
              {gastoAlto && " · por encima del 80 %"}
            </p>
            <p className="mt-1" style={{ color: "#898781" }}>Margen objetivo: ×{datos.margen_objetivo}</p>
          </section>

          <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
            {datos.filas.map((f) => (
              <li key={f.finalidad} className="border-b py-3" style={{ borderColor: "#303030" }}>
                <div className="flex items-baseline justify-between">
                  <span className="font-bold text-white">{ETIQUETA[f.finalidad]}</span>
                  {f.bajo_objetivo && (
                    <span className="text-[11.5px]" style={{ color: "#e66767" }}>bajo objetivo</span>
                  )}
                </div>
                <p className="mt-1" style={{ color: "#898781" }}>
                  Pagado {dolares(f.pagado_usd)} · Cobrado {dolares(f.cobrado_usd)}
                  {f.ratio != null && ` · ratio ×${Number(f.ratio).toFixed(2)}`}
                </p>
                <p className="mt-0.5 text-[11.5px]" style={{ color: "#67665f" }}>
                  {f.llamadas} llamadas · {f.cache_hits} de caché
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

export default function CosteIAAdmin() {
  return (
    <AuthGate>
      <CosteIAPanel />
    </AuthGate>
  );
}
