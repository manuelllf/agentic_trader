import { useRef, useState } from "react";
import * as api from "@/lib/criptico/api";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";

// Boletín del críptico: lista propia con doble confirmación, sin cuenta de la liga.
// La validación es de la app: el globo de aviso del navegador no sale.
export default function Suscripcion({ idioma, t }: { idioma: Idioma; t: Traducir }) {
  const [email, setEmail] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const bloqueo = useRef(false);
  return <section id="suscripcion" className="cr-bloque cr-suscripcion"><h2>{t("cr_suscripcion")}</h2>
    <p className="cr-sr">{t("cr_suscripcion_texto")}</p>
    {enviado ? <p role="status">{t("cr_suscrito")}</p> : <form noValidate onSubmit={async e => {
      e.preventDefault(); if (bloqueo.current) return;
      const correo = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { setError(t("cr_email_invalido")); return; }
      bloqueo.current = true; setOcupado(true); setError("");
      try { await api.suscribir(correo, idioma); setEnviado(true); }
      catch { setError(t("cr_error")); }
      finally { bloqueo.current = false; setOcupado(false); }
    }}>
      <label className="cr-sr" htmlFor="cr-email">{t("cr_email")}</label>
      <div className="cr-fila">
        <input id="cr-email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254}
          placeholder={t("cr_email_ejemplo")} value={email} onChange={e => setEmail(e.target.value)} disabled={ocupado} />
        <button type="submit" className="btn pri" disabled={ocupado}>{t("cr_suscribir")}</button>
      </div>
      {error && <p role="status">{error}</p>}
    </form>}
  </section>;
}
