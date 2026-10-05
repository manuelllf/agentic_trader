// Helpers puros de Beta (sin JSX): signo/fecha para la lectura de la traza y el color de la
// barra de score. Compartidos entre page.tsx y los componentes.
import { localeTag } from "@/i18n/locale";

export const sign = (v: number) => (v > 0 ? "+" : "");

export const fmtDay = (iso: string | null, locale: "es" | "en") =>
  iso ? new Date(iso).toLocaleDateString(localeTag(locale), { day: "numeric", month: "short", timeZone: "UTC" }) : "—";

export const scoreColor = (s: number) =>
  s >= 80 ? "bg-[#6BBE8A]" : s >= 65 ? "bg-[#4FA39D]" : s >= 50 ? "bg-[#fab219]" : "bg-[#363636]";
