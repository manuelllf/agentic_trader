"use client";

// Tu cuenta: el nombre con el que sales en la liga (el correo nunca se enseña a nadie), tu correo
// y la verificación en dos pasos.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton, Cargando } from "../_ui";
import { cambiarAlias, getYo, type Yo } from "@/lib/liga/api";
import { useSupabase } from "@/lib/liga/supabase";

export default function Cuenta() {
  const sb = useSupabase();
  const [yo, setYo] = useState<Yo | null>(null);
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "bien" | "mal"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!sb) return;
    (async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        window.location.replace("/entrar?next=/cuenta");
        return;
      }
      setEmail(data.session.user.email ?? "");
      const perfil = await getYo();
      setYo(perfil);
      setAlias(perfil?.alias ?? "");
    })();
  }, [sb]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado || !yo) return;
    setOcupado(true);
    setAviso(null);
    const fuera = await cambiarAlias(alias);
    if (typeof fuera === "string") {
      setAviso({ tipo: "mal", texto: fuera });
    } else {
      setYo(fuera);
      setAlias(fuera.alias);
      setAviso({ tipo: "bien", texto: "Guardado. Ya sales con este nombre." });
    }
    setOcupado(false);
  };

  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">liguilla</Link>
      </header>

      <section className="sencilla-cuerpo" aria-labelledby="titular">
        <h1 id="titular">Tu cuenta</h1>
        {sb === null ? (
          <p className="nota">Las cuentas todavía no están abiertas.</p>
        ) : !yo ? (
          <Cargando filas={2} />
        ) : (
          <>
            <form className="form" onSubmit={guardar}>
              <label className="campo">
                <span className="lbl">Tu nombre en la liga</span>
                <input className="inp" value={alias} maxLength={20} required
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}
                       onChange={(e) => setAlias(e.target.value)} />
                <span className="nota">
                  Es lo único que ven los demás. De 3 a 20 caracteres: minúsculas, números, _ o
                  punto. También te sirve para entrar.
                </span>
              </label>
              {aviso && (
                <p className={aviso.tipo === "mal" ? "aviso" : "nota"} role="status">{aviso.texto}</p>
              )}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || alias.trim().toLowerCase() === yo.alias}>
                {ocupado ? "Guardando…" : "Guardar nombre"}
              </Boton>
            </form>

            <div className="form">
              <div className="campo">
                <span className="lbl">Correo</span>
                <span className="nota">{email} · Solo lo ves tú.</span>
              </div>
              <div className="campo">
                <span className="lbl">Verificación en dos pasos</span>
                <span className="nota">
                  {yo.aal2 ? "Activada y superada en esta sesión." : "Pide un código de tu app al entrar."}
                </span>
                {!yo.aal2 && (
                  <Link href="/cuenta/verificacion?next=/cuenta" className="btn small">
                    Activarla o pasar el código
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
