"use client";

// La demo de la portada (maqueta v15): el globo de la foto activa y las 7 ideas fijas.
// Elegir una idea escanea el globo; el número del titular baja a la vez que el escaneo.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ORDEN_ESTILOS, empresaPorRango, type EmpresaRango, type PortadaDemo } from "@/lib/liga/portada";
import { Globo, decodificarMapa, type Senal } from "./globo/motor";
import { decimal, miles, type Idioma } from "./formato";

type Origen = "inicio" | "carrusel" | "toque" | "lista";
const ABRE = 570, CIERRA = 960; // minutos desde medianoche en Nueva York

function Comprobado() {
  return <svg className="ok" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9.5l3.6 3.6L14.5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** «grande», «mediana» o «pequeña» según los cortes de 10.000 y 1.000 M$ de la foto. */
export function tamanoDe(rango: number, datos: PortadaDemo): "grande" | "mediana" | "pequena" {
  const corte = (musd: number) => datos.anillos.find((a) => a.musd === musd)?.rango ?? 0;
  return rango < corte(10000) ? "grande" : rango < corte(1000) ? "mediana" : "pequena";
}

function useHoy(idioma: Idioma) {
  const t = useTranslations();
  const [texto, setTexto] = useState<string | null>(null);
  useEffect(() => {
    const pintar = () => {
      const ahora = new Date(), o: Record<string, string> = {};
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" })
        .formatToParts(ahora).forEach((x) => { o[x.type] = x.value; });
      const min = (Number(o.hour) % 24) * 60 + Number(o.minute), finde = o.weekday === "Sat" || o.weekday === "Sun";
      const dur = (m: number) => m >= 60 ? t("hoy_horas", { h: Math.floor(m / 60), m: m % 60 }) : t("hoy_minutos", { m });
      const f = new Intl.DateTimeFormat(idioma === "es" ? "es-ES" : "en-US", { weekday: "long", day: "numeric", month: "long" }).format(ahora);
      const bolsa = finde ? t("portada_bolsa_lunes") : min < ABRE ? t("portada_bolsa_abre_en", { dur: dur(ABRE - min) })
        : min < CIERRA ? t("portada_bolsa_cierra_en", { dur: dur(CIERRA - min) }) : t("portada_bolsa_cerrada");
      setTexto(`${f.charAt(0).toUpperCase()}${f.slice(1)}. ${bolsa}`);
    };
    pintar();
    const id = setInterval(pintar, 20000);
    return () => clearInterval(id);
  }, [idioma, t]);
  return texto;
}

type Props = {
  datos: PortadaDemo | null;
  idioma: Idioma;
  k: number;
  alElegir: (k: number) => void;
  alAbrir: (hoja: "idea" | "quien") => void;
};

export function Demo({ datos, idioma, k, alElegir, alAbrir }: Props) {
  const t = useTranslations();
  const hoy = useHoy(idioma);
  const n = (x: number) => miles(x, idioma);
  const estilos = ORDEN_ESTILOS.map((clave) => ({
    clave, nombre: t(`portada_estilo_${clave}_nombre`), desc: t(`portada_estilo_${clave}_desc`), datos: datos?.estilos[clave],
  }));
  const bits = useMemo(() => datos ? ORDEN_ESTILOS.map((c) => decodificarMapa(datos.estilos[c].mapa, datos.total)) : [], [datos]);

  const [cuenta, setCuenta] = useState(() => datos?.estilos[ORDEN_ESTILOS[0]].pasan ?? 0);
  const [senal, setSenal] = useState<Senal>({ tipo: "cinco", indice: 0 });
  const [empresas, setEmpresas] = useState<Record<number, EmpresaRango>>({});
  const [ayudaFuera, setAyudaFuera] = useState(false);

  const lienzo = useRef<HTMLCanvasElement>(null), caja = useRef<HTMLDivElement>(null), carrusel = useRef<HTMLDivElement>(null);
  const tarjetas = useRef<(HTMLButtonElement | null)[]>([]), botones = useRef<(HTMLButtonElement | null)[]>([]);
  const globo = useRef<Globo | null>(null), actualK = useRef(-1), quieto = useRef(false), pedidas = useRef(new Set<number>());
  const raton = useRef<{ x: number; l: number; dx: number; k: number } | null>(null), sinClic = useRef(false);

  const centrar = (j: number, suave: boolean) => {
    const c = carrusel.current, tj = tarjetas.current[j];
    if (c && tj) c.scrollTo({ left: tj.offsetLeft - (c.clientWidth - tj.offsetWidth) / 2, behavior: suave ? "smooth" : "auto" });
  };
  const masCentrada = () => {
    const c = carrusel.current;
    if (!c) return 0;
    const centro = c.scrollLeft + c.clientWidth / 2;
    let mejor = 0, dmin = Infinity;
    tarjetas.current.forEach((tj, j) => { if (!tj) return; const d = Math.abs(tj.offsetLeft + tj.offsetWidth / 2 - centro); if (d < dmin) { dmin = d; mejor = j; } });
    return mejor;
  };

  // `elegir` se lee desde manejadores nativos y temporizadores: siempre la última versión.
  const elegirRef = useRef<(j: number, origen: Origen) => void>(() => {});
  elegirRef.current = (j, origen) => {
    if (!datos || j === actualK.current) return;
    actualK.current = j;
    const e = datos.estilos[ORDEN_ESTILOS[j]];
    alElegir(j);
    setSenal({ tipo: "cinco", indice: 0 });
    globo.current?.encender(bits[j], e.cinco.map((c) => ({ ticker: c.ticker, rango: c.rango })), e.pasan);
    if (origen !== "carrusel") centrar(j, !quieto.current && origen !== "inicio");
  };
  const elegir = (j: number, origen: Origen) => elegirRef.current(j, origen);

  // El globo vive fuera de React: se crea una vez con los datos y se destruye al salir.
  useEffect(() => {
    if (!datos || !lienzo.current || !caja.current) return;
    quieto.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const g = new Globo(lienzo.current, caja.current, {
      total: datos.total,
      anillos: datos.anillos.map((a) => ({ rango: a.rango, etiqueta: t("portada_anillo", { musd: miles(a.musd, idioma) }) })),
      alContar: setCuenta,
      alTocar: (s) => {
        setSenal(s);
        // El nombre se pide al tocar, una vez por empresa: la página no carga las 5.723.
        if (s.tipo !== "empresa" || pedidas.current.has(s.rango)) return;
        pedidas.current.add(s.rango);
        void empresaPorRango(s.rango).then((emp) => {
          if (emp) setEmpresas((p) => ({ ...p, [s.rango]: emp }));
          else pedidas.current.delete(s.rango);
        });
      },
      alPrimerToque: () => setAyudaFuera(true),
    });
    globo.current = g;
    actualK.current = -1;
    // El único movimiento sin tocar nada: de todas las empresas a la primera idea.
    if (!quieto.current) setCuenta(datos.total);
    const id = setTimeout(() => elegir(0, "inicio"), quieto.current ? 0 : 600);
    return () => { clearTimeout(id); g.destruir(); globo.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el globo se crea solo al cambiar los datos o el idioma
  }, [datos, idioma]);

  // Carrusel: la tarjeta que queda en el centro al soltar es la elegida; con ratón también se arrastra.
  useEffect(() => {
    const c = carrusel.current;
    if (!c) return;
    let tScroll: ReturnType<typeof setTimeout> | undefined;
    const alDesplazar = () => {
      if (raton.current) return;
      clearTimeout(tScroll);
      tScroll = setTimeout(() => elegirRef.current(masCentrada(), "carrusel"), 90);
    };
    const bajar = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      raton.current = { x: e.clientX, l: c.scrollLeft, dx: 0, k: masCentrada() };
      c.classList.add("arrastrando");
    };
    const mover = (e: PointerEvent) => {
      const r = raton.current;
      if (!r) return;
      r.dx = e.clientX - r.x;
      c.scrollLeft = r.l - r.dx;
    };
    const soltar = () => {
      const r = raton.current;
      if (!r) return;
      const total = tarjetas.current.length;
      const j = Math.abs(r.dx) > 40 ? Math.max(0, Math.min(total - 1, r.k + (r.dx < 0 ? 1 : -1))) : masCentrada();
      raton.current = null;
      if (Math.abs(r.dx) > 5) { sinClic.current = true; setTimeout(() => { sinClic.current = false; }, 0); }
      centrar(j, !quieto.current);
      setTimeout(() => c.classList.remove("arrastrando"), quieto.current ? 0 : 450);
      elegirRef.current(j, "carrusel");
    };
    c.addEventListener("scroll", alDesplazar, { passive: true });
    c.addEventListener("pointerdown", bajar);
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      clearTimeout(tScroll);
      c.removeEventListener("scroll", alDesplazar);
      c.removeEventListener("pointerdown", bajar);
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, []);

  const actual = estilos[k];
  const cinco = actual.datos?.cinco ?? [];
  const tamano = (rango: number) => datos ? t(`portada_tamano_${tamanoDe(rango, datos)}`) : "";
  const negrita = (c: ReactNode) => <b>{c}</b>;

  let estrella: ReactNode = null;
  if (datos && senal.tipo === "cinco" && cinco[senal.indice]) {
    const c = cinco[senal.indice];
    estrella = t.rich("portada_estrella_cinco", { b: negrita, pos: senal.indice + 1, nombre: c.nombre, ticker: c.ticker, tamano: tamano(c.rango), nota: decimal(c.nota, idioma) });
  } else if (datos && senal.tipo === "empresa") {
    const pasa = bits[k]?.[senal.rango] === 1, emp = empresas[senal.rango];
    const valores = { b: negrita, puesto: n(senal.rango + 1), total: n(datos.total), tamano: tamano(senal.rango) };
    estrella = <>
      {emp ? t.rich("portada_estrella_empresa", { ...valores, nombre: emp.nombre ?? emp.ticker, ticker: emp.ticker }) : t.rich("portada_estrella_puesto", valores)}
      {" "}{t(pasa ? "portada_estrella_pasa" : "portada_estrella_no_pasa")}
    </>;
  }

  return <section className="hondo" id="hondo" aria-labelledby="titular">
    <div className="dentro">
      <div className="h-texto">
        <p className="ceja">{t("portada_ceja")}</p>
        <p className="hoy">{hoy ?? " "}</p>
        <h1 className="titular" id="titular">{t("portada_promesa")}</h1>
        <p className="promesa-sub">{datos ? t("portada_promesa_sub", { total: n(datos.total) }) : t("portada_promesa_sub_sin_datos")}</p>
      </div>

      {datos && <>
        {/* La cifra que baja con el escaneo es el título de la demo, no la promesa. */}
        <h2 className="cifra-demo">{t.rich("portada_titular", { pasan: n(cuenta), num: (c) => <span className="num">{c}</span> })}</h2>
        <div className="lista">
          <ul role="radiogroup" aria-label={t("portada_ideas_elige")}>
            {estilos.map((e, j) => <li key={e.clave}>
              <button ref={(b) => { botones.current[j] = b; }} type="button" className="opcion" role="radio" aria-checked={j === k} tabIndex={j === k ? 0 : -1}
                onClick={() => elegir(j, "lista")}
                onKeyDown={(ev) => {
                  const d = ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  ev.preventDefault();
                  const m = (j + d + estilos.length) % estilos.length;
                  elegir(m, "lista"); botones.current[m]?.focus();
                }}>
                <span className="n">{e.nombre}</span><span className="c">{n(e.datos?.pasan ?? 0)}</span><Comprobado />
              </button>
            </li>)}
          </ul>
          <p className="desc">{actual.desc}</p>
        </div>

        <div className="mapa" ref={caja}>
          <canvas ref={lienzo} role="img" aria-label={t("portada_globo_estado", {
            pasan: n(actual.datos?.pasan ?? 0), total: n(datos.total), estilo: actual.nombre, nombres: cinco.map((c) => c.nombre).join(", "),
          })} />
          <p className={`ayuda-globo${ayudaFuera ? " fuera" : ""}`}>{t("portada_globo_ayuda")}</p>
        </div>
        <p className="estrella" aria-live="polite"><span>{estrella}</span></p>

        <div className="mandos">
          <div className="carrusel" ref={carrusel} aria-label={t("portada_ideas_aria")}>
            {estilos.map((e, j) => <button key={e.clave} ref={(b) => { tarjetas.current[j] = b; }} type="button" className="tarjeta"
              aria-current={j === k} aria-label={t("portada_idea_aria", { nombre: e.nombre, n: n(e.datos?.pasan ?? 0) })}
              onClick={() => { if (!sinClic.current) elegir(j, "toque"); }}>
              <span className="tn">{e.nombre}</span><span className="tc">{n(e.datos?.pasan ?? 0)}</span><span className="td">{e.desc}</span>
            </button>)}
          </div>
          <div className="paginas" aria-hidden="true">{estilos.map((e, j) => <i key={e.clave} className={j === k ? "on" : undefined} />)}</div>
        </div>
      </>}

      <div className="accion">
        <button type="button" className="boton-h" onClick={() => alAbrir("idea")}>{t("portada_escribir_idea")}</button>
        <p className="gratis">{t("portada_gratis")} <button type="button" onClick={() => alAbrir("quien")}>{t("portada_quien_detras")}</button></p>
      </div>
    </div>
  </section>;
}
