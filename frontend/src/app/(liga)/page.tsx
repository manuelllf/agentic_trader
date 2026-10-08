import type { Viewport } from "next";
import { Portada } from "./_portada/Portada";

// La barra del sistema sigue el tema para acompañar los colores de la portada.
// Se repite el viewport raíz porque esta exportación lo sustituye.
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0C0D" },
  ],
};

export default function Page() {
  return <Portada />;
}
