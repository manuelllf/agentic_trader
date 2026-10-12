"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { activarAvisos, avisosAltaPara, marcarAvisosPreguntados } from "@/lib/liga/avisos";
import { destinoSeguro } from "@/lib/liga/supabase";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { AvisosAltaVista } from "./AvisosAltaVista";

export default function AvisosAlta() {
  const t = useTranslations();
  const { estado } = useSesionRequerida("/avisos-alta");
  const [destino, setDestino] = useState<string | null>(null);
  const [variante, setVariante] = useState<"avisos" | "ios" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (estado !== "dentro") return;
    let vivo = true;
    const next = destinoSeguro(new URLSearchParams(window.location.search).get("next"));
    void avisosAltaPara("resto", next).then(resultado => {
      if (!vivo) return;
      if (!resultado) { window.location.assign(next); return; }
      setDestino(next);
      setVariante(resultado);
    });
    return () => { vivo = false; };
  }, [estado]);

  function seguir() {
    if (ocupado || !destino) return;
    setOcupado(true);
    marcarAvisosPreguntados();
    window.location.assign(destino);
  }

  async function activar() {
    if (ocupado || !destino) return;
    setOcupado(true);
    setError(null);
    const resultado = await activarAvisos();
    if (resultado === "error") {
      setError(t("account_avisos_error"));
      setOcupado(false);
      return;
    }
    // Un aviso cerrado sin responder vuelve a salir; el permiso negado no vuelve.
    if (resultado !== "cancelado") marcarAvisosPreguntados();
    window.location.assign(destino);
  }

  if (estado !== "dentro" || !variante || !destino) return null;
  return <AvisosAltaVista variante={variante} ocupado={ocupado} error={error}
    onActivar={() => void activar()} onSeguir={seguir} />;
}
