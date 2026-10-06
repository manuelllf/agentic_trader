import type { Viewport } from "next";
import { Portada } from "./_portada/Portada";

// La portada es oscura en los dos temas: la barra del sistema la acompaña. Se repite el resto del
// viewport del layout raíz porque esta exportación lo sustituye.
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0A0C0D",
};

export default function Page() {
  return <Portada />;
}
