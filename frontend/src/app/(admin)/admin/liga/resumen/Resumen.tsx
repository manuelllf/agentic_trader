"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { destinoDe, nombreProceso, pasoClave, textoPendiente, titular, type Pendiente } from "./logica";

export type ResumenAdminOut = {
  pendientes: Pendiente[];
  proximo: { paso: "foto" | "formar" | "cerrar"; jornada: number; cuando: string; automatico: boolean } | null;
  vistazo: { cuentas: number; activas_7d: number; en_juego: number; tope_ia_pct: number | string | null };
};

export default function Resumen() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<ResumenAdminOut | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let activo = true;
    get<ResumenAdminOut>("/liga/admin/panel/resumen")
      .then(d => { if (activo) setDatos(d); })
      .catch(() => { if (activo) setFallo(true); });
    return () => { activo = false; };
  }, []);
  const numero = (n: number | string) => new Intl.NumberFormat(locale).format(Number(n));
  if (fallo) return <p role="alert" style={{ color: "#c3c2b7" }}>{t("admin_generic_error")}</p>;
  if (!datos) return <p role="status" style={{ color: "#898781" }}>{t("admin_loading")}</p>;
  const proximo = datos.proximo;
  const cifras = [
    { clave: "admin_resumen_cuentas", valor: numero(datos.vistazo.cuentas), href: "/admin/liga/analitica" },
    { clave: "admin_resumen_activas", valor: numero(datos.vistazo.activas_7d), href: "/admin/liga/analitica" },
    { clave: "admin_resumen_en_juego", valor: numero(datos.vistazo.en_juego), href: "/admin/liga/jornadas" },
    { clave: "admin_resumen_tope_ia", valor: datos.vistazo.tope_ia_pct === null ? t("admin_panel_vacio") : t("admin_panel_porcentaje", { n: numero(datos.vistazo.tope_ia_pct) }), href: "/admin/liga/coste-ia" },
  ];
  return <div className="admin-escritorio mx-auto max-w-md px-4 pb-16 pt-6 min-w-0 space-y-8 text-sm" style={{ background: "transparent", color: "#c3c2b7" }}>
    <h1 className="text-2xl">{t(...titular(datos.pendientes.length))}</h1>
    {datos.pendientes.length > 0 && <ul>
      {datos.pendientes.map((p, i) => {
        const texto = textoPendiente(p, id => {
          const clave = nombreProceso(id);
          return clave === id ? id : t(clave);
        });
        return <li key={`${p.tipo}-${i}`} className="border-b" style={{ borderColor: "#303030" }}>
          <Link href={destinoDe(p.seccion)} className="flex min-h-16 items-start gap-3 py-4">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: p.tipo === "proceso_fallido" ? "#e66767" : "#e6b85c" }} />
            <span><span className="block">{t(texto.clave, texto.valores)}</span>
              <span className="mt-1 block text-xs" style={{ color: "#898781" }}>{t("admin_resumen_ir", { seccion: t(`admin_marco_${p.seccion}`) })}</span>
            </span>
          </Link>
        </li>;
      })}
    </ul>}
    {proximo && <section className="space-y-2">
      <h2 className="font-semibold">{t("admin_resumen_proximo_titulo")}</h2>
      <p>{t("admin_resumen_proximo_frase", { paso: t(pasoClave(proximo.paso), { jornada: proximo.jornada }), jornada: numero(proximo.jornada) })}</p>
      <p style={{ color: "#898781" }}>{new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(proximo.cuando))}</p>
      <p style={{ color: "#898781" }}>{t(proximo.automatico ? "admin_resumen_auto" : "admin_resumen_manual")}</p>
    </section>}
    <section>
      <h2 className="mb-3 font-semibold">{t("admin_resumen_vistazo")}</h2>
      <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-4">
        {cifras.map(c => <Link key={c.clave} href={c.href} className="min-w-0 rounded-lg border p-3" style={{ borderColor: "#303030" }}>
          <span className="block text-2xl tabular-nums">{c.valor}</span>
          <span className="mt-1 block text-xs" style={{ color: "#898781" }}>{t(c.clave)}</span>
        </Link>)}
      </div>
    </section>
  </div>;
}
