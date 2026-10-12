"use client";

import { useTranslations } from "next-intl";
import { Boton } from "../_ui/Boton";
import { MarcoAcceso } from "../_ui/MarcoAcceso";

type Props = {
  variante: "avisos" | "ios";
  ocupado: boolean;
  error: string | null;
  onActivar: () => void;
  onSeguir: () => void;
};

export function AvisosAltaVista({ variante, ocupado, error, onActivar, onSeguir }: Props) {
  const t = useTranslations();
  return <MarcoAcceso modo="tramite" titular={t("account_avisos_alta_titulo")}>
    <p className="nota">{t(variante === "ios" ? "account_avisos_no_disponibles" : "account_avisos_alta_texto")}</p>
    <div className="form">
      {error && <p className="aviso" role="alert">{error}</p>}
      {variante === "avisos" ? <Boton type="button" variante="principal" ancho="completo"
        disabled={ocupado} onClick={onActivar}>
        {t(ocupado ? "account_guardando" : "account_avisos_alta_activar")}
      </Boton> : <Boton type="button" variante="principal" ancho="completo"
        disabled={ocupado} onClick={onSeguir}>
        {t("account_avisos_alta_continuar")}
      </Boton>}
    </div>
  </MarcoAcceso>;
}
