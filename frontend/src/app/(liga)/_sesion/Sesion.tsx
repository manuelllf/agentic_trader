"use client";

// Sin foto de perfil, la cuenta vive detrás de los tres puntos.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useSesion } from "./SesionContext";

const iconos = {
  u: <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.6-3.6 3.5-5.6 7-5.6s6.4 2 7 5.6" /></>,
  p: <><path d="M12 3 4.5 6v5.5c0 4.4 3.1 7.6 7.5 9.5 4.4-1.9 7.5-5.1 7.5-9.5V6Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  s: <><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" /><path d="M15 8l4 4-4 4M19 12H9" /></>,
  l: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></>,
};

function Icono({ tipo }: { tipo: keyof typeof iconos }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconos[tipo]}</svg>;
}

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
  const dentro = estado === "dentro";
  const panel = yo?.aal2 ? "/admin" : "/cuenta/verificacion?next=/admin";
  const cerrar = () => setAbierto(false);

  return (
    <div className="cuenta" ref={caja}>
      <button type="button" className="puntos" aria-haspopup="menu" aria-expanded={abierto}
        aria-label={t("account_menu_aria")} onClick={() => setAbierto((a) => !a)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {abierto && (
        <div className="cuenta-menu" role="menu">
          {dentro && <div className="quien">{t("account_sesion_de", { alias: yo?.alias ?? t("account_tu_cuenta") })}</div>}
          {dentro ? <>
            <Link href="/cuenta" role="menuitem" className="cuenta-item" onClick={cerrar}><Icono tipo="u" />{t("account_tu_cuenta")}</Link>
            <Link href="/planes" role="menuitem" className="cuenta-item" onClick={cerrar}><Icono tipo="l" />{t("planes_titulo")}</Link>
            {yo?.admin && <Link href={panel} role="menuitem" className="cuenta-item" onClick={cerrar}><Icono tipo="p" />{t("account_panel_control")}</Link>}
          </> : <Link href="/entrar" role="menuitem" className="cuenta-item" onClick={cerrar}><Icono tipo="u" />{t("account_entrar")}</Link>}
          {dentro && <><hr /><button type="button" role="menuitem" className="cuenta-item salir" onClick={salir}><Icono tipo="s" />{t("account_salir")}</button></>}
        </div>
      )}
    </div>
  );
}
