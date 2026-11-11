"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type InputHTMLAttributes } from "react";

// `caja`: el nombre va dentro del campo como marcador, sin etiqueta encima (acceso v3).
export function CampoClave({ titulo, caja = false, ...props }:
  InputHTMLAttributes<HTMLInputElement> & { titulo?: string; caja?: boolean }) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const generado = useId();
  const id = props.id ?? generado;
  const nombre = titulo ?? t("auth_contrasena");
  const ojo = <button type="button" className={caja ? "v3-ojo" : "clave-ojo"}
    aria-label={visible ? t("auth_ocultar_contrasena") : t("auth_mostrar_contrasena")}
    aria-pressed={visible} onClick={() => setVisible(!visible)}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {visible && <path d="m3 3 18 18" />}
    </svg>
  </button>;
  if (caja) return <label className="v3-caja">
    <input {...props} id={id} aria-label={nombre} placeholder={nombre} type={visible ? "text" : "password"} />
    {ojo}
  </label>;
  return <div className="campo">
    <label className="lbl" htmlFor={id}>{nombre}</label>
    <span className="clave-campo">
      <input {...props} id={id} className="inp" type={visible ? "text" : "password"} />
      {ojo}
    </span>
  </div>;
}
