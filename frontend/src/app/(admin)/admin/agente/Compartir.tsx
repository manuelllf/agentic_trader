"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TRAZOS_MARCA } from "../../../(liga)/_ui/Marca";
import { Celda, Grupo, Hoja } from "../_panel/ui";
import type { EstadoPaso } from "./Flujo";

export const ANCHO_IMAGEN = 1200, ALTO_IMAGEN = 675;
const FUENTE = '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif';

export interface PasoImagen { titulo: string; sub?: string; valor?: string; estado: EstadoPaso; subMal?: boolean }

/** La palabra Vennett con sus trazados, de `alto` px y con la base en (x, y). */
export function pintarMarca(x: CanvasRenderingContext2D, derecha: number, base: number, alto: number, tinta: string, acento: string) {
  const e = alto / 210;
  x.save(); x.translate(derecha - 999 * e, base - alto * .9); x.scale(e, e); x.translate(2, -38);
  TRAZOS_MARCA.forEach((d, i) => { x.fillStyle = i === 2 ? acento : tinta; x.fill(new Path2D(d)); });
  x.restore();
}

/** Imagen 1200 × 675 de unos pasos con pista, en claro, para X o LinkedIn. */
export function imagenPasos(titulo: string, sub: string, pasos: PasoImagen[], pie: string): HTMLCanvasElement {
  const W = ANCHO_IMAGEN, H = ALTO_IMAGEN, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  if (!x) return cv;
  const C = { bg: "#F2F2F7", surface: "#FFFFFF", line: "#D8D8DC", line2: "#C7C7CC", ink: "#000000", muted: "#6E6E73", accent: "#0B6E68", bad: "#C0392B" };
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  x.fillStyle = C.ink; x.font = `700 44px ${FUENTE}`; x.fillText(titulo, 64, 104);
  x.fillStyle = C.muted; x.font = `400 26px ${FUENTE}`; x.fillText(sub, 64, 146);
  const n = Math.min(pasos.length, 9), top = 186, alto = Math.min(100, (H - top - 92) / Math.max(n, 1));
  x.fillStyle = C.surface; x.beginPath(); x.roundRect(48, top, W - 96, alto * n, 18); x.fill();
  const sigue = (e: EstadoPaso) => e === "hecho" || e === "fijo";
  pasos.slice(0, n).forEach((p, i) => {
    const y = top + alto * i, cy = y + alto / 2, cx = 96;
    const col = p.estado === "pendiente" ? C.line2 : p.estado === "fallo" ? C.bad : C.accent;
    if (i) {
      x.fillStyle = C.line; x.fillRect(132, y, W - 96 - 84, 1);
      x.fillStyle = sigue(pasos[i - 1].estado) && p.estado !== "pendiente" ? C.accent : C.line2; x.fillRect(cx - 2, y, 4, alto / 2);
    }
    if (i < n - 1) { x.fillStyle = sigue(p.estado) && pasos[i + 1].estado !== "pendiente" ? C.accent : C.line2; x.fillRect(cx - 2, cy, 4, alto / 2); }
    x.beginPath(); x.arc(cx, cy, 13, 0, Math.PI * 2); x.fillStyle = p.estado === "hecho" || p.estado === "fallo" ? col : C.surface; x.fill();
    x.lineWidth = 4; x.strokeStyle = col; x.stroke();
    if (p.estado === "fijo" || p.estado === "curso") { x.beginPath(); x.arc(cx, cy, 5, 0, Math.PI * 2); x.fillStyle = C.accent; x.fill(); }
    if (p.estado === "hecho") {
      x.strokeStyle = "#fff"; x.lineWidth = 3.5; x.lineCap = "round";
      x.beginPath(); x.moveTo(cx - 6, cy + 1); x.lineTo(cx - 1.5, cy + 5.5); x.lineTo(cx + 6.5, cy - 4.5); x.stroke();
    }
    const conSub = Boolean(p.sub) && alto >= 60;
    x.fillStyle = C.ink; x.font = `600 28px ${FUENTE}`; x.fillText(p.titulo, 132, conSub ? cy - 4 : cy + 10);
    if (conSub && p.sub) {
      x.fillStyle = p.subMal ? C.bad : C.muted; x.font = `400 22px ${FUENTE}`;
      let s = p.sub;
      while (x.measureText(s).width > 760 && s.length > 4) s = s.slice(0, -2);
      x.fillText(s === p.sub ? s : `${s}…`, 132, cy + 26);
    }
    if (p.valor) { x.fillStyle = C.muted; x.font = `400 26px ${FUENTE}`; x.textAlign = "right"; x.fillText(p.valor, W - 80, cy + 9); x.textAlign = "left"; }
  });
  x.fillStyle = C.muted; x.font = `400 22px ${FUENTE}`; x.fillText(pie, 64, H - 40);
  pintarMarca(x, W - 64, H - 40, 30, C.ink, C.accent);
  return cv;
}

export function descargar(url: string, nombre: string) {
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
}

/** Hoja de compartir: la imagen tal cual saldrá, guardar y copiar. La imagen se pinta una vez, al abrirla,
 *  con lo que haya en ese momento. */
export function HojaCompartir({ abierta, crear, nombre, alt, onCerrar, pie, acciones }: {
  abierta: boolean; crear: () => HTMLCanvasElement; nombre: string; alt: string; onCerrar: () => void; pie?: string; acciones?: ReactNode;
}) {
  const t = useTranslations();
  const [imagen, setImagen] = useState<{ cv: HTMLCanvasElement; url: string } | null>(null);
  const [copia, setCopia] = useState<"" | "ok" | "mal">("");
  const crearRef = useRef(crear);
  useEffect(() => { crearRef.current = crear; });
  useEffect(() => {
    if (!abierta) { setImagen(null); setCopia(""); return; }
    const cv = crearRef.current();
    setImagen({ cv, url: cv.toDataURL("image/png") });
  }, [abierta]);
  const copiar = async () => {
    if (!imagen) return;
    try {
      const blob = await new Promise<Blob | null>(ok => imagen.cv.toBlob(ok));
      if (!blob) throw new Error("sin imagen");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopia("ok");
    } catch { setCopia("mal"); }
  };
  return (
    <Hoja abierta={abierta} titulo={t("pnl_agente_compartir")} accion={t("admin_pnl_listo")} onCerrar={onCerrar}>
      <div className="pa-hoja pa-vista">
        {/* eslint-disable-next-line @next/next/no-img-element -- imagen pintada en el navegador (data:), no hay nada que optimizar */}
        {imagen && <img className="pa-imagen" src={imagen.url} alt={alt} width={ANCHO_IMAGEN} height={ALTO_IMAGEN} />}
        <div className="pa-compartir-acc">
          <Grupo pie={pie ?? t("pnl_agente_compartir_pie")}>
            <Celda titulo={t("pnl_agente_compartir_guardar")} tono="accion" onClick={() => imagen && descargar(imagen.url, `${nombre}.png`)} />
            <Celda titulo={copia === "ok" ? t("pnl_agente_compartir_copiada") : copia === "mal" ? t("pnl_agente_compartir_no_copia") : t("pnl_agente_compartir_copiar")}
              tono="accion" onClick={copiar} />
            {acciones}
          </Grupo>
        </div>
      </div>
    </Hoja>
  );
}
