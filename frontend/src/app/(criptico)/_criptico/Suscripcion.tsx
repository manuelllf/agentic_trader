import { useRef, useState } from "react";
import * as api from "@/lib/criptico/api";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";

export default function Suscripcion({ idioma, t }: { idioma: Idioma; t: Traducir }) {
  const [email, setEmail] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState(false);
  const bloqueo = useRef(false);
  return <section id="suscripcion" className="cr-bloque cr-suscripcion"><h2>{t("cr_suscripcion")}</h2>
    {enviado ? <p role="status">{t("cr_suscrito")}</p> : <form onSubmit={async e => {
      e.preventDefault(); if (bloqueo.current) return;
      bloqueo.current = true; setOcupado(true); setError(false);
      try { await api.suscribir(email.trim(), idioma); setEnviado(true); }
      catch { setError(true); }
      finally { bloqueo.current = false; setOcupado(false); }
    }}>
      <label htmlFor="cr-email">{t("cr_email")}</label>
      <input id="cr-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={ocupado} />
      <button type="submit" className="btn" disabled={ocupado}>{t("cr_suscribir")}</button>
      {error && <p role="status">{t("cr_error")}</p>}
    </form>}
    <p className="cr-nota">{t("cr_suscripcion_nota")}</p>
  </section>;
}
