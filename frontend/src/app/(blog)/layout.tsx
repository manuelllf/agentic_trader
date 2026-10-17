import type { ReactNode } from "react";
import "./_blog/blog.css";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <div className="blog-publico">{children}</div>;
}
