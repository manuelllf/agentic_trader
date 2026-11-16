"use client";

// Auditoría: rastro filtrable por prefijo de acción (p. ej. «admin.» o «liga.»); «Cargar más» añade la siguiente página.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";
import { Buscador, Celda, Esqueleto, Grupo, Segmentado, Vacio } from "../../_panel/ui";
import { fechaHora } from "../../_marco/formato";
import { describir, describirObjeto } from "./describir";
import "./auditoria.css";

type Entrada = {
  id: number; actor_id: string | null; accion: string; objeto: string | null;
  detalle: unknown; creada: string;
};
type ListaAuditoria = { total: number; filas: Entrada[] };
type Pestana = "acciones" | "ia" | "todo";

const CUANTOS = 50;
const PESTANAS: Pestana[] = ["acciones", "ia", "todo"];
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Auditoria() {
  const t = useTranslations();
  const locale = useLocale();
  const [segmento, setSegmento] = useState<Pestana>("acciones");
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [prefijo, setPrefijo] = useState("");
  const [buscando, setBuscando] = useState("");
  const [filas, setFilas] = useState<Entrada[] | null>(null);
  const [total, setTotal] = useState(0);
  const [fallo, setFallo] = useState("");
  const [cargandoMas, setCargandoMas] = useState(false);

  // Solo vale la última petición lanzada: una respuesta lenta anterior no pisa a la nueva.
  const ultima = useRef(0);
  const pedir = useCallback((desde: number) => {
    setFallo("");
    const n = ++ultima.current;
    const q = new URLSearchParams({
      accion_prefix: segmento === "ia" ? `ia.${buscando.replace(/^ia\./, "")}` : buscando,
      sin_ia: String(segmento === "acciones"), desde: String(desde), cuantos: String(CUANTOS),
    });
    return get<ListaAuditoria>(`/liga/admin/auditoria?${q.toString()}`)
      .then((r) => {
        if (n !== ultima.current) return;
        setTotal(r.total);
        setFilas((previas) => (desde === 0 || !previas ? r.filas : [...previas, ...r.filas.filter(f => !previas.some(p => p.id === f.id))]));
      })
      .catch((e) => { if (n === ultima.current) setFallo(errorText(e)); })
      .finally(() => { if (n === ultima.current) setCargandoMas(false); });
  }, [errorText, segmento, buscando]);
  useEffect(() => { setFilas(null); void pedir(0); }, [pedir]);

  const buscar = (e: FormEvent) => { e.preventDefault(); setBuscando(prefijo.trim()); };
  const cargarMas = () => { if (!filas) return; setCargandoMas(true); void pedir(filas.length); };

  return (
    <div className="pnl-llega">
      <Segmentado etiquetaGrupo={t("admin_audit_title")} valor={segmento} onChange={setSegmento}
        opciones={PESTANAS.map(valor => ({ valor, etiqueta: t(`admin_audit_tab_${valor}`) }))} />
      <form onSubmit={buscar}>
        <Buscador valor={prefijo} onCambio={setPrefijo} etiqueta={t("pnl_sistema_audit_buscar_aria")} placeholder={t("admin_audit_prefix_placeholder")} />
      </form>
      <p className="pnl-pie-grupo">{t("pnl_sistema_audit_pie_filtro")}</p>
      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}
      {!filas ? !fallo && <div className="ps-lista"><Esqueleto filas={6} etiqueta={t("pnl_sistema_cargando")} /></div> : (
        <>
          {filas.length === 0
            ? <Vacio titulo={t("admin_audit_empty")} texto={t("pnl_sistema_audit_vacio_texto")} />
            : (
              <div className="ps-lista">
                <Grupo pie={t("pnl_sistema_audit_vistas", { n: filas.length, total })}>
                  {filas.map(e => {
                    const objeto = e.accion.startsWith("ajustes.") ? "" : describirObjeto(e.objeto, t);
                    return <Celda key={e.id} titulo={describir(e, t, locale)} subtitulo={[objeto, fechaHora(e.creada, locale)].filter(Boolean).join(" · ")} />;
                  })}
                </Grupo>
              </div>
            )}
          {filas.length < total && (
            <div className="ps-lista">
              <Grupo>
                <Celda titulo={t("pnl_sistema_audit_mas")} tono="accion" deshabilitada={cargandoMas} onClick={cargarMas} />
              </Grupo>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AuditoriaAdmin() {
  return (
    <AuthGate>
      <Auditoria />
    </AuthGate>
  );
}
