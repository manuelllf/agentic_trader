import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { Contacto, TITULAR } from "../datos";

export const metadata = { title: "Términos de uso — liguilla" };

// Al cobrar algo real hay que revisar créditos y plan Pro (precio, desistimiento, factura) y
// completar el aviso legal con NIF y domicilio.
export default function Terminos() {
  return (
    <PlantillaLegal
      titulo="Términos de uso"
      resumen={[
        "liguilla es un juego en papel: no se invierte dinero real ni se recomienda comprar o vender nada.",
        "Los créditos no valen dinero. Hoy no se paga por nada.",
        "Puedes borrar tu cuenta cuando quieras.",
      ]}
    >
      <h2>Qué es liguilla</h2>
      <p>
        Un <b>juego de simulación</b>: eliges reglas de un catálogo y, cada mes, tu estrategia juega
        una jornada contra el S&amp;P 500 y contra las de otras personas, con puntos como en una
        liga.
      </p>
      <p>
        <b>No es asesoramiento financiero ni gestiona dinero real.</b> Ninguna estrategia, sea de
        una persona o de la casa (Alpha, Omega, Lambda), es una recomendación de inversión. «S&amp;P
        500» se usa solo para nombrar el índice; liguilla no tiene relación con S&amp;P Dow Jones
        Indices.
      </p>

      <h2>Quién presta el servicio</h2>
      <p>
        {TITULAR.nombre} ({TITULAR.ubicacion}). Contacto: <Contacto />. Más datos en el{" "}
        <Link href="/legal/aviso">aviso legal</Link>.
      </p>

      <h2>Tu cuenta</h2>
      <ul>
        <li>Es para mayores de 14 años, con un correo válido y un nombre de jugador propio. Al
          darte de alta aceptas estos términos y la{" "}
          <Link href="/legal/privacidad">política de privacidad</Link>.</li>
        <li>Guarda tu contraseña; puedes cambiarla en <Link href="/cuenta">Tu cuenta</Link>.</li>
        <li>Puedes darte de baja cuando quieras desde la misma pantalla, al instante.</li>
      </ul>

      <h2>Lo que publicas</h2>
      <ul>
        <li>Tu alias y los nombres de tus estrategias y ligas son visibles para otras personas y se
          moderan. Podemos ocultar lo que incumpla estos términos o suspender la cuenta, y te
          avisaremos cuando sea posible.</li>
        <li>Nos permites mostrar ese contenido y los resultados de tus estrategias dentro de
          liguilla, y en la clasificación histórica sin tu nombre si te das de baja.</li>
        <li>No escribas datos personales en frases, nombres o preguntas.</li>
      </ul>

      <h2>La IA</h2>
      <p>
        Algunas funciones usan IA para sugerir reglas o evaluar empresas. Puede equivocarse, va
        marcada como IA y no es una recomendación. Es opcional; al usarla, tu texto se envía al
        proveedor que indica la <Link href="/legal/privacidad">política de privacidad</Link>.
      </p>

      <h2>Créditos y plan Pro</h2>
      <ul>
        <li>Los créditos pagan las consultas de IA. <b>No tienen valor monetario</b> ni se canjean
          por dinero.</li>
        <li>Hoy no se cobra nada: administración concede los créditos y el plan Pro. Si algún día
          se cobra, te lo diremos antes y actualizaremos estos términos con el precio y tus
          derechos como consumidor.</li>
      </ul>

      <h2>Uso aceptable</h2>
      <p>
        No suplantes a otras personas ni a la casa, no uses nombres ofensivos o ilegales, no
        manipules las clasificaciones ni sobrecargues el servicio, y no presentes una estrategia
        como una recomendación financiera real.
      </p>

      <h2>Disponibilidad, datos y responsabilidad</h2>
      <p>
        liguilla está en construcción: podemos cambiar reglas, puntuación o créditos e interrumpir el
        servicio. Los datos de mercado vienen de terceros y pueden tener errores o retraso. El
        servicio se ofrece «tal cual» y las simulaciones no equivalen a una inversión real (no
        incluyen comisiones ni impuestos). Esto no limita tus derechos como consumidor.
      </p>

      <h2>Cambios y ley aplicable</h2>
      <p>
        Si cambiamos estos términos de forma importante, te avisaremos en la app antes de que
        apliquen; si no estás de acuerdo, puedes darte de baja. Se rigen por la ley española y, si
        eres consumidor, puedes acudir a los tribunales de tu domicilio.
      </p>
    </PlantillaLegal>
  );
}
