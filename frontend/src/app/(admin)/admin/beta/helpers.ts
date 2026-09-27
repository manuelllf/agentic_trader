// Helpers puros de Beta (sin JSX): signo/fecha para la lectura de la traza y el color de la
// barra de score. Compartidos entre page.tsx y los componentes.
export const sign = (v: number) => (v > 0 ? "+" : "");

export const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—";

export const scoreColor = (s: number) =>
  s >= 80 ? "bg-[#6BBE8A]" : s >= 65 ? "bg-[#4FA39D]" : s >= 50 ? "bg-[#fab219]" : "bg-[#363636]";
