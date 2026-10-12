"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cambiarAlias } from "@/lib/liga/api";
import { fijar } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { Boton } from "../../_ui";
import { MarcoCuenta } from "../MarcoCuenta";

export default function NombreCuenta() {
  const t = useTranslations();
  const { yo } = useSesionRequerida("/cuenta/nombre");
  const [alias, setAlias] = useState("");
  const [aliasListo, setAliasListo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "bien" | "mal"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // La revalidación no debe pisar el nombre que se está escribiendo.
  useEffect(() => {
    if (yo && !aliasListo) {
      setAlias(yo.alias);
      setAliasListo(true);
    }
  }, [yo, aliasListo]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado || !yo) return;
    setOcupado(true);
    setAviso(null);
    const fuera = await cambiarAlias(alias);
    if (typeof fuera === "string") {
      setAviso({ tipo: "mal", texto: fuera });
    } else {
      fijar("yo", fuera);
      setAlias(fuera.alias);
      setAviso({ tipo: "bien", texto: t("account_guardado") });
    }
    setOcupado(false);
  };

  return <MarcoCuenta titulo={t("account_nombre_liga")}>
    {yo && <form className="form" onSubmit={guardar}>
      <label className="campo">
        <span className="lbl">{t("account_nombre_liga")}</span>
        <input className="inp" value={alias} maxLength={20} required autoCapitalize="none"
          autoCorrect="off" spellCheck={false} onChange={e => setAlias(e.target.value)} />
        <span className="nota">{t("account_ayuda_nombre")}</span>
      </label>
      {aviso && <p className={aviso.tipo === "mal" ? "aviso" : "nota"} role="status">{aviso.texto}</p>}
      <Boton type="submit" variante="principal" ancho="completo"
        disabled={ocupado || alias.trim().toLowerCase() === yo.alias}>
        {ocupado ? t("account_guardando") : t("account_guardar_nombre")}
      </Boton>
    </form>}
  </MarcoCuenta>;
}
