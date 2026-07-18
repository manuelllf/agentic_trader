// Formateadores compartidos de dinero, cantidades, fechas y porcentajes.
// ÚNICA fuente: las páginas no reimplementan esto — tres copias con un "−" unicode aquí y un
// "-" ascii allá, o un redondeo distinto, son divergencias silenciosas esperando a pasar.

/** "1,234.56" — dinero sin símbolo (el llamador pone $ o €). Acepta el string-Decimal del backend. */
export const money = (x: string | number, dec = 2) =>
  Number(x).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Cantidad de acciones: hasta 4 decimales (fraccionales de IBKR), sin ceros de relleno. */
export const qty4 = (x: string | number) =>
  Number(x).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** "+$12.34" / "−$12.34" (menos UNICODE, no guion) / "$0.00" — el cero es neutro, sin signo. */
export const signMoney = (x: string | number) => {
  const n = Number(x);
  if (n === 0) return "$0.00";
  return `${n > 0 ? "+" : "−"}$${money(Math.abs(n))}`;
};

/** "12 jul, 16:30" (es-ES) o "—" sin fecha. */
export const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—";

/** "+3.2%" / "-1.5%" / "—" si null. El número llega ya redondeado del backend; aquí no se toca. */
export const fmtPct = (v: number | null | undefined) =>
  v != null ? `${v > 0 ? "+" : ""}${v}%` : "—";
