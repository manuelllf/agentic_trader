"use client";

import { useTranslations } from "next-intl";
import { useId, useRef } from "react";

export function CampoCodigo({ value, onChange, autoFocus = false, disabled = false }: {
  value: string; onChange: (valor: string) => void; autoFocus?: boolean; disabled?: boolean;
}) {
  const t = useTranslations();
  const id = useId();
  const casillas = useRef<(HTMLInputElement | null)[]>([]);
  const foco = (i: number) => casillas.current[Math.max(0, Math.min(5, i))]?.focus();
  const repartir = (texto: string) => {
    const digitos = texto.replace(/\D/g, "").slice(0, 6);
    if (!digitos) return;
    onChange(digitos);
    foco(Math.min(digitos.length, 5));
  };
  return <fieldset className="acc-codigo-campo" disabled={disabled}>
    <legend className="lbl">{t("auth_codigo")}</legend>
    <div className="acc-seis">
      {Array.from({ length: 6 }, (_, i) => <input key={i} id={`${id}-${i}`}
        ref={elemento => { casillas.current[i] = elemento; }}
        type="text" inputMode="numeric" maxLength={i === 0 ? 6 : 1}
        autoComplete={i === 0 ? "one-time-code" : "off"} autoFocus={autoFocus && i === 0}
        aria-label={t("auth_codigo_digito", { n: i + 1, total: 6 })}
        value={value[i] ?? ""} onFocus={e => e.target.select()}
        onPaste={e => { e.preventDefault(); repartir(e.clipboardData.getData("text")); }}
        onChange={e => {
          const texto = e.target.value;
          const digitos = texto.replace(/\D/g, "");
          if (digitos.length > 1) { repartir(texto); return; }
          if (texto && !digitos) return;
          const siguiente = value.slice(0, i) + digitos + value.slice(i + 1);
          onChange(siguiente.slice(0, 6));
          if (digitos) foco(i + 1);
        }} onKeyDown={e => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault(); foco(i + (e.key === "ArrowLeft" ? -1 : 1));
          } else if (e.key === "Backspace" && !value[i] && i > 0) {
            e.preventDefault(); onChange(value.slice(0, i - 1) + value.slice(i)); foco(i - 1);
          }
        }} />)}
    </div>
  </fieldset>;
}
