import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

// Fuentes propias de Beta, cargadas SOLO en esta ruta -- mismo patrón que Sala Real X y Alpha
// (ver momentum/layout.tsx y real/layout.tsx): Sans para texto, Mono para cifras alineadas.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sombra-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sombra-mono",
});

export default function SombraLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${plexSans.variable} ${plexMono.variable} contents`}>{children}</div>;
}
