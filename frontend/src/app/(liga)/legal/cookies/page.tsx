import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";

export const metadata = { title: "Cookies — liguilla" };

// Guarda la sesión (`lib/liga/supabase.ts`) y la idea de la portada (`lib/liga/idea.ts`). Si se
// añade algo (captcha, analítica), actualizar esta página antes de desplegarlo.
export default function Cookies() {
  return (
    <PlantillaLegal
      titulo="Política de cookies"
      resumen={[
        "No usamos cookies, ni propias ni de terceros. Sin analítica ni publicidad.",
        "Solo guardamos en el navegador tu sesión y, un momento, la idea que escribas en la portada.",
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
          <tr>
            <td>liguilla-idea (almacenamiento de sesión)</td>
            <td>Guardar la idea que escribes en la portada mientras entras, para que llegue al
              editor. No se envía a ningún sitio. También es necesaria para lo que pides.</td>
            <td>Hasta que el editor la recoge, o hasta que cierres la pestaña.</td>
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
