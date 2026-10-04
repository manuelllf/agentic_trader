"use client";

// Moderación: reportes pendientes y «Ocultar» (plan §14). No hay ruta de descarte en la API
// (solo listar y ocultar), así que aquí solo se ofrece ocultar.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Reporte = {
  id: number; autor_id: string | null; tipo: "alias" | "estrategia" | "liga" | "pregunta";
  objeto_id: string; motivo: string; estado: string; creado: string; contenido: string | null;
};
type ListaReportes = { total: number; filas: Reporte[] };

const CUANTOS = 50;
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Moderacion() {
  const t = useTranslations();
  const locale = useLocale();
  const CUANDO = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const labels: Record<Reporte["tipo"], string> = { alias: t("admin_moderation_alias"), estrategia: t("admin_moderation_strategy"), liga: t("admin_moderation_league"), pregunta: t("admin_moderation_question") };
  const confirmations: Record<Reporte["tipo"], string> = { alias: t("admin_moderation_confirm_alias"), estrategia: t("admin_moderation_confirm_strategy"), liga: t("admin_moderation_confirm_league"), pregunta: t("admin_moderation_confirm_question") };
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [lista, setLista] = useState<ListaReportes | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(() => {
    setFallo("");
    get<ListaReportes>(`/liga/moderacion/reportes?cuantos=${CUANTOS}`)
      .then(setLista).catch((e) => setFallo(errorText(e)));
  }, [errorText]);
  useEffect(cargar, [cargar]);

  const ocultar = async (r: Reporte) => {
    if (!window.confirm(t("admin_moderation_confirm_hide", { item: confirmations[r.tipo] }))) return;
    setOcupado(r.id); setFallo("");
    try {
      await post("/liga/moderacion/ocultar", { reporte_id: r.id });
      cargar();
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(null); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_back_vennett")}</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_moderation_title")}</h1>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!lista ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>
      ) : lista.filas.length === 0 ? (
        <p className="mt-6" style={{ color: "#898781" }}>{t("admin_moderation_empty")}</p>
      ) : (
        <>
        {lista.total > lista.filas.length && (
          <p className="mt-4" style={{ color: "#e6a667" }}>
            {t("admin_moderation_count", { total: new Intl.NumberFormat(locale).format(lista.total), shown: new Intl.NumberFormat(locale).format(lista.filas.length) })}
          </p>
        )}
        <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
          {lista.filas.map((r) => (
            <li key={r.id} className="border-b py-3" style={{ borderColor: "#303030" }}>
              <p style={{ color: "#898781" }}>{labels[r.tipo]}</p>
              <p className="mt-1 break-words text-[15px] text-white">
                {r.contenido ?? t("admin_moderation_missing")}
              </p>
              <p className="mt-1" style={{ color: "#898781" }}>{t("admin_moderation_reason", { reason: r.motivo })}</p>
              <p className="mt-1 text-[11.5px]" style={{ color: "#67665f" }}>
                {CUANDO.format(new Date(r.creado))}
              </p>
              <button type="button" disabled={ocupado === r.id} onClick={() => ocultar(r)}
                      className="mt-2 min-h-[40px] rounded-lg px-3 font-bold text-white disabled:opacity-40"
                      style={{ background: "#7a2020" }}>
                {t("admin_moderation_hide")}
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </main>
  );
}

export default function ModeracionAdmin() {
  return (
    <AuthGate>
      <Moderacion />
    </AuthGate>
  );
}
