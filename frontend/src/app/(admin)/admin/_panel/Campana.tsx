"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { get, post } from "@/lib/api";
import { Celda, Grupo, Hoja, Vacio } from "./ui";

interface AvisoApi { id: number; tipo: string; sala: string; datos: Record<string, unknown>; creado: string; leido: boolean }
interface ListaApi { sin_leer: number; avisos: AvisoApi[] }

const TIPOS_CONOCIDOS = new Set(["ia_tope_80", "omega_prueba", "omega_nuevas", "omega_reactivadas",
  "omega_resueltas", "omega_candidatos", "agente_proveedor_pausado", "agente_presupuesto_agotado",
  "agente_ciclo_fallido", "agente_tarea_fallida"]);
const DESTINO: Record<string, string> = { omega: "/admin/omega", alphagentic: "/admin/agente", vennett: "/admin" };

const ICO_CAMPANA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9.5a6 6 0 1 1 12 0c0 4.6 1.8 6 1.8 6H4.2S6 14.1 6 9.5Z" /><path d="M10 19.5a2 2 0 0 0 4 0" />
  </svg>
);

/** Campana única del panel: lee `liga.avisos_admin`; al abrirla, los marca leídos. */
export function Campana() {
  const t = useTranslations();
  const ruta = usePathname();
  const [lista, setLista] = useState<ListaApi | null>(null);
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    let vigente = true;
    get<ListaApi>("/liga/admin/avisos").then(l => { if (vigente) setLista(l); }).catch(() => { if (vigente) setLista(null); });
    return () => { vigente = false; };
  }, [ruta]);

  const abrir = useCallback(() => {
    setAbierta(true);
    if (lista?.sin_leer) post<ListaApi>("/liga/admin/avisos/leidos", {}).then(setLista).catch(() => {});
  }, [lista]);

  const avisos = lista?.avisos ?? [];
  const sinLeer = (lista?.sin_leer ?? 0) > 0;
  const fecha = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <button type="button" className="pnl-campana" aria-haspopup="dialog"
        aria-label={t(sinLeer ? "admin_pnl_avisos_sin_leer" : "admin_pnl_avisos")} onClick={abrir}>
        {ICO_CAMPANA}
        {sinLeer && <span className="pnl-campana-punto" aria-hidden="true" />}
      </button>
      <Hoja abierta={abierta} titulo={t("admin_pnl_avisos")} accion={t("admin_pnl_listo")} onCerrar={() => setAbierta(false)}>
        {avisos.length === 0
          ? <Vacio titulo={t("admin_pnl_avisos_vacio_titulo")} texto={t("admin_pnl_avisos_vacio_texto")} />
          : <div style={{ padding: "4px 16px 8px" }}>
            <Grupo>{avisos.map(a => (
              <Celda key={a.id} href={DESTINO[a.sala] ?? "/admin"}
                titulo={TIPOS_CONOCIDOS.has(a.tipo) ? t(`admin_pnl_aviso_${a.tipo}`) : t("admin_pnl_aviso_otro", { tipo: a.tipo })}
                subtitulo={`${t(`admin_pnl_sala_${a.sala}`)} · ${fecha(a.creado)}${a.leido ? "" : ` · ${t("admin_pnl_aviso_nuevo")}`}`} />
            ))}</Grupo>
          </div>}
      </Hoja>
    </>
  );
}
