import type { ReactNode } from "react";
import "./_criptico/criptico.css";

export default function CripticoLayout({ children }: { children: ReactNode }) {
  return <div className="lg criptico-publico">{children}</div>;
}
