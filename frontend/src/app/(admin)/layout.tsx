import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import PwaInstall from "@/components/PwaInstall";
import "./admin.css";

// Las salas conservan su aspecto oscuro de siempre y su propia app instalable (/admin).
const geistSans = Geist({ subsets: ["latin"], weight: "variable", variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Salas · Vennett",
  description: "Las salas de Vennett: Alpha, Beta y Omega",
  manifest: "/admin/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Vennett · salas" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
};

// Fraunces (firma en itálica de cada sala) por Google Fonts directo, no next/font: el
// self-hosting solo entregaba una instancia estática y la "j" salía sin su gancho.
const FRAUNCES = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;"
  + "0,9..144,500;0,9..144,600;1,9..144,500&display=swap";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${geistSans.variable} salas`}>
      <link rel="stylesheet" href={FRAUNCES} precedence="default" />
      {children}
      <PwaInstall />
    </div>
  );
}
