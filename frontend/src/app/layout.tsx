import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Plus_Jakarta_Sans } from "next/font/google";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { LanguageProvider } from "@/i18n/Provider";
import { normalizeLocale } from "@/i18n/locale";
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
// Las de la portada: titulares (la letra del logotipo) y cifras. Sin precarga, porque solo las usa
// la portada; el navegador las pide cuando hacen falta.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"], weight: ["700", "800"], display: "swap", variable: "--font-display", preload: false,
});
const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin", "latin-ext"], weight: ["400", "600", "700"], display: "swap", variable: "--font-data",
  preload: false, adjustFontFallback: false,
});

const baseMetadata: Metadata = {
  title: "Vennett",
  applicationName: "Vennett",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Vennett" },
  icons: {
    icon: [
      { url: "/favicon.svg?v=vennett-8", type: "image/svg+xml" },
      { url: "/favicon.ico?v=vennett-8", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon-192.png?v=vennett-9", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png?v=vennett-9",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  return { ...baseMetadata, description: t("system_descripcion_app"),
    manifest: `/api/i18n/manifest?locale=${locale}` };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sin esto el móvil no da el margen inferior del sistema y la barra de pestañas queda bajo los gestos.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0F10" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [language, messages] = await Promise.all([getLocale(), getMessages()]);
  const locale = normalizeLocale(language) ?? "es";
  return (
    <html lang={locale} className={`${atkinson.variable} ${jakarta.variable} ${mono.variable}`}>
      <body><LanguageProvider locale={locale} messages={messages}>{children}</LanguageProvider></body>
    </html>
  );
}
