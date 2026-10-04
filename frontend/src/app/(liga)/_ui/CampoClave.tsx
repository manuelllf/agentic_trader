"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type InputHTMLAttributes } from "react";

export function CampoClave({ titulo, ...props }:
  InputHTMLAttributes<HTMLInputElement> & { titulo?: string }) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const generado = useId();
  const id = props.id ?? generado;
  return <div className="campo">
    <label className="lbl" htmlFor={id}>{titulo ?? t("auth_contrasena")}</label>
    <span className="clave-campo">
      <input {...props} id={id} className="inp" type={visible ? "text" : "password"} />
      <button type="button" className="clave-ojo" aria-label={visible ? t("auth_ocultar_contrasena") : t("auth_mostrar_contrasena")}
        aria-pressed={visible} onClick={() => setVisible(!visible)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </span>
  </div>;
}
