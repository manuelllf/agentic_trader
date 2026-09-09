import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

// Fuentes propias de Alpha, cargadas SOLO en esta ruta -- mismo patrón que Sala Real X
// (ver momentum/layout.tsx): Sans para texto, Mono para cifras alineadas. El resto de la app
// (Beta tiene su propio layout, Land se queda en Fraunces + sistema) no se ve afectado.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-real-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-real-mono",
});

export default function RealLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${plexSans.variable} ${plexMono.variable} contents`}>{children}</div>;
}
