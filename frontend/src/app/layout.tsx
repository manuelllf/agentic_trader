import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import PwaInstall from "@/components/PwaInstall";

// Geist para el cuerpo de TODA la app (12-sep-2026, "letra muy vista" -- mismo criterio que
// Alpha/Beta/Omega, que ya cargan su propia instancia). Fraunces se queda reservada al titular
// de la portada, el único momento con alma tipográfica.
const geistSans = Geist({ subsets: ["latin"], weight: "variable", variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Agentic Trader",
  description: "Ranker fundamental por LLM sobre todo el mercado de EE. UU., sin sesgo de capitalización",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Agentic" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={geistSans.variable}>
      <head>
        {/* Fraunces (titular serif de la Land): vía Google Fonts directo, no next/font --
            self-hosting solo entregaba una instancia estática y la "j" salía sin su gancho
            (feedback 9-sep-2026, "la J cochambrosa"). El link directo, con el mismo rango de
            eje `opsz` que pide el mockup original, sí sirve la variable de verdad. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&display=swap" />
      </head>
      <body>
        {children}
        <PwaInstall />
      </body>
    </html>
  );
}
