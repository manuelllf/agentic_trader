import { Geist, Geist_Mono } from "next/font/google";

// Fuentes propias de Beta, cargadas SOLO en esta ruta -- mismo patrón que Omega y Alpha
// (ver momentum/layout.tsx y alpha/layout.tsx): Sans para texto, Mono para cifras alineadas.
// Geist en vez de IBM Plex (12-sep-2026, "letra muy vista").
const geistSans = Geist({
  subsets: ["latin"], weight: "variable", variable: "--font-sombra-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"], weight: "variable", variable: "--font-sombra-mono",
});

export default function SombraLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${geistSans.variable} ${geistMono.variable} contents`}>{children}</div>;
}
