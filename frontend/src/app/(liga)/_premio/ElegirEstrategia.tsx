"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  getPremioYo, misEstrategias, optarAlPremio,
  type Estrategia, type PremioYo,
} from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { BarraPestanas } from "../_ui";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

export function ElegirEstrategia() {
  const t = useTranslations();
  const router = useRouter();
  const { yo } = useSesion();
  const { datos: propio } = useCache<PremioYo | string>(yo ? "premio-yo" : null, getPremioYo);
  const { datos: estrategias } = useCache<Estrategia[] | string>(yo ? "mis-estrategias" : null, misEstrategias);
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const designada = typeof propio === "object" && propio ? propio.estrategia?.id ?? null : null;

  // Elegir guarda y vuelve; tocar la que ya opta solo vuelve.
  async function elegir(id: string) {
    if (ocupada) return;
    if (id === designada) { router.back(); return; }
    setOcupada(true);
    const respuesta = await optarAlPremio(id);
    setOcupada(false);
    if (typeof respuesta === "string") { setAviso(respuesta); return; }
    setAviso(null);
    invalidar("mis-estrategias", "premio-yo");
    router.back();
  }

  let contenido;
  if (!yo) {
    contenido = <>
      <ul className="cu-grupo"><li><div className="cu-celda texto">{t("premio_sesion")}</div></li></ul>
      <Link href="/entrar?next=/premio/estrategia" className="cu-boton">{t("league_entrar")}</Link>
    </>;
  } else if (!Array.isArray(estrategias)) {
    contenido = typeof estrategias === "string"
      ? <p className="cu-pie mal" role="alert">{estrategias}</p>
      : <ul className="cu-grupo" aria-busy="true">
        {[48, 66, 40].map((w) => <li key={w}><div className="cu-celda alta">
          <span className="cu-esq" style={{ width: `${w}%` }} /></div></li>)}
      </ul>;
  } else {
    contenido = <>
      <ul className="cu-grupo">
        {estrategias.map((e) => (
          <li key={e.id}>
            <button type="button" className="cu-celda" aria-pressed={e.id === designada}
              disabled={ocupada} onClick={() => void elegir(e.id)}>
              <span>{e.nombre}</span><span />
              {e.id === designada ? <span className="marca-sel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
              </span> : <span />}
            </button>
          </li>
        ))}
      </ul>
      {aviso && <p className="cu-pie mal" role="alert">{aviso}</p>}
      <p className="cu-pie">{t("premio_estrategia_elegir")}</p>
    </>;
  }
  return <main className="scroll lv-pagina pg-pagina">
    <CabeceraPagina titulo={t("premio_estrategia")} />
    <div className="pg">{contenido}</div>
    <BarraPestanas />
  </main>;
}
