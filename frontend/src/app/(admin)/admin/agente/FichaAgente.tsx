"use client";

import { useLocale, useTranslations } from "next-intl";
import { Celda, Grupo, Vacio } from "../_panel/ui";
import { AgenteError } from "./api";
import { Carga, Pagina, TextoAgente } from "./Comun";
import { fecha } from "./formato";
import type { Ficha } from "./tipos";
import { useCarga } from "./useCarga";

export default function FichaAgente({ ticker, desde }: { ticker: string; desde?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<Ficha>(`/v1/fichas/${encodeURIComponent(ticker)}`);
  const noExiste = carga.error instanceof AgenteError && carga.error.estado === 404;
  const deSeguimiento = desde === "seguimiento";

  return (
    <Pagina atras={deSeguimiento ? "/admin/agente/seguimiento" : "/admin/agente?v=agente"} atrasTexto={deSeguimiento ? t("pnl_agente_seg_titulo") : undefined}>
      <h2 className="pa-h1">{ticker.toUpperCase()}</h2>
      {noExiste ? <Vacio titulo={t("pnl_agente_ficha_no_existe", { ticker: ticker.toUpperCase() })} texto={t("pnl_agente_ficha_no_existe_texto")} /> : (
        <Carga {...carga} filas={4}>
          {f => (
            <>
              <Grupo>
                <Celda titulo={t("pnl_agente_ficha_certeza")} valor={t(`pnl_agente_certeza_${f.certeza}`)} />
                <Celda titulo={t("pnl_agente_ficha_version")} valor={f.version} />
                <Celda titulo={t("pnl_agente_ficha_actualizada")} valor={fecha(f.actualizado_en ?? f.creado, locale)} />
              </Grupo>
              <TextoAgente texto={f.contenido} />
            </>
          )}
        </Carga>
      )}
    </Pagina>
  );
}
