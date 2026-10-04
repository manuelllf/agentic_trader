"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { notFound } from "next/navigation";
import { Boton } from "../_ui/Boton";
import { Cargando } from "../_ui/Cargando";
import { Chip } from "../_ui/Chip";
import { Cifra } from "../_ui/Cifra";
import { Clasificacion, HuecoClasificacion } from "../_ui/Clasificacion";
import { ErrorLiga } from "../_ui/ErrorLiga";
import { Escudo, escudoCasa, type EscudoValor } from "../_ui/Escudo";
import { FilaEquipo } from "../_ui/FilaEquipo";
import { Tarjeta } from "../_ui/Tarjeta";
import { Vacio } from "../_ui/Vacio";

const ESCUDO_A: EscudoValor = { forma: "escudo", dibujo: "mitades", color1: "#1D3A6E", color2: "#FFFFFF", iniciales: "" };
const ESCUDO_B: EscudoValor = { forma: "hexagono", dibujo: "diagonal", color1: "#8FBF3F", color2: "#141414", iniciales: "" };
const ESCUDO_C: EscudoValor = { forma: "circulo", dibujo: "franja", color1: "#C0392B", color2: "#F2C94C", iniciales: "TG" };
const ESCUDO_D: EscudoValor = { forma: "escudo", dibujo: "liso", color1: "#5B6470", iniciales: "M" };

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="sec" aria-labelledby={`s-${titulo}`}>
      <div className="sec-t" id={`s-${titulo}`}>{titulo}</div>
      {children}
    </section>
  );
}

export default function Muestrario() {
  const t = useTranslations();
  const [cargandoDemo, setCargandoDemo] = useState(false);

  // Solo existe fuera de producción: aquí, y solo aquí, los datos son inventados a propósito
  // (DESIGN.md, cabecera). Sirve para revisar cada pieza del kit sin montar una pantalla real.
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="scroll">
      <h1 className="h1">{t("strategies_showcase_title")}</h1>
      <p className="meta">
        {t("strategies_showcase_intro")}
      </p>

      <Seccion titulo={t("strategies_showcase_account")}>
        <p className="fine">{t("strategies_showcase_account_note")}</p>
        <div className="sencilla-top" style={{ marginTop: 12, paddingBottom: 150 }}>
          <span className="wordmark">Vennett</span>
          <div className="cuenta">
            <button type="button" className="cuenta-boton" aria-expanded="true">
              <span>admin</span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="cuenta-menu" role="menu">
              <a className="cuenta-item" role="menuitem" href="#">{t("strategies_showcase_your_account")}</a>
              <a className="cuenta-item" role="menuitem" href="#">{t("strategies_showcase_admin")}</a>
              <button type="button" className="cuenta-item salir" role="menuitem">{t("strategies_showcase_sign_out")}</button>
            </div>
          </div>
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_crest")}>
        <p className="fine">{t("strategies_showcase_crest_note")}</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <Escudo valor={ESCUDO_A} etiqueta={t("strategies_showcase_crest_name", { name: t("strategies_showcase_wide_moat") })} tamano={34} />
          <Escudo valor={ESCUDO_B} etiqueta={t("strategies_showcase_crest_name", { name: t("strategies_showcase_understand") })} tamano={34} />
          <Escudo valor={ESCUDO_C} etiqueta={t("strategies_showcase_crest_name", { name: t("strategies_showcase_turtle") })} tamano={34} />
          <Escudo valor={ESCUDO_D} etiqueta={t("strategies_showcase_crest_name", { name: t("strategies_showcase_durable_brand") })} tamano={34} />
          <Escudo valor={escudoCasa("alpha")} etiqueta={t("strategies_showcase_house_crest", { name: "Alpha" })} tamano={34} />
          <Escudo valor={escudoCasa("omega")} etiqueta={t("strategies_showcase_house_crest", { name: "Omega" })} tamano={34} />
          <Escudo valor={escudoCasa("lambda")} etiqueta={t("strategies_showcase_house_crest", { name: "Lambda" })} tamano={34} />
        </div>
        <p className="fine">{t("strategies_showcase_detail_size")}</p>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <Escudo valor={ESCUDO_A} etiqueta={t("strategies_showcase_crest_name", { name: t("strategies_showcase_wide_moat") })} tamano={52} />
          <Escudo valor={escudoCasa("omega")} etiqueta={t("strategies_showcase_house_crest", { name: "Omega" })} tamano={52} />
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_button")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <Boton variante="principal">{t("strategies_showcase_create_mine")}</Boton>
          <Boton variante="secundario">{t("strategies_showcase_copy_code")}</Boton>
          <Boton variante="discreto">{t("strategies_showcase_undo")}</Boton>
          <div style={{ display: "flex", gap: 10 }}>
            <Boton variante="secundario" ancho="flex">{t("strategies_showcase_back")}</Boton>
            <Boton variante="principal" ancho="flex">{t("strategies_showcase_sign_it_up")}</Boton>
          </div>
          <Boton variante="secundario" tamano="pequeno">{t("strategies_showcase_change")}</Boton>
          <Boton variante="principal" disabled>{t("strategies_showcase_insufficient_credit")}</Boton>
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_chip")}>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Chip>Pro</Chip>
          <Chip onClick={() => setCargandoDemo((v) => !v)}>3,10 €</Chip>
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_number")}>
        <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 19, fontWeight: 800 }}>
          <Cifra valor={2.3} />
          <Cifra valor={-1.6} />
          <Cifra valor={0.02} />
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_card")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <Tarjeta>
            <b style={{ display: "block", fontSize: 16, color: "var(--ink)" }}>{t("strategies_showcase_low_debt")}</b>
            <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
              {t("strategies_showcase_low_debt_note")}
            </span>
          </Tarjeta>
          <Tarjeta elevada>
            <b style={{ display: "block", fontSize: 16, color: "var(--ink)" }}>{t("strategies_showcase_raised_card")}</b>
            <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("strategies_showcase_raised_card_note")}</span>
          </Tarjeta>
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_standings_row")}>
        <Clasificacion>
          <FilaEquipo
            puesto={1}
            nombre={t("strategies_showcase_wide_moat")}
            escudo={ESCUDO_A}
            resultados={["G", "G", "E"]}
            etiqueta={t("strategies_showcase_published")}
            vsIndice={4.8}
            puntos={7}
            acumulado={{rentabilidad: 9.8, sp500: 5, diferencia_pp: 4.8, desde: "2026-04-01", hasta: "2026-06-30", periodos: 3, incompleta: false}}
            movimiento={0}
          />
          <FilaEquipo
            puesto={2}
            nombre="Alpha"
            escudo={escudoCasa("alpha")}
            resultados={["G", "E", "G"]}
            etiqueta={t("strategies_showcase_home_team_label")}
            vsIndice={3.1}
            puntos={7}
            tipo="casa"
            acumulado={{rentabilidad: 8.1, sp500: 5, diferencia_pp: 3.1, desde: "2026-04-01", hasta: "2026-06-30", periodos: 3, incompleta: false}}
            movimiento={2}
            colorCasa={escudoCasa("alpha").color1}
          />
          <FilaEquipo
            puesto={3}
            nombre={t("strategies_showcase_turtle")}
            escudo={ESCUDO_C}
            resultados={["P", "E", "G"]}
            etiqueta={t("strategies_showcase_private")}
            vsIndice={-0.6}
            puntos={4}
            acumulado={{rentabilidad: -1.6, sp500: -1, diferencia_pp: -.6, desde: "2026-04-01", hasta: "2026-06-30", periodos: 3, incompleta: false}}
            movimiento={-1}
          />
          <HuecoClasificacion>{t("strategies_showcase_more_to_yours", { count: 8 })}</HuecoClasificacion>
          <FilaEquipo
            puesto={12}
            nombre={t("strategies_showcase_your_strategy")}
            escudo={ESCUDO_D}
            resultados={["E", "P", "G"]}
            etiqueta={t("strategies_showcase_your_team_label")}
            vsIndice={1.1}
            puntos={5}
            tipo="mia"
            acumulado={null}
            movimiento={null}
            abrible={false}
          />
          <HuecoClasificacion>{t("strategies_showcase_more", { count: 130 })}</HuecoClasificacion>
        </Clasificacion>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_empty")}>
        <Vacio
          titulo={t("strategies_showcase_not_playing")}
          texto={t("strategies_showcase_not_playing_note")}
          accion={{ texto: t("strategies_showcase_create_mine"), onClick: () => {} }}
        />
      </Seccion>

      <Seccion titulo={t("strategies_showcase_loading")}>
        <Boton variante="secundario" onClick={() => setCargandoDemo((v) => !v)}>
          {cargandoDemo ? t("strategies_showcase_show_data") : t("strategies_showcase_show_skeleton")}
        </Boton>
        <div style={{ marginTop: 12 }}>
          {cargandoDemo ? (
            <Cargando filas={3} />
          ) : (
            <Clasificacion>
              <FilaEquipo
                puesto={1}
                nombre={t("strategies_showcase_wide_moat")}
                escudo={ESCUDO_A}
                resultados={["G", "G", "E"]}
                etiqueta={t("strategies_showcase_published")}
                vsIndice={4.8}
                puntos={7}
              />
            </Clasificacion>
          )}
        </div>
      </Seccion>

      <Seccion titulo={t("strategies_showcase_error")}>
        <ErrorLiga
          titulo={t("strategies_showcase_standings_error")}
          mensaje={t("strategies_showcase_server_error")}
          accion={{ texto: t("strategies_showcase_retry"), onClick: () => {} }}
        />
      </Seccion>
    </main>
  );
}
