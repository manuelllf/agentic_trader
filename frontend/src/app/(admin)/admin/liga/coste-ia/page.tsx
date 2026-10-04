"use client";

// Panel de coste de IA (plan §10.5 y §16, F6): por finalidad y mes, lo que pagamos (llm_call.cost_usd)
// contra lo que cobramos (créditos liquidados a dólares) — cifras contadas, no estimadas.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const mesActual = () => new Date().toISOString().slice(0, 7);
const dolares = (v: string) => `$${Number(v).toFixed(4)}`;

function CosteIAPanel() {
  const t = useTranslations();
  const locale = useLocale();
  const currency = (v: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(v));
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const etiquetas: Record<string, string> = { conversor: t("admin_cost_converter"), pregunta: t("admin_cost_question"), lectura: t("admin_cost_reading") };
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
      .catch((e) => { if (n === ultima.current) setFallo(errorText(e)); });
  }, [errorText]);
  useEffect(() => cargar(mes), [cargar, mes]);

  const gastoAlto = datos?.tope_mensual_usd != null
    && Number(datos.total_pagado_usd) >= Number(datos.tope_mensual_usd) * 0.8;

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_back_vennett")}</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_cost_title")}</h1>

      <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
             className="mt-3 min-h-[44px] rounded-lg border px-3 text-white"
             style={{ background: "#141413", borderColor: "#303030" }} />

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!datos ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>
      ) : (
        <>
          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <p className="text-white">
              {t("admin_cost_paid_total")} <b>{currency(datos.total_pagado_usd)}</b> · {t("admin_cost_received_total")} <b>{currency(datos.total_cobrado_usd)}</b>
            </p>
            <p className="mt-1" style={{ color: gastoAlto ? "#e6a667" : "#898781" }}>
              {t("admin_cost_monthly_cap")} {datos.tope_mensual_usd != null ? currency(datos.tope_mensual_usd) : t("admin_cost_monthly_cap_unset")}
              {gastoAlto && t("admin_cost_over_80")}
            </p>
            <p className="mt-1" style={{ color: "#898781" }}>{t("admin_cost_target_margin", { value: datos.margen_objetivo })}</p>
          </section>

          <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
            {datos.filas.map((f) => (
              <li key={f.finalidad} className="border-b py-3" style={{ borderColor: "#303030" }}>
                <div className="flex items-baseline justify-between">
                  <span className="font-bold text-white">{etiquetas[f.finalidad]}</span>
                  {f.bajo_objetivo && (
                    <span className="text-[11.5px]" style={{ color: "#e66767" }}>{t("admin_cost_below_target")}</span>
                  )}
                </div>
                <p className="mt-1" style={{ color: "#898781" }}>
                  {t("admin_cost_paid", { value: currency(f.pagado_usd) })} · {t("admin_cost_received", { value: currency(f.cobrado_usd) })}
                  {f.ratio != null && t("admin_cost_ratio", { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(f.ratio)) })}
                </p>
                <p className="mt-0.5 text-[11.5px]" style={{ color: "#67665f" }}>
                  {t("admin_cost_calls", { count: new Intl.NumberFormat(locale).format(f.llamadas), hits: new Intl.NumberFormat(locale).format(f.cache_hits) })}
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
