"use client";

// La API proyecta la ficha según permisos; la interfaz nunca reconstruye una receta privada.
// Estructura de la maqueta v1: barra, cabeza con la semana, un segmentado y tres vistas.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { BarraPestanas } from "../../_ui";
import { SegmentoLiga } from "../../liga/SegmentoLiga";
import { copiarEstrategia, getCatalogo, getFicha, reportar, type Catalogo, type Ficha } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { getSeguimiento, marcarSeguimientos, type SeguimientoEstrategia } from "@/lib/liga/seguimiento";
import { CabeceraFicha } from "./CabeceraFicha";
import { CabezaFicha } from "./CabezaFicha";
import { CarteraFicha } from "./CarteraFicha";
import { MetodologiaFicha } from "./MetodologiaFicha";
import { ResultadosFicha } from "./ResultadosFicha";
import "./ficha.css";

type Vista = "cartera" | "metodo" | "resultados";

/** Esqueleto con la forma de la ficha: cabeza, cifra, segmentado y cuatro filas. */
function EsqueletoFicha() {
  const t = useTranslations();
  return (
    <div role="status" aria-label={t("common_cargando")}>
      <div className="fi-cabeza">
        <span className="fi-esq" style={{ width: 56, height: 56, borderRadius: 13 }} />
        <div>
          <span className="fi-esq" style={{ width: "72%", height: 26 }} />
          <span className="fi-esq" style={{ width: "40%", height: 15, marginTop: 9 }} />
        </div>
      </div>
      <div className="fi-cifra">
        <span className="fi-esq" style={{ width: 170, height: 13 }} />
        <span className="fi-esq" style={{ width: 120, height: 34, marginTop: 8 }} />
        <span className="fi-esq" style={{ width: 230, height: 15, marginTop: 8 }} />
      </div>
      <span className="fi-esq" style={{ height: 44, marginTop: 20, borderRadius: 12 }} />
      <p className="lv-lista-cab"><span className="fi-esq" style={{ width: 160, height: 12 }} /></p>
      <ul className="lv-lista" aria-hidden="true">
        {[56, 48, 64, 40].map((ancho) => (
          <li className="lv-fila fi-emp" key={ancho}>
            <span className="lv-nombre">
              <span className="fi-esq" style={{ width: ancho, height: 17 }} />
              <span className="fi-esq" style={{ width: 120, height: 13, marginTop: 7 }} />
            </span>
            <span className="fi-esq" style={{ width: 70, height: 32, borderRadius: 8, justifySelf: "end" }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FichaContenido({ id }: { id: string }) {
  const t = useTranslations();
  const { pedirTexto, dialogo } = useConfirmar();
  const router = useRouter();
  const { estado } = useSesionRequerida(`/ficha/${id}`);
  const sesionLista = estado !== "cargando";
  const { datos: catalogo } = useCache<Catalogo | string>("catalogo", getCatalogo);

  // La caché por estrategia impide que una respuesta anterior sustituya la ficha actual.
  const { datos: ficha, cargando: cargandoFicha, refrescar: refrescarFicha } = useCache<Ficha | string>(
    sesionLista && estado === "dentro" ? `ficha:${id}` : null, () => getFicha(id), 120000,
  );
  const { datos: seguimientos } = useCache<SeguimientoEstrategia[] | string>(
    typeof ficha !== "string" && ficha?.es_dueno ? `seguimiento:${id}` : null, getSeguimiento,
  );
  const seguimiento = Array.isArray(seguimientos)
    ? seguimientos.find((s) => s.estrategia_id === id) : undefined;

  // Lo que entró desde tu última revisión se lee antes de marcarla: luego se pinta en petróleo.
  const [nuevas, setNuevas] = useState<string[]>([]);
  const revisada = useRef("");
  const marcarRevision = useCallback((s: SeguimientoEstrategia) => {
    void marcarSeguimientos([{
      estrategia_id: s.estrategia_id,
      inscripcion_id: s.ultima_inscripcion_id,
      resultado_inscripcion_id: s.ultimo_resultado_inscripcion_id,
    }]).then((r) => {
      // Mías recoge la revisión al volver.
      if (typeof r !== "string") invalidar("seguimiento");
    });
  }, []);
  // Abrir la ficha ya es revisarla: el aviso «N cambios en cartera» de Mías deja de salir al volver.
  useEffect(() => {
    if (!seguimiento) return;
    const clave = `${seguimiento.ultima_inscripcion_id}:${seguimiento.ultimo_resultado_inscripcion_id}`;
    if (revisada.current === clave) return;
    revisada.current = clave;
    if (!seguimiento.primera_revision) setNuevas(seguimiento.cambio_desde_revision?.entradas ?? []);
    marcarRevision(seguimiento);
  }, [seguimiento, marcarRevision]);

  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("cartera");

  async function alCopiar() {
    setOcupado(true);
    setAviso(null);
    const r = await copiarEstrategia(id);
    setOcupado(false);
    if (typeof r === "string") { setAviso(r); return; }
    router.push(`/crear/${r.id}`);
  }

  async function alReportar(nombre: string) {
    const motivo = await pedirTexto({
      titulo: t("ficha_reportar_titulo", { name: nombre }), texto: t("ficha_reportar_texto"),
      aceptar: t("common_enviar"), etiqueta: t("strategies_report_reason"),
    });
    if (!motivo) return;
    setOcupado(true);
    const r = await reportar("estrategia", id, motivo.trim());
    setOcupado(false);
    setAviso(typeof r === "string" ? r : t("strategies_report_thanks"));
  }

  const lista = typeof ficha === "object" && ficha ? ficha : null;
  const puedeCopiar = !!lista && !lista.es_dueno && !lista.casa && !!lista.receta
    && ["apuntada", "jugando"].includes(lista.estado);

  return (
    <main className="scroll lv-pagina fi">
      {lista ? (
        <CabeceraFicha nombre={lista.nombre} idEstrategia={lista.id} esDueno={lista.es_dueno}
          puedeCopiar={puedeCopiar} ocupado={ocupado} onCopiar={alCopiar} onReportar={() => alReportar(lista.nombre)} />
      ) : (
        <CabeceraFicha nombre="" idEstrategia={id} esDueno={false} puedeCopiar={false} ocupado sinAcciones
          onCopiar={() => undefined} onReportar={() => undefined} />
      )}

      {cargandoFicha || (!ficha && sesionLista && estado === "dentro") ? (
        <EsqueletoFicha />
      ) : typeof ficha === "string" ? (
        <div className="fi-vacio" style={{ paddingTop: 96 }} role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" />
          </svg>
          <h2>{t("ficha_error_t")}</h2>
          <p>{ficha || t("ficha_error")}</p>
          <button type="button" className="fi-boton" onClick={refrescarFicha}>{t("strategies_retry")}</button>
        </div>
      ) : lista ? (
        <div className="fi-llega">
          <CabezaFicha ficha={lista} />
          <SegmentoLiga etiquetaGrupo={t("strategies_detail_tabs")} valor={vista} onChange={setVista}
            opciones={[
              { valor: "cartera", etiqueta: t("strategies_portfolio") },
              { valor: "metodo", etiqueta: t("strategies_methodology") },
              { valor: "resultados", etiqueta: t("strategies_results") },
            ]} />
          {vista === "cartera" && <CarteraFicha ficha={lista} nuevas={nuevas} />}
          {vista === "metodo" && (
            <MetodologiaFicha ficha={lista} catalogo={typeof catalogo === "object" ? catalogo : null}
              puedeCopiar={puedeCopiar} ocupado={ocupado} onCopiar={alCopiar} />
          )}
          {vista === "resultados" && <ResultadosFicha ficha={lista} />}
          {aviso && <p className="fi-aviso" role="alert">{aviso}</p>}
        </div>
      ) : null}

      <BarraPestanas />
      {dialogo}
    </main>
  );
}
