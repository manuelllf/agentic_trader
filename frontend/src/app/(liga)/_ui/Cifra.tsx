import { claseSigno, porcentaje } from "@/lib/liga/format";

// Cifra con signo (DESIGN.md §1.8: «siempre signo, unidad y referencia»). El color nunca va
// solo: el signo +/− y el «0,0» explícito lo acompañan siempre (§11: «nada se comunica solo
// con color»).
export interface CifraProps {
  valor: number;
  decimales?: number;
  className?: string;
  /** Por defecto usa `valor` para leerlo; pásalo si hace falta más contexto (p. ej. el chart). */
  ariaLabel?: string;
}

export function Cifra({ valor, decimales = 1, className, ariaLabel }: CifraProps) {
  const clases = ["num", claseSigno(valor, decimales), className].filter(Boolean).join(" ");
  return (
    <span className={clases} aria-label={ariaLabel}>
      {porcentaje(valor, decimales)}
    </span>
  );
}
