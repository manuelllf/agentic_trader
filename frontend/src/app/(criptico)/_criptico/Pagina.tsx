"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/criptico/api";
import { ApiError } from "@/lib/api";
import { fechaMadrid } from "@/lib/criptico/reloj";
import type { Entrega, Idioma, Textos } from "@/lib/criptico/tipos";
import { Marca } from "../../(liga)/_ui/Marca";
import Juego from "./Juego";
import Suscripcion from "./Suscripcion";
import { Esqueleto } from "./Esqueleto";
import { ruta, traductor } from "./textos";

// El servidor ya trae el acertijo: no hace falta pedirlo otra vez al navegador.
export type Inicial = { entrega: Entrega; ultimo?: number };

export default function Pagina({ idioma, textos, numero, inicial }: {
  idioma: Idioma; textos: Textos; numero?: number; inicial?: Inicial | null;
}) {
  const t = useMemo(() => traductor(idioma, textos), [idioma, textos]);
  const [entrega, setEntrega] = useState<Entrega | null>(inicial?.entrega ?? null);
  const [ultimo, setUltimo] = useState<number | undefined>(inicial?.ultimo);
  const [estado, setEstado] = useState<"cargando" | "vacio" | "error" | "listo">(inicial ? "listo" : "cargando");
  const [intento, setIntento] = useState(0);
  const [dia, setDia] = useState(() => fechaMadrid());
  const llegoDelServidor = useRef(Boolean(inicial));
  useEffect(() => {
    const timer = window.setInterval(() => setDia(fechaMadrid()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (llegoDelServidor.current) { llegoDelServidor.current = false; return; }
    let activo = true;
    setEstado("cargando");
    void (async () => {
      try {
        const datos = numero === undefined ? await api.hoy(idioma) : await api.numero(numero, idioma);
        if (!activo) return;
        setEntrega(datos); setUltimo(datos.acertijo.numero); setEstado("listo");
        if (numero !== undefined) {
          try { const hoy = await api.hoy(idioma); if (activo) setUltimo(hoy.acertijo.numero); }
          catch { /* El archivo sigue disponible aunque hoy no se haya publicado. */ }
        }
      } catch (e) { if (activo) setEstado(e instanceof ApiError && e.status === 404 ? "vacio" : "error"); }
    })();
    return () => { activo = false; };
  }, [idioma, numero, intento, dia]);
  if (estado === "listo" && entrega) return <Juego key={`${entrega.acertijo.id}:${dia}`} acertijo={entrega.acertijo} textos={textos} ultimoNumero={ultimo} />;
  return <main className="cr-estado" lang={idioma}>
    <a className="sello" href={ruta(idioma)}><Marca className="marca" /><i aria-hidden="true" /><b>{t("cr_nombre")}</b></a>
    <h1>{t("cr_titulo")}</h1>{estado === "cargando" ? <Esqueleto variante="juego" etiqueta={t("cr_cargando")} /> : <p role="status">{t(`cr_${estado}`)}</p>}
    {estado === "error" && <button type="button" className="btn pri" onClick={() => setIntento(n => n + 1)}>{t("cr_reintentar")}</button>}
    {estado === "vacio" && <>
      <section className="cr-bloque"><h2>{t("cr_bienvenida")}</h2>
        <ol className="cr-pasos"><li>{t("cr_paso_uno")}</li><li>{t("cr_paso_dos")}</li><li>{t("cr_paso_tres")}</li></ol>
      </section>
      <Suscripcion idioma={idioma} t={t} />
    </>}
  </main>;
}
