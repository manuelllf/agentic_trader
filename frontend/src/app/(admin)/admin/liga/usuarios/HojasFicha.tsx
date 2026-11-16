"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChipFiltro, Chips, Grupo, Hoja, Segmentado } from "../../_panel/ui";
import { Campo, ICO_MARCA } from "./pp";

export const ROLES = ["usuario", "moderador", "admin"] as const;
export type Rol = (typeof ROLES)[number];
export type Motivo = "regalo" | "ajuste";

export type Plazo = "sin" | "30" | "90" | "365" | "fecha";
const PLAZOS: Plazo[] = ["sin", "30", "90", "365", "fecha"];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `AAAA-MM-DD` de hoy más `dias`, en hora local. */
export function fechaEnDias(dias: number, desde = new Date()): string {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Una fecha escrita a mano vale si tiene la forma `AAAA-MM-DD`, existe y es posterior a hoy. */
export function fechaFuturaValida(texto: string, hoy = new Date()): boolean {
  if (!FECHA.test(texto)) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const f = new Date(a, m - 1, d);
  return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d && texto > fechaEnDias(0, hoy);
}

/** Importe en dólares con hasta dos decimales; la coma vale como punto. Devuelve el texto normalizado o null. */
export function importeValido(texto: string): string | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio) || Number(limpio) <= 0) return null;
  return limpio;
}

/** Plazo del Pro o del pase: sin fecha de fin, unos días o una fecha escrita. Entrega `AAAA-MM-DD` o null. */
export function PlazoHoja({ titulo, accion, onAplicar, onCerrar }: {
  titulo: string; accion: string; onAplicar: (hasta: string | null) => void; onCerrar: () => void;
}) {
  const t = useTranslations();
  const [plazo, setPlazo] = useState<Plazo>("sin");
  const [fecha, setFecha] = useState("");
  const fechaOk = plazo !== "fecha" || fechaFuturaValida(fecha);
  const aplicar = () => {
    if (!fechaOk) return;
    onAplicar(plazo === "sin" ? null : plazo === "fecha" ? fecha : fechaEnDias(Number(plazo)));
  };
  return (
    <Hoja abierta titulo={titulo} cancelar={t("common_cancelar")} accion={accion} accionDesactivada={!fechaOk} onAccion={aplicar} onCerrar={onCerrar}>
      <div className="pp-hoja">
        <Chips etiqueta={t("pnl_personas_plazo_aria")}>
          {PLAZOS.map(p => <ChipFiltro key={p} activo={plazo === p} onClick={() => setPlazo(p)}>{t(`pnl_personas_plazo_${p}`)}</ChipFiltro>)}
        </Chips>
        {plazo === "fecha" && (
          <Campo etiqueta={t("pnl_personas_plazo_campo")} inputMode="numeric" placeholder="2026-12-31" maxLength={10} value={fecha}
            onChange={e => setFecha(e.target.value)} pie={fecha && !fechaOk ? t("pnl_personas_plazo_invalido") : undefined} />
        )}
      </div>
    </Hoja>
  );
}

/** Créditos a mano con motivo (regalo o ajuste); el importe se valida aquí y la confirmación la pide quien la abre. */
export function CreditosHoja({ onDar, onCerrar }: { onDar: (importe: string, motivo: Motivo) => void; onCerrar: () => void }) {
  const t = useTranslations();
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState<Motivo>("regalo");
  const valido = importeValido(importe);
  return (
    <Hoja abierta titulo={t("pnl_personas_creditos_titulo")} cancelar={t("common_cancelar")} accion={t("pnl_personas_creditos_dar")}
      accionDesactivada={!valido} onAccion={() => { if (valido) onDar(valido, motivo); }} onCerrar={onCerrar}>
      <div className="pp-hoja">
        <Campo etiqueta={t("pnl_personas_creditos_importe")} inputMode="decimal" placeholder="20" value={importe} onChange={e => setImporte(e.target.value)}
          pie={importe && !valido ? t("pnl_personas_creditos_invalido") : undefined} />
        <Segmentado etiquetaGrupo={t("pnl_personas_creditos_motivo")} valor={motivo} onChange={setMotivo}
          opciones={[{ valor: "regalo", etiqueta: t("pnl_personas_creditos_regalo") }, { valor: "ajuste", etiqueta: t("pnl_personas_creditos_ajuste") }]} />
      </div>
    </Hoja>
  );
}

/** Casillas de roles; al guardar entrega los roles que cambian, cada uno con su concesión o retirada. */
export function RolesHoja({ actuales, onGuardar, onCerrar }: {
  actuales: string[]; onGuardar: (cambios: { rol: Rol; conceder: boolean }[]) => void; onCerrar: () => void;
}) {
  const t = useTranslations();
  const [sel, setSel] = useState<Set<string>>(new Set(actuales));
  const alternar = (rol: Rol) => setSel(prev => { const s = new Set(prev); if (s.has(rol)) s.delete(rol); else s.add(rol); return s; });
  const cambios = ROLES.filter(r => sel.has(r) !== actuales.includes(r)).map(rol => ({ rol, conceder: sel.has(rol) }));
  return (
    <Hoja abierta titulo={t("pnl_personas_roles")} cancelar={t("common_cancelar")} accion={t("pnl_personas_guardar")}
      accionDesactivada={cambios.length === 0} onAccion={() => onGuardar(cambios)} onCerrar={onCerrar}>
      <div className="pp-hoja">
        <Grupo>
          {ROLES.map(rol => (
            <li key={rol}>
              <button type="button" role="checkbox" aria-checked={sel.has(rol)} className="pnl-celda pp-check" onClick={() => alternar(rol)}>
                <span className="marca">{ICO_MARCA}</span><span className="t"><b>{t(`pnl_personas_rol_${rol}`)}</b></span>
              </button>
            </li>
          ))}
        </Grupo>
      </div>
    </Hoja>
  );
}
