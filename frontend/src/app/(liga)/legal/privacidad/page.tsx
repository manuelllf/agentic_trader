import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { Contacto, TITULAR } from "../datos";

export const metadata = { title: "Privacidad — liguilla" };

// Solo lista los servicios que reciben datos de personas usuarias (no las fuentes de mercado).
// Si se añade un proveedor, un dato o una analítica, actualizar esta página y la de cookies.
export default function Privacidad() {
  return (
    <PlantillaLegal
      titulo="Política de privacidad"
      resumen={[
        "Guardamos lo necesario para jugar: correo, nombre de jugador, estrategias y créditos.",
        "Sin publicidad ni analítica. No vendemos ni cedemos tus datos.",
        "La IA es opcional. Si la usas, el texto que escribes se envía a un proveedor (DeepSeek, en China; Jev, en EE. UU.), nunca tu correo.",
        "Descarga tus datos o borra tu cuenta al momento desde Tu cuenta.",
      ]}
    >
      <h2>Responsable</h2>
      <p>
        {TITULAR.nombre} ({TITULAR.ubicacion}). Contacto: <Contacto />. Más datos en el{" "}
        <Link href="/legal/aviso">aviso legal</Link>.
      </p>

      <h2>Qué datos tratamos</h2>
      <ul>
        <li><b>Cuenta</b>: correo, contraseña (cifrada por Supabase; no la vemos), fechas de alta y
          de acceso, y la IP y el dispositivo de tus sesiones, que Supabase registra por seguridad.</li>
        <li><b>Perfil</b>: un nombre de jugador (alias) distinto de tu nombre real, que es lo único
          que ven los demás, y tu tema claro u oscuro. Tu correo no se enseña a nadie.</li>
        <li><b>Lo que creas</b>: nombre y escudo de tus estrategias, sus reglas, la frase con que las
          describes, tu pregunta de sí o no, sus resultados y el nombre de tus ligas privadas.</li>
        <li><b>Créditos y plan</b>: saldo, movimientos y si tienes el plan Pro.</li>
        <li><b>Uso de la IA</b>: para qué fue, modelo, tokens, coste y si falló; sin el contenido
          de tu frase ni de la respuesta.</li>
        <li><b>Reportes y errores</b>: el motivo de un reporte; en un aviso de error, la pantalla, un
          código, tu nota opcional y datos técnicos mínimos.</li>
        <li><b>Constancias</b>: qué documentos legales aceptaste y cuándo, y un registro interno de
          acciones importantes sobre tu cuenta.</li>
      </ul>
      <p>
        No recogemos tu nombre real, teléfono, dirección, fecha de nacimiento, ubicación ni datos
        bancarios.
      </p>

      <h2>Para qué y con qué base legal</h2>
      <ul>
        <li><b>Darte el servicio</b> (art. 6.1.b RGPD): cuenta, estrategias, clasificación y
          créditos.</li>
        <li><b>Seguridad y buen uso</b> (art. 6.1.f): límites de uso, prevención de abusos y
          moderación de nombres y textos públicos. Puedes oponerte (ver «Tus derechos»).</li>
        <li><b>Funciones de IA</b> (art. 6.1.a): al pulsar el botón consientes que ese texto se
          envíe al proveedor indicado abajo.</li>
        <li><b>Obligación legal</b> (art. 6.1.c): si una autoridad competente lo exige.</li>
      </ul>

      <h2>Inteligencia artificial y transferencias</h2>
      <p>Es opcional; puedes jugar solo con las reglas del catálogo. Lo que se envía:</p>
      <ul>
        <li><b>Tu frase</b> («Descríbelo con tus palabras») → <b>DeepSeek</b> (China).</li>
        <li><b>Tu pregunta de sí o no</b> → <b>Jev, de TypeSafe AI</b> (Estados Unidos), junto con
          datos públicos de cada empresa. Es encargado del tratamiento, con las cláusulas
          contractuales tipo de la UE, y no entrena sus modelos con lo que recibe.</li>
        <li>Las lecturas a fondo usan solo datos públicos de empresas. La moderación de nombres es
          por lista de palabras y revisión humana.</li>
      </ul>
      <p>
        DeepSeek trata los datos en China, fuera de la protección del RGPD, y no ofrece cláusulas
        contractuales tipo; según su política, puede usarlos para mejorar sus servicios. Por eso
        solo se usa con tu consentimiento expreso (art. 49.1.a RGPD), que das al pulsar el botón.
        No escribas datos personales en la frase ni en la pregunta.
      </p>
      <p>
        No tomamos decisiones sobre ti basadas solo en un tratamiento automatizado. La IA sugiere y
        tú decides; sus resultados van marcados como generados por IA.
      </p>

      <h2>Quién más ve tus datos</h2>
      <p>No vendemos ni cedemos tus datos. Los tratan por nuestra cuenta, como encargados (art. 28 RGPD):</p>
      <ul>
        <li><b>Supabase</b>: cuentas y base de datos, en la UE (Irlanda).</li>
        <li><b>Railway</b>: servidor de la aplicación, en Ámsterdam (UE).</li>
        <li><b>Vercel</b>: sirve esta web; ve tu IP al entrar, como cualquier servidor web.</li>
      </ul>
      <p>
        Las tres tienen matriz en Estados Unidos. Si un dato sale de la UE, lo hace con las
        cláusulas contractuales tipo de la Comisión Europea (Supabase, Railway) o con el Marco de
        Privacidad de Datos UE-EE. UU. (Vercel).
      </p>

      <h2>Cuánto tiempo los guardamos</h2>
      <ul>
        <li>Tus datos de cuenta, mientras la tengas. Al borrarla desaparecen tu correo, perfil,
          créditos, pruebas y consentimientos.</li>
        <li>Las estrategias que jugaron se quedan en la clasificación histórica como «Estrategia
          retirada», sin tu alias, sin mostrar sus reglas y sin volver a jugar.</li>
        <li>Los reportes y avisos de error se conservan sin tu identificador; el registro interno
          conserva un número interno sin nombre ni correo.</li>
        <li>Los registros técnicos de los servidores, el tiempo que fija cada proveedor.</li>
        <li>Las copias de seguridad pueden conservar tus datos un tiempo tras la baja; si se
          restaurara una, no se recuperan cuentas ya borradas.</li>
      </ul>

      <h2>Tus derechos</h2>
      <p>
        Acceso, rectificación, supresión, limitación, oposición, portabilidad y retirada del
        consentimiento. Desde <Link href="/cuenta">Tu cuenta</Link>, al momento: descargar tus
        datos (JSON), cambiar tu nombre y tu contraseña, y borrar la cuenta (te pide tu nombre de
        jugador y tu contraseña; no se puede deshacer). Para lo demás, contacta a través de{" "}
        <Contacto />. También puedes reclamar ante la Agencia Española de Protección de Datos
        (aepd.es).
      </p>

      <h2>Seguridad y menores</h2>
      <p>
        Las conexiones van cifradas y la base de datos solo deja a cada persona leer sus propios
        datos. liguilla es para mayores de 14 años (art. 7 de la Ley Orgánica 3/2018).
      </p>

      <h2>Cambios</h2>
      <p>
        Si cambia algo importante, te lo diremos en la app antes de que aplique. La fecha y la
        versión de arriba indican la vigente.
      </p>
    </PlantillaLegal>
  );
}
