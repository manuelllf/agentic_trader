import { useRef, useState } from "react";
import * as api from "@/lib/criptico/api";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";

// Boletín del críptico: lista propia con doble confirmación, sin cuenta de la liga.
export default function Suscripcion({ idioma, t }: { idioma: Idioma; t: Traducir }) {
  const [email, setEmail] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState(false);
  const bloqueo = useRef(false);
  return <section id="suscripcion" className="cr-bloque cr-suscripcion"><h2>{t("cr_suscripcion")}</h2>
    <p>{t("cr_suscripcion_texto")}</p>
    {enviado ? <p role="status">{t("cr_suscrito")}</p> : <form onSubmit={async e => {
      e.preventDefault(); if (bloqueo.current) return;
      bloqueo.current = true; setOcupado(true); setError(false);
      try { await api.suscribir(email.trim(), idioma); setEnviado(true); }
      catch { setError(true); }
      finally { bloqueo.current = false; setOcupado(false); }
    }}>
      <label htmlFor="cr-email">{t("cr_email")}</label>
      <div className="cr-fila">
        <input id="cr-email" type="email" autoComplete="email" inputMode="email" required maxLength={254} placeholder={t("cr_email_ejemplo")}
          value={email} onChange={e => setEmail(e.target.value)} disabled={ocupado} />
        <button type="submit" className="btn pri" disabled={ocupado}>{t("cr_suscribir")}</button>
      </div>
      {error && <p role="status">{t("cr_error")}</p>}
    </form>}
    <p className="cr-nota">{t("cr_suscripcion_nota")}</p>
  </section>;
}
