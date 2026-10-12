"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { exportarMisDatos } from "@/lib/liga/cuenta";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { Boton } from "../../_ui";
import { MarcoCuenta } from "../MarcoCuenta";

function descargar(nombre: string, texto: string): void {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

export default function DatosCuenta() {
  const t = useTranslations();
  useSesionRequerida("/cuenta/datos");
  const [descargando, setDescargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const descargarDatos = async () => {
    if (descargando) return;
    setDescargando(true);
    const resultado = await exportarMisDatos();
    if ("error" in resultado) setAviso(resultado.error);
    else descargar("mis-datos-vennett.json", resultado.texto);
    setDescargando(false);
  };
  return <MarcoCuenta titulo={t("account_tus_datos")}>
    <div className="form">
      <p className="nota">{t("account_ayuda_descarga")}</p>
      {aviso && <p className="aviso" role="status">{aviso}</p>}
      <Boton type="button" ancho="completo" disabled={descargando} onClick={descargarDatos}>
        {descargando ? t("account_preparando") : t("account_descargar_datos")}
      </Boton>
    </div>
  </MarcoCuenta>;
}
