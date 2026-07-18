import type { NextConfig } from "next";

// Cabeceras de seguridad para TODAS las rutas (aplican igual en Vercel).
// Sin CSP completa a propósito: Next usa inline scripts y una CSP estricta exigiría
// fontanería de nonces para no romper la app — sobrediseño hoy. `frame-ancestors` sí,
// que es lo que corta el clickjacking (nadie puede meter /real en un iframe).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // El navegador no re-interpreta tipos MIME (sirve lo que dice ser).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Al navegar a terceros no se filtra la URL completa, solo el origen.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HTTPS siempre, 2 años, con subdominios (Vercel ya lo manda en *.vercel.app; esto
  // lo garantiza también en cualquier dominio propio futuro).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Genera un servidor autocontenido para una imagen Docker mínima.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
