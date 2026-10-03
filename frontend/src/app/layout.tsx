import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
// Aquí y no en (liga)/layout: la 404 cuelga de este layout y, si no, sale sin estilos. Todo va
// bajo .lg, así que las salas no se enteran.
import "./(liga)/liga.css";

// La letra de la liguilla (DESIGN.md §3). Las salas cargan la suya en su layout, bajo /admin.
// next/font no tiene las métricas de esta letra para ajustar la de reserva: sin el ajuste,
// avisa en cada build.
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"], weight: "variable", display: "swap", variable: "--font-lg",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Vennett",
  applicationName: "Vennett",
  description: "Pon a prueba tu estrategia y compárala con el S&P 500, jornada a jornada.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Vennett" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0F10" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={atkinson.variable}>
      <body>{children}</body>
    </html>
  );
}
