import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { Contacto, TITULAR } from "../datos";

export const metadata = { title: "Aviso legal — índicem" };

// Solo nombre, lugar y contacto mientras no haya actividad económica; al cobrar hay que añadir
// NIF y domicilio.
export default function Aviso() {
  return (
    <PlantillaLegal titulo="Aviso legal">
      <h2>Titular</h2>
      <ul>
        <li><b>Nombre</b>: {TITULAR.nombre}</li>
        <li><b>Lugar</b>: {TITULAR.ubicacion}</li>
        <li><b>Contacto</b>: <Contacto /></li>
      </ul>
      <p>
        índicem es un juego gratuito de simulación, sin publicidad ni cobros. Si eso cambia, este
        aviso se completará con el NIF y el domicilio del titular antes de cobrar nada.
      </p>

      <h2>Propiedad intelectual</h2>
      <p>
        El diseño, el código y los textos son de su titular. Los nombres de empresas e índices (como
        «S&amp;P 500») pertenecen a sus propietarios y se usan solo para identificarlos. Cada
        persona conserva sus contenidos; ver los <Link href="/legal/terminos">términos</Link>.
      </p>

      <h2>Más información</h2>
      <p>
        <Link href="/legal/terminos">Términos de uso</Link>,{" "}
        <Link href="/legal/privacidad">política de privacidad</Link> y{" "}
        <Link href="/legal/cookies">política de cookies</Link>. Ley aplicable: española.
      </p>
    </PlantillaLegal>
  );
}
