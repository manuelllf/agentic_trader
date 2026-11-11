import type { ReactNode } from "react";
import IndicadorDeDesplazamiento from "@/components/IndicadorDeDesplazamiento";
import "./_blog/blog.css";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <div className="lg blog-publico"><IndicadorDeDesplazamiento />{children}</div>;
}
