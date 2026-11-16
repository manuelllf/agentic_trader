"use client";

// Hoja para registrar lo que ya hiciste en IBKR: marcar ejecutada, aumentar o cerrar una posición.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { ejecutarSenal } from "../api";
import { numeroTecleado } from "../logica";
import type { Senal } from "../types";
import { Hoja } from "../../_panel/ui";
import type { ModoForm } from "./Senal";
import { Campo, Estado } from "./ui";

export function HojaForm({ s, modo, precioVivo, alGuardar, alCerrar }:
  { s: Senal; modo: ModoForm; precioVivo: number | null; alGuardar: (estado: Senal["estado"], modo: ModoForm) => void; alCerrar: () => void }) {
  const t = useTranslations();
  const venta = modo === "venta";
  const abiertas = s.posicion_abierta ? Number(s.posicion_abierta.acciones) : null;
  const [acciones, setAcciones] = useState(venta && abiertas != null ? String(abiertas) : "");
  const [precio, setPrecio] = useState(String(modo === "ejecutada" ? s.entry_price : precioVivo ?? s.entry_price));
  const [comision, setComision] = useState("0");
  const [notas, setNotas] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const n = numeroTecleado(acciones);
  const p = numeroTecleado(precio);
  const demasiadas = venta && abiertas != null && n > abiertas;
  const valido = n > 0 && p > 0 && !demasiadas;
  const titulo = venta ? t("omega_ui_cerrar_posicion") : modo === "aumentar" ? t("omega_ui_aumentar") : t("omega_ui_marcar_ejecutada");

  const guardar = async () => {
    if (!valido || ocupado) return;
    setOcupado(true); setError("");
    try {
      const r = await ejecutarSenal(s.id, {
        accion: venta ? "venta" : "compra", acciones: n, precio: p, comision: numeroTecleado(comision) || 0, notas: notas.trim() || undefined,
      });
      alGuardar(r.estado as Senal["estado"], modo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t(venta ? "omega_operation_failed" : "omega_position_failed"));
      setOcupado(false);
    }
  };

  return (
    <Hoja abierta titulo={titulo} cancelar={t("common_cancelar")} accion={ocupado ? t("omega_saving") : t("pnl_omega_guardar")}
      accionDesactivada={!valido || ocupado} onAccion={guardar} onCerrar={alCerrar}>
      <div className="po-hoja">
        <Campo etiqueta={venta ? t("omega_shares_to_sell") : t("omega_shares")} valor={acciones} onCambio={setAcciones} decimal placeholder="0" />
        <Campo etiqueta={t("omega_attr_precio")} valor={precio} onCambio={setPrecio} decimal />
        <Campo etiqueta={t("omega_attr_comision")} valor={comision} onCambio={setComision} decimal />
        <Campo etiqueta={t("omega_ui_notas_opcional")} valor={notas} onCambio={setNotas} multilinea
          placeholder={t(venta || modo === "aumentar" ? "omega_attr_por_que_que_vigilar" : "omega_attr_por_que_entras_que_vigilar")} />
        {demasiadas && <Estado error>{t("pnl_omega_solo_tienes", { count: abiertas ?? 0 })}</Estado>}
        {error && <Estado error>{error}</Estado>}
        <p className="pnl-pie-grupo">{t(venta ? "pnl_omega_pie_venta" : "pnl_omega_pie_registro")}</p>
      </div>
    </Hoja>
  );
}
