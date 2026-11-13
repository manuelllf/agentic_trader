"use client";

// Una sola página de grupos con todo el método; la API ya proyecta lo que cada persona puede ver.

import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Catalogo, Ficha } from "@/lib/liga/api";
import { PREGUNTA_VISIBLE } from "@/lib/liga/funciones";
import { tieneLista, valorRegla } from "../../_crear/reglaTexto";

const ETIQUETA_PESO: Record<string, string> = {
  negocio: "strategies_weight_business", precio: "strategies_weight_price", deuda: "strategies_weight_debt",
  pronto: "strategies_weight_catalyst", pregunta: "strategies_weight_question",
};

type Props = { ficha: Ficha; catalogo: Catalogo | null; puedeCopiar: boolean; ocupado: boolean; onCopiar: () => void };

function Privado({ titulo, texto }: { titulo: string; texto: string }) {
  return <div className="fi-vacio">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </svg>
    <h2>{titulo}</h2><p>{texto}</p>
  </div>;
}

export function MetodologiaFicha({ ficha, catalogo, puedeCopiar, ocupado, onCopiar }: Props) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const casa = ficha.casa_metodologia;

  if (casa) {
    return <>
      <p className="fi-cab-grupo">{t("ficha_como_elige")}</p>
      <div className="fi-grupo"><p className="fi-celda texto">{casa.resumen}</p></div>
      {casa.pasos.length > 0 ? <>
        <p className="fi-cab-grupo">{t("ficha_paso_a_paso")}</p>
        <ol className="fi-grupo">
          {casa.pasos.map((p, i) => (
            <li className="fi-celda fi-paso" key={p.titulo}><span>{i + 1}</span><span>{p.titulo}</span><small>{p.texto}</small></li>
          ))}
        </ol>
      </> : <p className="fi-pie-grupo">{t("ficha_pasos_privados")}</p>}
    </>;
  }

  const receta = ficha.receta;
  if (!receta) return <Privado titulo={t("ficha_metodo_privado_t")} texto={t("ficha_metodo_privado")} />;

  const total = Object.values(receta.pesos).reduce((a, b) => a + b, 0) || 1;
  const pesos = Object.entries(receta.pesos).filter(([k, v]) => v > 0 && (k !== "pregunta" || PREGUNTA_VISIBLE));
  const cadaMes = ficha.cada_dia_1;
  const sinSector = Number(receta.max_por_sector) === 0;

  return <>
    <p className="fi-cab-grupo">{t("strategies_the_idea")}</p>
    <div className="fi-grupo"><p className="fi-celda texto">{receta.idea || t("strategies_no_idea")}</p></div>

    <p className="fi-cab-grupo">{t("ficha_reglas")}</p>
    <ul className="fi-grupo">
      {receta.reglas.length === 0 && <li className="fi-celda"><span className="t">{t("strategies_no_extra_filters")}</span></li>}
      {receta.reglas.map((r, i) => {
        const def = catalogo?.reglas.find((d) => d.clave === r.clave);
        return <li className={"fi-celda" + (def && tieneLista(def) ? " apilada" : "")} key={`${r.clave}-${i}`}>
          <span className="t">{def?.titulo ?? r.clave}</span>
          {catalogo && def && def.parametros.length > 0 && <span className="valor">{valorRegla(def, r, catalogo.sectores, t, locale)}</span>}
        </li>;
      })}
    </ul>

    <p className="fi-cab-grupo">{t("ficha_que_pesa")}</p>
    <ul className="fi-grupo">
      {pesos.map(([k, v]) => {
        const pct = Math.round((v * 100) / total);
        return <li className="fi-celda fi-peso" key={k}>
          <span>{ETIQUETA_PESO[k] ? t(ETIQUETA_PESO[k]) : k}</span>
          <span className="valor">{pct}&nbsp;%</span>
          <span className="barra"><i style={{ width: `${pct}%` }} /></span>
        </li>;
      })}
    </ul>

    {PREGUNTA_VISIBLE && receta.pregunta && <>
      <p className="fi-cab-grupo">{t("strategies_ai_question")}</p>
      <div className="fi-grupo"><p className="fi-celda texto">«{receta.pregunta}»</p></div>
    </>}

    <p className="fi-cab-grupo">{t("strategies_portfolio")}</p>
    <ul className="fi-grupo">
      <li className="fi-celda"><span>{t("ficha_empresas")}</span><span className="valor">{t("ficha_hasta", { count: receta.n_empresas })}</span></li>
      <li className="fi-celda"><span>{t("ficha_reparto")}</span>
        <span className="valor">{receta.reparto === "igual" ? t("strategies_equal_weights") : t("strategies_score_weights")}</span></li>
      <li className="fi-celda"><span>{t("ficha_por_sector")}</span>
        <span className="valor">{sinSector ? t("ficha_sin_limite") : t("ficha_max_sector", { count: receta.max_por_sector })}</span></li>
      {cadaMes && <li className="fi-celda"><span>{t("ficha_cada_mes")}</span>
        <span className="valor">{cadaMes === "mantener" ? t("ficha_se_mantiene") : t("ficha_se_revisa")}</span></li>}
      {receta.excluidas.length > 0 && <li className="fi-celda"><span>{t("ficha_excluidas")}</span>
        <span className="valor">{receta.excluidas.join(", ")}</span></li>}
    </ul>
    <p className="fi-pie-grupo">{t("ficha_revision_pie")}</p>

    {puedeCopiar && <button type="button" className="fi-boton tintado" disabled={ocupado} onClick={onCopiar}>{t("strategies_copy_adjust")}</button>}
    {!ficha.casa && <p className="lv-pie">{t("strategies_user_strategy_disclaimer")}</p>}
  </>;
}
