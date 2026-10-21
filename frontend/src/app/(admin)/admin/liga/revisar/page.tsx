"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { Pagina, Segmentos } from "../../_marco/ui";
import { Errores } from "./Errores";
import { Moderacion } from "./Moderacion";

function Revisar() {
  const t = useTranslations();
  const router = useRouter();
  const parametros = useSearchParams();
  const original = parametros.get("vista");
  const vista = original === "moderacion" || original === "reportes" ? "reportes" : original === "resueltos" ? "resueltos" : "errores";
  const [errores, setErrores] = useState<number>();
  const [reportes, setReportes] = useState<number>();
  useEffect(() => {
    let vigente = true;
    get<{ total: number }>("/liga/admin/errores?estado=abierto&cuantos=50").then(r => { if (vigente) setErrores(r.total); }).catch(() => {});
    get<{ total: number }>("/liga/moderacion/reportes?cuantos=50").then(r => { if (vigente) setReportes(r.total); }).catch(() => {});
    return () => { vigente = false; };
  }, []);
  useEffect(() => {
    if (original === "moderacion") router.replace("/admin/liga/revisar?vista=reportes", { scroll: false });
  }, [original, router]);
  return <Pagina repetido titulo={t("admin_revisar_titulo")}>
    <Segmentos etiqueta={t("admin_revisar_titulo")} valor={vista} alCambiar={v => router.replace(`/admin/liga/revisar?vista=${v}`, { scroll: false })} opciones={[
      { valor: "errores", etiqueta: t("admin_revisar_errores"), cuenta: errores },
      { valor: "reportes", etiqueta: t("admin_revisar_reportes"), cuenta: reportes },
      { valor: "resueltos", etiqueta: t("admin_errors_resolved") },
    ]} />
    {vista === "reportes" ? <Moderacion alTotal={setReportes} /> : <Errores key={vista} estado={vista === "resueltos" ? "resuelto" : "abierto"} alTotal={vista === "errores" ? setErrores : ignorarTotal} />}
  </Pagina>;
}
const ignorarTotal = () => {};

export default function RevisarAdmin() {
  return <Suspense fallback={null}><AuthGate><Revisar /></AuthGate></Suspense>;
}
