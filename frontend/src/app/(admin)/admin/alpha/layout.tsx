import { Geist, Geist_Mono } from "next/font/google";

// Fuentes propias de Alpha, cargadas SOLO en esta ruta -- mismo patrón que Omega
// (ver momentum/layout.tsx): Sans para texto, Mono para cifras alineadas. El resto de la app
// (Beta tiene su propio layout, Land se queda en Fraunces + sistema) no se ve afectado.
// Geist en vez de IBM Plex (12-sep-2026, "letra muy vista"): mismo criterio grotesca
// funcional, pero sin ser la fuente por defecto de medio dashboard de IA.
const geistSans = Geist({
  subsets: ["latin"], weight: "variable", variable: "--font-real-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"], weight: "variable", variable: "--font-real-mono",
});

export default function RealLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${geistSans.variable} ${geistMono.variable} contents`}>{children}</div>;
}
