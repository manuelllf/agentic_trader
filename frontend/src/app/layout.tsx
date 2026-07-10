import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaInstall from "@/components/PwaInstall";

export const metadata: Metadata = {
  title: "Agentic Trader",
  description: "Cazador autónomo de ineficiencias en small/mid caps US",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Agentic" },
  icons: { apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {children}
        <PwaInstall />
      </body>
    </html>
  );
}
