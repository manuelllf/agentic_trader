"use client";

// Tu cuenta: el nombre con el que sales en la liga (el correo nunca se enseña a nadie), tu correo
// y la verificación en dos pasos.

import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton, CampoClave, Cargando, ErrorLiga } from "../_ui";
import { claveValida } from "@/lib/liga/registro";
import { cambiarAlias } from "@/lib/liga/api";
import { borrarMiCuenta, exportarMisDatos } from "@/lib/liga/cuenta";
import { useSupabase } from "@/lib/liga/supabase";
import { fijar } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { AvisosDispositivo } from "./AvisosDispositivo";
import { Marca } from "../_ui/Marca";

/** Dispara la descarga de un fichero de texto sin subirlo a ningún sitio: todo en el navegador. */
function descargar(nombre: string, texto: string): void {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

export default function Cuenta() {
  const t = useTranslations();
  const sb = useSupabase();
  const { yo, yoFallo, refrescarYo, email } = useSesionRequerida("/cuenta");
  const [alias, setAlias] = useState("");
  const [aliasListo, setAliasListo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "bien" | "mal"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [claveBaja, setClaveBaja] = useState("");
  const [errorBaja, setErrorBaja] = useState("");
  const [dandoBaja, setDandoBaja] = useState(false);
  const [claveNueva, setClaveNueva] = useState("");
  const [confirmarClave, setConfirmarClave] = useState("");
  const [cambiando, setCambiando] = useState(false);
  const [avisoClave, setAvisoClave] = useState<{ tipo: "bien" | "mal"; texto: string } | null>(null);

  // El campo del nombre parte del valor de `yo` la primera vez que llega (viene de la caché
  // compartida, `SesionContext`); si el usuario ya está escribiendo no se pisa en la revalidación
  // de fondo.
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

  const cambiarClave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cambiando || !sb) return;
    if (!claveValida(claveNueva)) {
      setAvisoClave({ tipo: "mal", texto: t("account_clave_requisitos") });
      return;
    }
    if (claveNueva !== confirmarClave) {
      setAvisoClave({ tipo: "mal", texto: t("account_contrasenas_distintas") });
      return;
    }
    setCambiando(true);
    setAvisoClave(null);
    const { error } = await sb.auth.updateUser({ password: claveNueva });
    if (error) {
      setAvisoClave({
        tipo: "mal",
        texto: error.status === 422
          ? t("account_clave_invalida")
          : t("account_cambio_fallo"),
      });
    } else {
      setClaveNueva("");
      setConfirmarClave("");
      setAvisoClave({ tipo: "bien", texto: t("account_clave_cambiada") });
    }
    setCambiando(false);
  };

  const descargarDatos = async () => {
    if (descargando) return;
    setDescargando(true);
    const resultado = await exportarMisDatos();
    if ("error" in resultado) {
      setAviso({ tipo: "mal", texto: resultado.error });
    } else {
      descargar("mis-datos-vennett.json", resultado.texto);
    }
    setDescargando(false);
  };

  const darDeBaja = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dandoBaja || !sb) return;
    setDandoBaja(true);
    setErrorBaja("");
    const fuera = await borrarMiCuenta(confirmacion.trim(), claveBaja);
    if (fuera) {
      setErrorBaja(fuera);
      setDandoBaja(false);
      return;
    }
    await sb.auth.signOut();
    window.location.replace("/");
  };

  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark"><Marca /></Link>
      <LanguageSelector /></header>

      <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
        <h1 id="titular">{t("account_tu_cuenta")}</h1>
        {sb === null ? (
          <p className="nota">{t("account_cuentas_cerradas")}</p>
        ) : !yo ? (
          yoFallo ? (
            <ErrorLiga titulo={t("account_error_cargar")}
                       mensaje={t("account_error_reintentar")}
                       accion={{ texto: t("account_reintentar"), onClick: refrescarYo }} />
          ) : (
            <Cargando filas={2} />
          )
        ) : (
          <>
            <form className="form" onSubmit={guardar}>
              <label className="campo">
                <span className="lbl">{t("account_nombre_liga")}</span>
                <input className="inp" value={alias} maxLength={20} required
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}
                       onChange={(e) => setAlias(e.target.value)} />
                <span className="nota">
                  {t("account_ayuda_nombre")}
                </span>
              </label>
              {aviso && (
                <p className={aviso.tipo === "mal" ? "aviso" : "nota"} role="status">{aviso.texto}</p>
              )}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || alias.trim().toLowerCase() === yo.alias}>
                {ocupado ? t("account_guardando") : t("account_guardar_nombre")}
              </Boton>
            </form>

            <div className="form">
              <div className="flex items-center justify-between gap-3">
                <span className="lbl">{t("account_idioma")}</span>
                <LanguageSelector />
              </div>
              <div className="campo">
                <span className="lbl">{t("account_correo")}</span>
                <span className="nota">{t("account_correo_privado", { email: email ?? "" })}</span>
              </div>
              <div className="campo">
                <span className="lbl">{t("account_verificacion")}</span>
                <span className="nota">
                  {yo.aal2
                    ? t("account_verificacion_superada")
                    : yo.admin
                      ? t("account_verificacion_admin")
                      : t("account_verificacion_opcional")}
                </span>
                {!yo.aal2 && (
                  <Link href="/cuenta/verificacion?next=/cuenta" className="btn small">
                    {yo.admin ? t("account_activar_codigo") : t("account_activar_opcional")}
                  </Link>
                )}
              </div>
            </div>

            <div className="form">
              <div className="campo">
                <span className="lbl">{t("account_metodo")}</span>
                <span className="nota">{t("account_metodo_ayuda")}</span>
              </div>
              <Link href="/como-funciona" className="btn small">{t("account_ver_metodo")}</Link>
            </div>

            <AvisosDispositivo />

            <form className="form" onSubmit={cambiarClave}>
              <CampoClave titulo={t("account_cambiar_clave")} autoComplete="new-password" minLength={8}
                maxLength={200} required value={claveNueva} onChange={e => setClaveNueva(e.target.value)} />
              <p className="nota">{t("account_clave_requisitos")}</p>
              <CampoClave titulo={t("account_confirmar_clave")} autoComplete="new-password" maxLength={200}
                required value={confirmarClave} onChange={e => setConfirmarClave(e.target.value)} />
              {avisoClave && (
                <p className={avisoClave.tipo === "mal" ? "aviso" : "nota"} role="status">
                  {avisoClave.texto}
                </p>
              )}
              <Boton type="submit" ancho="completo" disabled={cambiando || claveNueva.length < 8}>
                {cambiando ? t("account_cambiando") : t("account_cambiar_clave")}
              </Boton>
            </form>

            <div className="form">
              <div className="campo">
                <span className="lbl">{t("account_tus_datos")}</span>
                <span className="nota">
                  {t("account_ayuda_descarga")}
                </span>
              </div>
              <Boton type="button" ancho="completo" disabled={descargando} onClick={descargarDatos}>
                {descargando ? t("account_preparando") : t("account_descargar_datos")}
              </Boton>
            </div>

            <form className="form" onSubmit={darDeBaja}>
              <div className="campo">
                <span className="lbl">{t("account_borrar_cuenta")}</span>
                <span className="nota">
                  {t("account_ayuda_baja")}
                </span>
              </div>
              <label className="campo">
                <span className="lbl">{t("account_confirmar_baja", { alias: yo.alias })}</span>
                <input className="inp" value={confirmacion} autoCapitalize="none"
                       autoCorrect="off" spellCheck={false}
                       onChange={(e) => setConfirmacion(e.target.value)} />
              </label>
              <label className="campo">
                <span className="lbl">{t("account_tu_contrasena")}</span>
                <input className="inp" type="password" autoComplete="current-password"
                       value={claveBaja} onChange={(e) => setClaveBaja(e.target.value)} />
              </label>
              {errorBaja && <p className="aviso" role="alert">{errorBaja}</p>}
              <Boton type="submit" ancho="completo"
                     disabled={dandoBaja || !claveBaja
                       || confirmacion.trim().toLowerCase() !== yo.alias}>
                {dandoBaja ? t("account_borrando") : t("account_borrar_cuenta")}
              </Boton>
            </form>

            <p className="legal-nav">
              <Link href="/legal/aviso">{t("account_aviso_legal")}</Link>
              <Link href="/legal/privacidad">{t("account_privacidad")}</Link>
              <Link href="/legal/terminos">{t("account_terminos")}</Link>
              <Link href="/legal/cookies">{t("account_cookies")}</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
