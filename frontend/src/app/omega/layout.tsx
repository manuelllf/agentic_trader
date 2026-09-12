import { Geist, Geist_Mono } from "next/font/google";

// Fuentes propias de Omega, cargadas SOLO en esta ruta -- el resto de la app sigue con
// la fuente de sistema, esto no la toca (ver tokens.ts, que consume las variables CSS de abajo).
// Geist en vez de IBM Plex (12-sep-2026, "letra muy vista"): mismo criterio grotesca funcional,
// pero sin ser la fuente por defecto de medio dashboard de IA -- lee más a producto propio.
const geistSans = Geist({
  subsets: ["latin"], weight: "variable", variable: "--font-momentum-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"], weight: "variable", variable: "--font-momentum-mono",
});

export default function MomentumLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${geistSans.variable} ${geistMono.variable} contents`}>{children}</div>;
}
