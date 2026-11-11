"use client";

// Portada «Hoy»: liga, críptico y boletín del día en una pantalla (maqueta v9 aprobada).
// La jornada de la liga es un ejemplo rotulado; el críptico y el artículo son los reales.

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useLanguage } from "@/i18n/Provider";
import { SelectorIdioma } from "@/components/SelectorIdioma";
import type { EstadoCriptico } from "@/lib/criptico/estado";
import { Marca } from "../_ui/Marca";

export type BoletinHoy = { slug: string; titulo: string; resumen: string; minutos: number } | null;

type Fila = { id: string; nombre: string; casa: boolean; valor: number; orden: number };
const FILAS: Fila[] = [
  { id: "alpha", nombre: "Alpha", casa: true, valor: 0.8, orden: 0 },
  { id: "lambda", nombre: "Lambda", casa: true, valor: 0.4, orden: 1 },
  { id: "sp", nombre: "S&P 500", casa: false, valor: 0.2, orden: 2 },
  { id: "omega", nombre: "Omega", casa: true, valor: -0.3, orden: 3 },
];
const ABRE = 570, CIERRA = 960; // minutos desde medianoche en Nueva York

function nuevaYork(ahora: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(ahora);
  const o: Record<string, string> = {};
  partes.forEach((p) => { o[p.type] = p.value; });
  const h = Number(o.hour) % 24, m = Number(o.minute);
  return { finde: o.weekday === "Sat" || o.weekday === "Sun", min: h * 60 + m, hora: `${h}:${String(m).padStart(2, "0")}` };
}

function Flecha() {
  return <svg viewBox="0 0 8 13" aria-hidden="true"><path d="M1 1l5.5 5.5L1 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Icono() {
  return <svg className="icono" viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="hoy-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F0F6F6" /><stop offset="1" stopColor="#E2EEED" /></linearGradient><linearGradient id="hoy-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#30353B" /><stop offset="1" stopColor="#15171B" /></linearGradient><linearGradient id="hoy-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#13877F" /><stop offset="1" stopColor="#09534E" /></linearGradient><clipPath id="hoy-c"><rect width="200" height="200" rx="44" /></clipPath></defs><g clipPath="url(#hoy-c)"><rect width="200" height="200" fill="url(#hoy-f)" /><path d="M24 82H178" stroke="#0B6E68" strokeOpacity=".26" strokeWidth="2.5" strokeDasharray="6 5" /><g fill="url(#hoy-t)"><path d="M53 58H67V144Q67 159 82 159H104V173H82Q53 173 53 144Z" /><rect x="35" y="82" width="50" height="44" rx="5" /></g><g fill="url(#hoy-p)"><path d="M115 30H129V144Q129 159 144 159H166V173H144Q115 173 115 144Z" /><rect x="97" y="46" width="50" height="44" rx="5" /></g></g></svg>;
}

export function Hoy({ criptico, boletin }: { criptico: EstadoCriptico; boletin: BoletinHoy }) {
  const t = useTranslations();
  const locale = useLocale();
  const { changing, selectLocale } = useLanguage();
  const es = locale !== "en";
  const prefijo = es ? "" : "/en";

  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  // Un único movimiento con sentido: Lambda adelanta a Alpha.
  const [adelanta, setAdelanta] = useState(false);
  useEffect(() => {
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (quieto) { setAdelanta(true); return; }
    const id = setTimeout(() => setAdelanta(true), 2200);
    return () => clearTimeout(id);
  }, []);
  const filas = FILAS.map((f) => adelanta && f.id === "alpha" ? { ...f, orden: 1 }
    : adelanta && f.id === "lambda" ? { ...f, orden: 0, valor: 0.9 } : f);

  const [respuesta, setRespuesta] = useState("");
  const [enfocada, setEnfocada] = useState(false);
  const retraso = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

  const ny = nuevaYork(ahora);
  const abierta = !ny.finde && ny.min >= ABRE && ny.min < CIERRA;
  const antes = !ny.finde && ny.min < ABRE;
  const duracion = (min: number) => min >= 60 ? t("hoy_horas", { h: Math.floor(min / 60), m: min % 60 }) : t("hoy_minutos", { m: min });
  const cuenta = abierta ? duracion(CIERRA - ny.min) : antes ? duracion(ABRE - ny.min) : t("hoy_cerrada");
  const cuentaSub = abierta ? t("hoy_para_cierre") : antes ? t("hoy_para_apertura") : t("hoy_abre");
  const estado = abierta ? t("hoy_en_juego") : antes ? t("hoy_antes") : t("hoy_fuera");
  const fechaTxt = new Intl.DateTimeFormat(es ? "es-ES" : "en-US", { weekday: "long", day: "numeric", month: "long" }).format(ahora);
  const fecha = fechaTxt.charAt(0).toUpperCase() + fechaTxt.slice(1);
  const porcentaje = (v: number) => {
    const n = Math.abs(v).toFixed(1);
    const signo = v < 0 ? "−" : "+";
    return es ? `${signo}${n.replace(".", ",")} %` : `${signo}${n}%`;
  };

  const hayCriptico = criptico !== null;
  const piezas = (hayCriptico ? 1 : 0) + (boletin ? 1 : 0);
  const claseMosaico = `dentro mosaico${piezas === 0 ? " solo-liga" : piezas === 1 ? " una-pieza" : ""}`;

  return <div className="hoy">
    <header className="dentro cab">
      <Link className="marca" href="/" aria-label="Vennett"><Icono /><Marca className="nombre" /></Link>
      <nav>
        <SelectorIdioma actual={es ? "es" : "en"} etiqueta={t("common_idioma")} deshabilitado={changing}
          onElegir={(codigo) => { void selectLocale(codigo); }} />
        <Link className="entrar" href="/entrar">{t("landing_entrar")}</Link>
      </nav>
    </header>

    <main>
      <section className="dentro titulo">
        <div>
          <p className="fecha">{fecha}</p>
          <h2 className="grande">{t("hoy_titulo")}</h2>
        </div>
        <p className={`reloj${abierta ? " abierta" : ""}`}><i />{t("landing_reloj_vivo", { hora: ny.hora })}</p>
      </section>

      <section className={claseMosaico}>
        <article className="pieza liga entra" style={retraso(40)}>
          <p className="etq"><span>{t("hoy_liga_etq")}</span><span className="vivo"><i />{estado}</span></p>
          <p className="cuenta">{cuenta}</p>
          <p className="cuenta-sub">{cuentaSub}</p>
          <ul className="carrera">
            {filas.map((f) => <li key={f.id} className={`${f.casa ? "" : "ref"}${f.orden === 0 ? " primera" : ""}`} style={{ top: f.orden * 44 }}>
              <span className="n">{f.nombre}{f.casa && <span className="s">{t("landing_casa")}</span>}</span>
              <span className={`v${f.casa ? (f.valor < 0 ? " baja" : " sube") : ""}`}>{porcentaje(f.valor)}</span>
            </li>)}
          </ul>
          <p className="ejemplo">{t("hoy_ejemplo")}</p>
          <div className="abajo liga-pie">
            <Link className="fichar" href="/entrar?next=/crear">{t("hoy_fichar")}</Link>
            <Link className="ir" href="/liga">{t("hoy_ver_liga")}<Flecha /></Link>
          </div>
        </article>

        {criptico?.tipo === "hoy" && <article className="pieza entra" style={retraso(120)}>
          <p className="etq"><span>{t("hoy_criptico", { numero: criptico.numero })}</span><span>{t(`hoy_nivel_${criptico.nivel}`)}</span></p>
          <p className="pista">{criptico.pista.split(" ").map((palabra, i) => <span key={i} style={{ "--i": i } as CSSProperties}>{palabra}{" "}</span>)}({criptico.longitud})</p>
          <label className="casillas">
            {Array.from({ length: criptico.longitud }, (_, i) => <span key={i}
              className={enfocada && i === Math.min(respuesta.length, criptico.longitud - 1) ? "activa" : undefined}>{respuesta[i] ?? ""}</span>)}
            <input value={respuesta} maxLength={criptico.longitud} autoComplete="off" autoCapitalize="characters"
              spellCheck={false} aria-label={t("hoy_respuesta")} onFocus={() => setEnfocada(true)} onBlur={() => setEnfocada(false)}
              onChange={(e) => setRespuesta(e.target.value.replace(/[^a-zA-ZñÑ]/g, "").slice(0, criptico.longitud))} />
          </label>
          <div className="abajo"><Link className="ir" href={`${prefijo}/criptico`}>{t("hoy_seguir_criptico")}<Flecha /></Link></div>
        </article>}

        {criptico?.tipo === "proximo" && <article className="pieza entra" style={retraso(120)}>
          <p className="etq"><span>{t("landing_regleta_criptico_proximo", { fecha: new Intl.DateTimeFormat(es ? "es-ES" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${criptico.fecha}T00:00:00Z`)) })}</span></p>
          <p className="titular-b">{t("landing_regleta_avisame")}</p>
          <div className="abajo"><Link className="ir" href={`${prefijo}/criptico`}>{t("hoy_ir_criptico")}<Flecha /></Link></div>
        </article>}

        {boletin && <article className="pieza entra" style={retraso(200)}>
          <p className="etq"><span>{t("hoy_boletin")}</span><span>{t("hoy_lectura", { count: boletin.minutos })}</span></p>
          <p className="titular-b">{boletin.titulo}</p>
          <p className="resumen">{boletin.resumen}</p>
          <div className="abajo"><Link className="ir" href={`${prefijo}/blog/${boletin.slug}`}>{t("hoy_leer")}<Flecha /></Link></div>
        </article>}
      </section>

      <section className="dentro">
        <p className="que"><b>{t("hoy_que_fuerte")}</b> {t("hoy_que_resto")}</p>
      </section>
    </main>

    <footer className="dentro pie">
      <p><Link href="/legal/aviso">{t("landing_legal")}</Link> · <Link href="/legal/privacidad">{t("landing_privacidad")}</Link> · <Link href="/legal/cookies">{t("landing_cookies")}</Link></p>
      <p>{t("hoy_aviso")}</p>
    </footer>
  </div>;
}
