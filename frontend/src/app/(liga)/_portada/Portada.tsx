"use client";

// Portada sin sesión (maqueta v15): la demo sobre la foto activa, la semana de las tres de Vennett,
// el crucigrama y el boletín. Se pinta ya en el servidor para buscadores; con sesión lleva a /liga.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/Enlace";
import { useLocale, useTranslations } from "next-intl";
import { useLanguage } from "@/i18n/Provider";
import { SelectorIdioma } from "@/components/SelectorIdioma";
import type { EstadoCriptico } from "@/lib/criptico/estado";
import { ORDEN_ESTILOS, type PortadaDemo } from "@/lib/liga/portada";
import { guardarIdeaPortada } from "@/lib/liga/ideaPortada";
import { useRedirigirSiHaySesion } from "../_sesion/SesionContext";
import { Hoja } from "../_ui/Hoja";
import { Escudo, escudoCasa } from "../_ui/Escudo";
import { CASA } from "../_ui/casa";
import { Marca } from "../_ui/Marca";
import { Demo } from "./Demo";
import { Boletin, Crucigrama, Pie, PorDentro, Semana, type BoletinPortada } from "./Secciones";
import type { Idioma } from "./formato";
import "./portada.css";

const MAX_IDEA = 300; // el mismo tope que la frase de Crear
const CASAS = ["alpha", "lambda", "omega"] as const;

function Icono() {
  return <svg className="icono" viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="por-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F0F6F6" /><stop offset="1" stopColor="#E2EEED" /></linearGradient><linearGradient id="por-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#30353B" /><stop offset="1" stopColor="#15171B" /></linearGradient><linearGradient id="por-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#13877F" /><stop offset="1" stopColor="#09534E" /></linearGradient><clipPath id="por-c"><rect width="200" height="200" rx="44" /></clipPath></defs><g clipPath="url(#por-c)"><rect width="200" height="200" fill="url(#por-f)" /><path d="M24 82H178" stroke="#0B6E68" strokeOpacity=".26" strokeWidth="2.5" strokeDasharray="6 5" /><g fill="url(#por-t)"><path d="M53 58H67V144Q67 159 82 159H104V173H82Q53 173 53 144Z" /><rect x="35" y="82" width="50" height="44" rx="5" /></g><g fill="url(#por-p)"><path d="M115 30H129V144Q129 159 144 159H166V173H144Q115 173 115 144Z" /><rect x="97" y="46" width="50" height="44" rx="5" /></g></g></svg>;
}

type Props = { demo: PortadaDemo | null; criptico: EstadoCriptico; boletin?: BoletinPortada };

export function Portada({ demo, criptico, boletin = null }: Props) {
  const sesion = useRedirigirSiHaySesion();
  const t = useTranslations();
  const idioma: Idioma = useLocale() === "en" ? "en" : "es";
  const { changing, selectLocale } = useLanguage();
  const router = useRouter();
  const [k, setK] = useState(0);
  const [hoja, setHoja] = useState<"idea" | "casa" | "quien" | null>(null);
  const [idea, setIdea] = useState("");
  const [fuera, setFuera] = useState(false);
  const hondo = useRef<HTMLDivElement>(null);

  // El aviso de sesión guardada oculta la portada hasta saber si hay que ir a la liga.
  useEffect(() => {
    if (sesion === "fuera") document.documentElement.removeAttribute("data-con-sesion");
  }, [sesion]);

  // Cabecera blanca sobre el globo; con el material del tema al salir de él (DESIGN §6).
  useEffect(() => {
    const mirar = () => setFuera((hondo.current?.getBoundingClientRect().bottom ?? 0) < 60);
    mirar();
    addEventListener("scroll", mirar, { passive: true });
    addEventListener("resize", mirar);
    return () => { removeEventListener("scroll", mirar); removeEventListener("resize", mirar); };
  }, []);

  if (sesion === "dentro") return null;

  const sugerencias = ORDEN_ESTILOS.slice(0, 4).map((c) => ({
    nombre: t(`portada_estilo_${c}_nombre`), desc: t(`portada_estilo_${c}_desc`),
  }));
  const seguir = () => {
    guardarIdeaPortada(idea);
    setHoja(null);
    router.push("/entrar?next=/crear");
  };

  return <div className="portada">
    <header className={`cab${fuera ? " fuera" : ""}`}>
      <div className="dentro">
        <Link className="marca" href="/" aria-label={t("portada_inicio")}><Icono /><Marca className="nombre" /></Link>
        <nav>
          <SelectorIdioma actual={idioma} etiqueta={t("common_idioma")} deshabilitado={changing}
            onElegir={(codigo) => { void selectLocale(codigo); }} />
          <Link className="entrar" href="/entrar">{t("landing_entrar")}</Link>
        </nav>
      </div>
    </header>

    <main>
      <div ref={hondo}><Demo datos={demo} idioma={idioma} k={k} alElegir={setK} alAbrir={setHoja} /></div>
      {demo && <PorDentro datos={demo} k={k} idioma={idioma} />}
      <div className={`dentro abajo${!demo?.semana ? " sin-semana" : ""}${!criptico ? " sin-cruci" : ""}`}>
        {demo?.semana && <Semana semana={demo.semana} idioma={idioma} alAbrir={setHoja} />}
        {criptico && <div className="derecha"><Crucigrama criptico={criptico} idioma={idioma} /></div>}
        {boletin && <Boletin boletin={boletin} idioma={idioma} />}
      </div>
      <Pie idioma={idioma} />
    </main>

    <Hoja abierta={hoja === "idea"} titulo={t("portada_hoja_idea")} cancelar={t("portada_cancelar")} accion={t("portada_seguir")}
      accionDesactivada={idea.trim().length < 10} onAccion={seguir} onCerrar={() => setHoja(null)}>
      <div className="cuerpo">
        <p className="intro">{t("portada_idea_intro")}</p>
        <textarea className="area" maxLength={MAX_IDEA} value={idea} placeholder={t("portada_idea_placeholder")}
          aria-label={t("portada_hoja_idea")} onChange={(e) => setIdea(e.target.value)} />
        <p className="cuenta num">{t("portada_idea_cuenta", { n: idea.length, max: MAX_IDEA })}</p>
        <p className="sub-tit">{t("portada_idea_estilo")}</p>
        <ul className="grupo sugs">{sugerencias.map((s) => <li key={s.nombre}>
          <button type="button" onClick={() => setIdea(`${s.nombre}: ${s.desc.charAt(0).toLowerCase()}${s.desc.slice(1)}`)}>
            <p className="t">{s.nombre}</p><p className="s">{s.desc}</p>
          </button></li>)}</ul>
        <p className="pie-grupo">{t("portada_idea_pie")}</p>
      </div>
    </Hoja>

    <Hoja abierta={hoja === "casa"} titulo={t("portada_hoja_casa")} accion={t("portada_listo")} onCerrar={() => setHoja(null)}>
      <div className="cuerpo">
        <p className="intro">{t("portada_casa_intro")}</p>
        <ul className="grupo sangria">{CASAS.map((c) => <li key={c} className="celda">
          <Escudo valor={escudoCasa(c)} casa={c} etiqueta={t("portada_escudo_casa", { nombre: CASA[c].nombre })} tamano={34} />
          <div><p className="t">{CASA[c].nombre}</p><p className="s">{t(`portada_casa_${c}`)}</p></div>
        </li>)}</ul>
        <p className="pie-grupo">{t("portada_casa_pie")}</p>
      </div>
    </Hoja>

    <Hoja abierta={hoja === "quien"} titulo={t("portada_hoja_quien")} accion={t("portada_listo")} onCerrar={() => setHoja(null)}>
      <div className="cuerpo">
        <ul className="grupo">{[1, 2, 3].map((i) => <li key={i} className="celda"><div>
          <p className="t">{t(`portada_quien_${i}_t`)}</p><p className="s">{t(`portada_quien_${i}_s`)}</p>
        </div></li>)}</ul>
        <p className="pie-grupo">{t.rich("portada_quien_pie", {
          quienes: (c) => <Link href="/quienes-somos">{c}</Link>,
          politica: (c) => <Link href="/politica-editorial">{c}</Link>,
        })}</p>
      </div>
    </Hoja>
  </div>;
}
