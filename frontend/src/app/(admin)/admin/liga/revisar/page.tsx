"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { Errores } from "./Errores";
import { Moderacion } from "./Moderacion";

function Revisar() {
  const t = useTranslations();
  const router = useRouter();
  const parametros = useSearchParams();
  const vista = parametros.get("vista") === "moderacion" ? "moderacion" : "errores";

  return (
    <div className="admin-escritorio mx-auto max-w-md px-4 pb-16 pt-6 min-w-0 text-[13px]" style={{ color: "#c3c2b7" }}>
      <h1 className="text-[19px] text-white" style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_revisar_titulo")}</h1>
      <p className="mt-1" style={{ color: "#898781" }}>{t("admin_revisar_sub")}</p>
      <div role="tablist" aria-label={t("admin_revisar_titulo")} className="mt-4 flex flex-wrap gap-2">
        {(["errores", "moderacion"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v}
                  onClick={() => router.replace(`/admin/liga/revisar?vista=${v}`, { scroll: false })}
                  className="min-h-[44px] rounded-lg px-4 font-bold"
                  style={{ background: vista === v ? "#3987e5" : "#2c2c2a", color: vista === v ? "#fff" : "#c3c2b7" }}>
            {t(v === "errores" ? "admin_revisar_errores" : "admin_revisar_moderacion")}
          </button>
        ))}
      </div>
      {vista === "errores" ? <Errores /> : <Moderacion />}
    </div>
  );
}

export default function RevisarAdmin() {
  return <Suspense fallback={null}><AuthGate><Revisar /></AuthGate></Suspense>;
}
