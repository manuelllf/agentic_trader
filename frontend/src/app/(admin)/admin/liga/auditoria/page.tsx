"use client";

// Auditoría: rastro paginado, filtrable por prefijo de acción (p. ej. «admin.» o «liga.»).

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";

type Entrada = {
  id: number; actor_id: string | null; accion: string; objeto: string | null;
  detalle: Record<string, unknown>; creada: string;
};
type ListaAuditoria = { total: number; filas: Entrada[] };

const CUANTOS = 50;
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Auditoria() {
  const t = useTranslations();
  const locale = useLocale();
  const CUANDO = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [prefijo, setPrefijo] = useState("");
  const [buscando, setBuscando] = useState("");
  const [desde, setDesde] = useState(0);
  const [lista, setLista] = useState<ListaAuditoria | null>(null);
  const [fallo, setFallo] = useState("");

  // Solo vale la última petición lanzada: una respuesta lenta anterior no pisa a la nueva.
  const ultima = useRef(0);
  const cargar = useCallback((p: string, d: number) => {
    setFallo("");
    const n = ++ultima.current;
    const q = new URLSearchParams({ accion_prefix: p, desde: String(d), cuantos: String(CUANTOS) });
    get<ListaAuditoria>(`/liga/admin/auditoria?${q.toString()}`)
      .then((r) => { if (n === ultima.current) setLista(r); })
      .catch((e) => { if (n === ultima.current) setFallo(errorText(e)); });
  }, [errorText]);
  useEffect(() => { cargar(buscando, desde); }, [cargar, buscando, desde]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    setDesde(0); setBuscando(prefijo.trim());
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_back_vennett")}</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_audit_title")}</h1>

      <form onSubmit={buscar} className="mt-4 flex gap-2">
        <input value={prefijo} onChange={(e) => setPrefijo(e.target.value)}
               placeholder={t("admin_audit_prefix_placeholder")}
               className="min-h-[44px] flex-1 rounded-lg border px-3 text-white"
               style={{ background: "#141413", borderColor: "#303030" }} />
        <button type="submit"
                className="min-h-[44px] rounded-lg px-4 font-bold text-white"
                style={{ background: "#3987e5" }}>
          {t("admin_audit_filter")}
        </button>
      </form>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!lista ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>
      ) : (
        <>
          <p className="mt-4" style={{ color: "#898781" }}>{t("admin_audit_entries", { count: new Intl.NumberFormat(locale).format(lista.total) })}</p>
          <ul className="mt-2 border-t" style={{ borderColor: "#303030" }}>
            {lista.filas.map((e) => (
              <li key={e.id} className="border-b py-2" style={{ borderColor: "#303030" }}>
                <div className="flex justify-between gap-2">
                  <span className="text-white">{e.accion}</span>
                  <span style={{ color: "#67665f" }}>{CUANDO.format(new Date(e.creada))}</span>
                </div>
                {e.objeto && <p style={{ color: "#898781" }}>{e.objeto}</p>}
                {Object.keys(e.detalle ?? {}).length > 0 && (
                  <pre className="mt-1 overflow-auto rounded p-2 text-[11px]"
                       style={{ background: "#141413", color: "#898781" }}>
                    {JSON.stringify(e.detalle, null, 2)}
                  </pre>
                )}
              </li>
            ))}
            {lista.filas.length === 0 && <li className="py-4" style={{ color: "#898781" }}>{t("admin_audit_empty")}</li>}
          </ul>
          <div className="mt-4 flex justify-between gap-2">
            <button type="button" disabled={desde === 0}
                    onClick={() => setDesde(Math.max(0, desde - CUANTOS))}
                    className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                    style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
              {t("admin_previous")}
            </button>
            <button type="button" disabled={desde + CUANTOS >= lista.total}
                    onClick={() => setDesde(desde + CUANTOS)}
                    className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                    style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
              {t("admin_next")}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

export default function AuditoriaAdmin() {
  return (
    <AuthGate>
      <Auditoria />
    </AuthGate>
  );
}
