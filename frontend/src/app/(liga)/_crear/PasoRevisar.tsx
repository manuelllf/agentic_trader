"use client";

import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { useEffect, useState, type Ref } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { PreviewSeleccion } from "@/lib/liga/api";
import { miles } from "@/lib/liga/format";
import { Escudo, escudoAleatorio, luminancia, PALETA, type EscudoValor } from "../_ui/Escudo";
import { Hoja } from "../_ui/Hoja";
import { SegmentoLiga } from "../liga/SegmentoLiga";
import { CabGrupo, Marca } from "./piezas";

export type PropsRevisar = {
  preview: PreviewSeleccion | null;
  nombre: string; cambiarNombre: (nombre: string) => void;
  nombreRef?: Ref<HTMLInputElement>; errorNombre?: boolean;
  escudo?: EscudoValor; cambiarEscudo?: (escudo: EscudoValor) => void;
  visibilidad?: "privada" | "publicada"; cambiarVisibilidad?: (v: "privada" | "publicada") => void;
  declara?: "si" | "no" | null; cambiarDeclara?: (v: "si" | "no") => void;
  faltanReglas?: boolean; pro?: boolean;
};

export function PasoRevisar(p: PropsRevisar) {
  const t = useTranslations(), idioma = useLocale() === "en" ? "en" : "es";
  const [escudoAbierto, setEscudoAbierto] = useState(false);
  const evaluadas = p.preview?.evaluadas ?? null;
  const etapas = [
    { n: evaluadas, clave: "mercado" },
    { n: p.preview?.cumplen_reglas ?? null, clave: "cumplen" },
    { n: p.preview?.seleccionadas ?? null, clave: "entran" },
  ];
  const faltaDeclarar = p.visibilidad === "publicada" && !p.declara;

  return <div className="paso-revisar">
    {p.escudo && <div className="cr-identidad">
      <button type="button" className="cr-escudo-btn" aria-label={t("builder_edit_crest")} onClick={() => setEscudoAbierto(true)}>
        <Escudo valor={p.escudo} etiqueta={t("builder_crest_preview")} tamano={88} /></button>
      <button type="button" className="cr-enlace pequeno" onClick={() => setEscudoAbierto(true)}>{t("builder_editar_escudo_corto")}</button>
    </div>}
    <div className={`cr-grupo${p.errorNombre ? " error" : ""}`} style={{ marginTop: 12 }}>
      <input ref={p.nombreRef} id="cName" className="cr-campo solo" value={p.nombre} maxLength={28} autoComplete="off"
        aria-label={t("builder_revisar_nombre")} aria-invalid={p.errorNombre || undefined}
        placeholder={t("builder_revisar_placeholder")} onChange={e => p.cambiarNombre(e.target.value)} />
    </div>
    {p.errorNombre && <p className="cr-pie mal" role="alert">{t("builder_name_required")}</p>}

    <CabGrupo>{t("builder_how_portfolio_formed")}</CabGrupo>
    <ol className="cr-grupo cr-embudo">{etapas.map((e, i) => <li key={e.clave} className={`cr-celda${i === 2 ? " final" : ""}`}>
      <span className="cifra num">{e.n == null ? "–" : miles(e.n, idioma)}</span>
      <span className="t"><b className="normal">{t(`builder_revisar_${e.clave}`)}</b>
        <span className="barra" style={{ width: `${evaluadas && e.n != null ? Math.min(100, Math.max(4, Math.sqrt(e.n / evaluadas) * 100)) : 4}%` }} /></span>
    </li>)}</ol>
    {p.cambiarVisibilidad && <>
      <CabGrupo><span id="revisar-quien">{t("builder_who_can_see")}</span></CabGrupo>
      <div className="cr-grupo" role="radiogroup" aria-labelledby="revisar-quien">
        {(["privada", "publicada"] as const).map(v => <button type="button" className="cr-celda" role="radio" key={v}
          aria-checked={p.visibilidad === v} onClick={() => p.cambiarVisibilidad!(v)}>
          <span className="t"><b className="normal">{t(v === "privada" ? "builder_result_only" : "builder_revisar_publicada")}</b>
            <small>{t(v === "privada" ? "builder_result_only_help" : "builder_published_help")}</small></span>
          <span /><Marca marcada={p.visibilidad === v} /></button>)}
        {p.visibilidad === "publicada" && p.cambiarDeclara && <div className="cr-bloque revisar-declara">
          <span className="cr-etiqueta">{t("builder_position_declaration")}</span>
          <SegmentoLiga className="cr-seg-pequeno" etiquetaGrupo={t("builder_position_declaration")} valor={p.declara ?? null}
            opciones={[{ valor: "si" as const, etiqueta: t("builder_yes") }, { valor: "no" as const, etiqueta: t("builder_no") }]}
            onChange={p.cambiarDeclara} />
        </div>}
      </div>
      {faltaDeclarar && <p className="cr-pie mal">{t("builder_declaration_required")}</p>}
      {PLANES_VISIBLES && !p.pro && <p className="cr-pie"><Link href="/cuenta/plan">{t("planes_ver")}</Link></p>}
    </>}
    {p.faltanReglas && <p className="cr-pie mal" role="status">{t("builder_rules_required")}</p>}

    {p.escudo && p.cambiarEscudo && <HojaEscudo abierta={escudoAbierto} valor={p.escudo}
      onListo={v => { p.cambiarEscudo!(v); setEscudoAbierto(false); }} onCerrar={() => setEscudoAbierto(false)} />}
  </div>;
}

/* ---------- Escudo: forma, dibujo, colores e iniciales ---------- */
const FORMAS: { valor: EscudoValor["forma"]; etiqueta: string }[] = [
  { valor: "circulo", etiqueta: "builder_shape_circle" }, { valor: "escudo", etiqueta: "builder_shape_shield" },
  { valor: "hexagono", etiqueta: "builder_shape_hexagon" },
];
const DIBUJOS: { valor: EscudoValor["dibujo"]; etiqueta: string }[] = [
  { valor: "liso", etiqueta: "builder_pattern_solid" }, { valor: "mitades", etiqueta: "builder_pattern_halves" },
  { valor: "diagonal", etiqueta: "builder_pattern_diagonal" }, { valor: "franja", etiqueta: "builder_pattern_stripe" },
];

function HojaEscudo({ abierta, valor, onListo, onCerrar }: {
  abierta: boolean; valor: EscudoValor; onListo: (v: EscudoValor) => void; onCerrar: () => void;
}) {
  const t = useTranslations();
  const [v, setV] = useState(valor);
  // Cada vez que se abre parte del escudo guardado; Cancelar descarta lo probado.
  useEffect(() => { if (abierta) setV(valor); }, [abierta, valor]);
  const muestras = (campo: "color1" | "color2") => <div className="cr-muestras">{PALETA.map(c => <button type="button" key={c}
    className="cr-muestra" style={{ background: c }} aria-pressed={v[campo] === c} aria-label={t("builder_color", { color: c })}
    onClick={() => setV({ ...v, [campo]: c })} />)}</div>;
  return <Hoja abierta={abierta} titulo={t("builder_escudo")} cancelar={t("builder_cancelar")} accion={t("builder_listo")}
    onAccion={() => onListo(v)} onCerrar={onCerrar}>
    <div className="cr-hoja-pad">
      <div className="cr-identidad" style={{ marginTop: 4 }}>
        <Escudo valor={v} etiqueta={t("builder_crest_preview")} tamano={96} />
        <button type="button" className="cr-enlace pequeno" onClick={() => setV(escudoAleatorio())}>{t("builder_random_crest")}</button>
      </div>
      <div className="cr-grupo" style={{ marginTop: 12 }}>
        <div className="cr-bloque"><span className="cr-etiqueta">{t("builder_shape")}</span>
          <SegmentoLiga className="cr-seg-pequeno" etiquetaGrupo={t("builder_shape")} valor={v.forma}
            opciones={FORMAS.map(f => ({ valor: f.valor, etiqueta: t(f.etiqueta) }))} onChange={forma => setV({ ...v, forma })} /></div>
        <div className="cr-bloque"><span className="cr-etiqueta">{t("builder_pattern")}</span>
          <SegmentoLiga className="cr-seg-pequeno" etiquetaGrupo={t("builder_pattern")} valor={v.dibujo}
            opciones={DIBUJOS.map(d => ({ valor: d.valor, etiqueta: t(d.etiqueta) }))} onChange={dibujo => setV({ ...v, dibujo })} /></div>
        <div className="cr-bloque"><span className="cr-etiqueta">{t("builder_primary_color")}</span>{muestras("color1")}</div>
        {v.dibujo !== "liso" && <div className="cr-bloque"><span className="cr-etiqueta">{t("builder_secondary_color")}</span>{muestras("color2")}</div>}
        <div className="cr-celda">
          <span className="t"><b className="normal">{t("builder_iniciales")}</b>
            <small>{t(luminancia(v.color1) > 0.4 ? "builder_iniciales_tinta_oscura" : "builder_iniciales_tinta_clara")}</small></span>
          <input className="cr-campo cr-ini" maxLength={2} autoComplete="off" placeholder="AB" aria-label={t("builder_iniciales")}
            value={v.iniciales ?? ""} onChange={e => setV({ ...v, iniciales: e.target.value.toUpperCase().replace(/[^A-ZÑ0-9]/g, "") })} />
        </div>
      </div>
    </div>
  </Hoja>;
}
