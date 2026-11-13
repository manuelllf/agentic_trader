"use client";

// Cuenta como página (escritorio, o al llegar por enlace): la pestaña Cuenta y, dentro, «‹ Cuenta» en cada pantalla.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { BarraPestanas } from "../_ui/BarraPestanas";
import { ErrorLiga } from "../_ui/ErrorLiga";
import { AvisoCuenta, BarraCuenta, CuerpoCuenta, EsqueletoCuenta, ProveedorNavCuenta, RUTAS, TITULOS, type NavCuenta, type Pantalla } from "./marco";
import { PANTALLAS } from "./pantallas";
import "../liga/ranking.css";
import "./cuenta.css";

export function PaginaCuenta({ pantalla }: { pantalla: Pantalla }) {
  const t = useTranslations();
  const router = useRouter();
  const { yo, yoFallo, refrescarYo } = useSesionRequerida(RUTAS[pantalla]);
  const [aviso, setAviso] = useState<string | null>(null);
  const sinAviso = useCallback(() => setAviso(null), []);
  const nav = useMemo<NavCuenta>(() => ({
    modo: "pagina", hondo: pantalla !== "inicio", animacion: "",
    ir: (p) => router.push(RUTAS[p]),
    volver: () => router.push(RUTAS.inicio),
    cerrar: () => {},
    avisar: setAviso,
    marcarCambios: () => {},
  }), [pantalla, router]);
  const Contenido = PANTALLAS[pantalla];
  return <main className="scroll lv-pagina cu-pagina">
    <BarraPestanas />
    <ProveedorNavCuenta value={nav}>
      {yo ? <Contenido /> : <>
        <BarraCuenta titulo={t(TITULOS[pantalla])} />
        <CuerpoCuenta>{yoFallo
          ? <ErrorLiga titulo={t("account_error_cargar")} mensaje={t("account_error_reintentar")}
            accion={{ texto: t("account_reintentar"), onClick: refrescarYo }} />
          : <EsqueletoCuenta />}</CuerpoCuenta>
      </>}
      <AvisoCuenta texto={aviso} onFin={sinAviso} />
    </ProveedorNavCuenta>
  </main>;
}
