import type { MetadataRoute } from "next";
import { URL_PUBLICA } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/", "/cuenta/"] },
    sitemap: `${URL_PUBLICA}/sitemap.xml`,
  };
}
