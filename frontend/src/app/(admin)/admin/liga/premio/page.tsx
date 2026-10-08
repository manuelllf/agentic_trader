"use client";

// Premio anual: el reparto de cada temporada cerrada, con el correo de quien cobra para contactarla
// y verificar su identidad. El pago queda fuera del producto. Un botón de reserva por si el cálculo
// automático falló; el normal corre solo al cerrar la última jornada.

import Link from "next/link";
import { useConfirmar } from "@/components/Confirmar";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Temporada = { id: number; nombre: string; estado: string; calculado: boolean;
                   escalon: number | null; elegibles: number };
type Fila = { cuenta: string; alias: string; jornadas_jugadas: number; rentabilidad: string;
              puesto: number | null; importe: string | null; email: string | null };
type Estado = { temporadas: Temporada[]; temporada_id: number | null; umbral_basico: number;
                umbral_completo: number; visible: boolean; filas: Fila[] };

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Premio() {
  const t = useTranslations();
  const { confirmar, dialogo } = useConfirmar();
  const locale = useLocale();
  const euros = (v: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(v));
  const porcentaje = (v: string) => `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))} %`;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback((temporadaId?: number) => {
    setFallo("");
    const ruta = temporadaId ? `?temporada_id=${temporadaId}` : "";
    get<Estado>(`/liga/admin/procesos/premio/estado${ruta}`).then(setEstado)
      .catch((e) => setFallo(error(e, t("admin_generic_error"))));
  }, [t]);
  useEffect(() => cargar(), [cargar]);

  const calcular = async (id: number) => {
    if (!(await confirmar({ titulo: t("admin_prize_confirm_calculate"), aceptar: t("common_confirmar") }))) return;
    setOcupado(true); setFallo("");
    try {
      await post(`/liga/admin/procesos/premio/ejecutar`, { temporada_id: id });
      cargar(id);
    } catch (e) { setFallo(error(e, t("admin_generic_error"))); } finally { setOcupado(false); }
  };

  const elegida = estado?.temporadas.find((x) => x.id === estado.temporada_id);
  const cierrePendiente = estado?.temporadas.filter((x) => x.estado === "cerrada" && !x.calculado) ?? [];

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_prize_back")}</Link>
      <h1 className="mt-3 text-[19px] text-white" style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>
        {t("admin_prize_title")}
      </h1>
      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!estado ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>
      ) : (
        <>
          <p className="mt-1" style={{ color: "#898781" }}>
            {t("admin_prize_thresholds", { basic: estado.umbral_basico, full: estado.umbral_completo })}
            {" "}{estado.visible ? t("admin_prize_visible_on") : t("admin_prize_visible_off")}
          </p>

          {cierrePendiente.map((x) => (
            <section key={x.id} className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
              <p>{t("admin_prize_pending", { name: x.nombre })}</p>
              <button type="button" disabled={ocupado} onClick={() => calcular(x.id)}
                      className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#3987e5" }}>
                {t("admin_prize_calculate")}
              </button>
            </section>
          ))}

          {estado.temporadas.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {estado.temporadas.map((x) => (
                <button key={x.id} type="button" onClick={() => cargar(x.id)}
                        className="min-h-[40px] rounded-lg px-3 py-2 font-bold text-white"
                        style={{ background: x.id === estado.temporada_id ? "#3987e5" : "#2c2c2a" }}>
                  {x.nombre}
                </button>
              ))}
            </div>
          )}

          {!elegida || !elegida.calculado ? (
            <p className="mt-6" style={{ color: "#898781" }}>{t("admin_prize_none")}</p>
          ) : (
            <section className="mt-4">
              <h2 className="font-bold text-white">{elegida.nombre}</h2>
              <p className="mt-1" style={{ color: "#898781" }}>
                {t("admin_prize_summary", { eligible: elegida.elegibles, tier: elegida.escalon ?? 0 })}
              </p>
              <ul className="mt-3 border-t" style={{ borderColor: "#303030" }}>
                {estado.filas.map((f) => (
                  <li key={f.cuenta} className="border-b py-2" style={{ borderColor: "#303030" }}>
                    <p className="text-white">
                      {f.puesto ? `${f.puesto}.º · ` : ""}{f.alias}
                      {f.importe && <span className="ml-2 font-bold" style={{ color: "#9be0b3" }}>{euros(f.importe)}</span>}
                    </p>
                    <p style={{ color: "#898781" }}>
                      {porcentaje(f.rentabilidad)} · {t("admin_prize_rounds", { count: f.jornadas_jugadas })}
                      {f.email && ` · ${f.email}`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {dialogo}
    </main>
  );
}

export default function PremioAdmin() {
  return (
    <AuthGate>
      <Premio />
    </AuthGate>
  );
}
