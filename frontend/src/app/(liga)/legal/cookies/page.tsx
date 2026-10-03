import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";

export const metadata = { title: "Cookies — Vennett" };

// La sesión en `localStorage` (`lib/liga/supabase.ts`) es lo único que guarda la web pública.
// Si se añade algo (captcha, analítica), actualizar esta página antes de desplegarlo.
export default function Cookies() {
  return (
    <PlantillaLegal
      titulo="Política de cookies"
      resumen={[
        "No usamos cookies, ni propias ni de terceros. Sin analítica ni publicidad.",
        "Solo guardamos tu sesión en el navegador, para que no tengas que entrar cada vez.",
        "Por eso no hay banner: no hay nada que aceptar.",
      ]}
    >
      <h2>Qué guardamos en tu navegador</h2>
      <table className="legal-tabla">
        <thead>
          <tr><th>Nombre</th><th>Para qué</th><th>Cuánto dura</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>liguilla-sesion (almacenamiento local)</td>
            <td>Mantener tu sesión iniciada. Es necesario para el servicio que pides, por eso no
              requiere tu consentimiento.</td>
            <td>Hasta que cierres sesión o borres los datos del sitio.</td>
          </tr>
        </tbody>
      </table>

      <h2>Si esto cambia</h2>
      <p>
        Si añadimos algo (un captcha en el alta, por ejemplo), esta página se actualizará antes. No
        añadiremos analítica ni publicidad sin pedir antes tu consentimiento, con aceptar y
        rechazar al mismo nivel.
      </p>
      <p>
        Más sobre tus datos en la <Link href="/legal/privacidad">política de privacidad</Link>.
      </p>
    </PlantillaLegal>
  );
}
