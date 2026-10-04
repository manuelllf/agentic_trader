"use client";

// Cabecera de sesión: «Entrar» sin cuenta; con cuenta, un botón con el alias que abre un menú
// corto (Panel de control solo al admin, y Salir). Se abre al tocar, nunca al pasar por encima.
//
// Lee de `SesionContext` (montado una vez en `(liga)/layout.tsx`): no vuelve a pedir la sesión ni
// `Yo` al cambiar de pestaña, así que ya no se remonta ni parpadea en cada navegación. El hueco
// "cargando" solo se ve una vez, en la primera carga de la app entera.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useSesion } from "./SesionContext";

export function Sesion() {
  const t = useTranslations();
  const { estado, yo, cerrarSesion } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const salir = async () => {
    setAbierto(false);
    await cerrarSesion();
  };

  if (estado === "cargando") return <span className="cuenta-hueco" aria-hidden="true" />;
  if (estado === "fuera") {
    return <Link href="/entrar" className="btn small discreto">{t("account_entrar")}</Link>;
  }
  const panel = yo?.aal2 ? "/admin" : "/cuenta/verificacion?next=/admin";
  return (
    <div className="cuenta" ref={caja}>
      <button type="button" className="cuenta-boton" aria-haspopup="menu"
              aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <span>{yo?.alias ?? t("account_tu_cuenta")}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {abierto && (
        <div className="cuenta-menu" role="menu">
          <Link href="/cuenta" role="menuitem" className="cuenta-item">{t("account_tu_cuenta")}</Link>
          {yo?.admin && (
            <Link href={panel} role="menuitem" className="cuenta-item">{t("account_panel_control")}</Link>
          )}
          <button type="button" role="menuitem" className="cuenta-item salir" onClick={salir}>
            {t("account_salir")}
          </button>
        </div>
      )}
    </div>
  );
}
