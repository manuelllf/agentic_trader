"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { get } from "@/lib/api";
import { Marca } from "@/app/(liga)/_ui/Marca";
import { SECCIONES, SALAS, salaDe, seccionDe, type ClaveSeccion } from "./secciones";
import "./marco.css";

export function MarcoAdmin({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const ruta = usePathname() ?? "";
  const sala = salaDe(ruta);
  const seccion = seccionDe(ruta);
  const [cuentas, setCuentas] = useState<Partial<Record<ClaveSeccion, number>>>({});

  useEffect(() => {
    let vigente = true;
    get<{ pendientes: { seccion: string; cuantos: number }[] }>("/liga/admin/panel/resumen")
      .then(({ pendientes }) => {
        const siguientes: Partial<Record<ClaveSeccion, number>> = {};
        for (const pendiente of pendientes) {
          const clave = SECCIONES.find(s => s.clave === pendiente.seccion)?.clave;
          if (clave) siguientes[clave] = (siguientes[clave] ?? 0) + pendiente.cuantos;
        }
        if (vigente) setCuentas(siguientes);
      })
      .catch(() => { if (vigente) setCuentas({}); });
    return () => { vigente = false; };
  }, [ruta]);

  const enlace = (s: (typeof SECCIONES)[number]) => (
    <Link key={s.clave} href={s.href} className={seccion === s.clave ? "on" : undefined}
      aria-current={seccion === s.clave ? "page" : undefined}>
      {t(`admin_marco_${s.clave}`)}
      {cuentas[s.clave] ? <span className="cuenta num">{cuentas[s.clave]}</span> : null}
    </Link>
  );

  return (
    <div className="adm">
      <nav className="adm-rail" aria-label={t("admin_marco_salas")}>
        <div className="adm-marca"><Marca /><span>{t("admin_marco_admin")}</span></div>
        <p>{t("admin_marco_salas")}</p>
        {SALAS.map(s => <Fragment key={s.clave}>
          <Link href={s.href} className={`sala${sala === s.clave ? " on" : ""}`}>{s.nombre}</Link>
          {s.clave === "vennett" && sala === "vennett" && <div className="sub">{SECCIONES.map(enlace)}</div>}
        </Fragment>)}
      </nav>
      <header className="adm-top">
        <div className="adm-top-a"><div className="adm-marca"><Marca /><span>{t("admin_marco_admin")}</span></div></div>
        <nav className="adm-salas-m" aria-label={t("admin_marco_salas")}>
          {SALAS.map(s => <Link key={s.clave} href={s.href} className={sala === s.clave ? "on" : undefined}>{s.nombre}</Link>)}
        </nav>
        {sala === "vennett" && <nav className="adm-tabs" aria-label={t("admin_marco_secciones")}>{SECCIONES.map(enlace)}</nav>}
      </header>
      <div className="adm-cuerpo">{children}</div>
    </div>
  );
}
