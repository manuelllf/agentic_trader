import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

// Fuentes propias de Sala Real X, cargadas SOLO en esta ruta -- el resto de la app sigue con
// la fuente de sistema, esto no la toca (ver tokens.ts, que consume las variables CSS de abajo).
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-momentum-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-momentum-mono",
});

export default function MomentumLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${plexSans.variable} ${plexMono.variable} contents`}>{children}</div>;
}
