import type { ReactNode } from "react";
import IndicadorDeDesplazamiento from "@/components/IndicadorDeDesplazamiento";
import "./_criptico/criptico.css";

export default function CripticoLayout({ children }: { children: ReactNode }) {
  return <div className="lg criptico-publico"><IndicadorDeDesplazamiento />{children}</div>;
}
