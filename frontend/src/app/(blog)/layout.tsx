import type { ReactNode } from "react";
import "./_blog/blog.css";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <div className="lg blog-publico">{children}</div>;
}
