import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";

export const metadata = { title: "Términos — liguilla" };

// Grounded in plan-implementacion.md §0, §5, §10, §15, §16, D12, D17.
export default function Terminos() {
  return (
    <PlantillaLegal titulo="Términos de uso">
      <p className="legal-fecha">Última actualización: borrador, sin fecha de entrada en vigor.</p>

      <h2>Qué es liguilla</h2>
      <p>
        liguilla es un <b>juego en papel</b>: escribes una frase, la convertimos en una estrategia de
        inversión con reglas, y cada mes tu estrategia juega una jornada contra el S&amp;P 500 y
        contra las de otros jugadores, con puntos como en una liga de fútbol.
      </p>
      <p>
        <b>No es asesoramiento financiero, no gestiona dinero real y no recomienda comprar ni vender
        nada.</b> Ninguna estrategia de liguilla, sea de un jugador o de la casa (Alpha, Omega o
        Lambda), constituye una recomendación de inversión. «S&amp;P 500» se usa únicamente como
        referencia nominativa del índice; liguilla no está afiliada a S&amp;P Dow Jones Indices.
      </p>

      <h2>Quién puede jugar</h2>
      <p>
        Recomendamos liguilla a partir de 14 años. Necesitas una cuenta, con un correo válido y un
        alias propio; tu correo nunca se enseña a otros jugadores.
      </p>

      <h2>Tu cuenta</h2>
      <ul>
        <li>Eres responsable de la actividad de tu cuenta y de mantener tu contraseña a salvo.</li>
        <li>El alias, el nombre de tus estrategias y ligas, y las preguntas que publiques pasan por
          moderación (lista de bloqueo automática y, si hace falta, revisión humana). Podemos ocultar
          u ocultar contenido, o suspender una cuenta, si incumple estos términos.</li>
        <li>Puedes darte de baja cuando quieras desde <Link href="/cuenta">Tu cuenta</Link>: se borra
          de inmediato (ver <Link href="/legal/privacidad">Privacidad</Link>).</li>
      </ul>

      <h2>Tus estrategias</h2>
      <ul>
        <li>Una estrategia es un conjunto de reglas del catálogo de liguilla, no código ni una
          fórmula libre.</li>
        <li>Al publicar una estrategia declaras que las empresas que entran no son una recomendación
          tuya de compra ni una posición personal que estés promocionando.</li>
        <li>Podemos usar tu frase o tu pregunta (nunca tus datos personales) para generar las reglas
          o la respuesta con un proveedor de IA, como se explica en
          <Link href="/legal/privacidad"> Privacidad</Link>.</li>
      </ul>

      <h2>Créditos y plan Pro</h2>
      <ul>
        <li>Los créditos se usan para preguntas y lecturas a fondo con IA. <b>No tienen valor
          monetario</b>, no son un medio de pago, no se pueden transferir ni canjear por dinero.</li>
        <li>Hoy no hay pasarela de pago conectada: los créditos y el plan Pro se conceden desde
          administración, con su registro correspondiente. Cuando exista una pasarela real (Stripe u
          otra), estos términos se actualizarán antes de activarla.</li>
        <li>El plan Pro es un derecho temporal, no una suscripción cobrada automáticamente mientras no
          haya pasarela de pago.</li>
      </ul>

      <h2>Uso aceptable</h2>
      <p>
        No está permitido: suplantar a otra persona o a la casa (Alpha, Omega, Lambda), usar nombres o
        preguntas ofensivas, intentar manipular la clasificación fuera de las reglas del juego, ni
        usar liguilla para dar a entender que una estrategia es una recomendación financiera real.
      </p>

      <h2>Disponibilidad y cambios</h2>
      <p>
        liguilla está en construcción activa. Podemos cambiar reglas del catálogo, la puntuación, los
        créditos o interrumpir el servicio (parcial o totalmente) sin que ello dé derecho a
        compensación económica, dado que no hay pago real por el servicio hoy.
      </p>

      <h2>Responsabilidad</h2>
      <p>
        liguilla se ofrece «tal cual». No garantizamos que el juego esté libre de errores ni que las
        reglas reflejen con exactitud lo que haría un inversor real. No somos responsables de
        decisiones de inversión reales que tomes basándote en el contenido de la app.
      </p>

      <h2>Ley aplicable</h2>
      <p>
        Estos términos se rigen por la legislación española. [Fuero/jurisdicción: por confirmar con
        revisión legal.]
      </p>
    </PlantillaLegal>
  );
}
