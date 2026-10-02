import { SesionProvider } from "./_sesion/SesionContext";
import { AvisoErrores } from "./_ui/AvisoErrores";
import PwaInstall from "@/components/PwaInstall";

// Todo lo de la liguilla vive dentro de .lg (liga.css, cargada en el layout raíz): sus tokens
// no llegan a las salas. `SesionProvider` resuelve sesión + perfil una sola vez aquí arriba: las
// pantallas de dentro (`page.tsx` de cada pestaña) lo leen de `useSesion()`, así cambiar de
// pestaña no repite `getSession`/`GET /liga/yo`.
export default function LigaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="lg">
      <SesionProvider>
        {children}
        <AvisoErrores />
        <PwaInstall />
      </SesionProvider>
    </div>
  );
}
