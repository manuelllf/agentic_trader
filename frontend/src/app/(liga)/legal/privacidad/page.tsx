import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";

export const metadata = { title: "Privacidad — liguilla" };

// Grounded in plan-implementacion.md §0, §5, §10, §15, §16, D12, D17 (27/28-sep-2026) y en el
// código real (no en lo que el plan dice que "se hará"): la liguilla guarda la sesión en
// localStorage del navegador (`src/lib/liga/supabase.ts`, clave `liguilla-sesion`), no en
// cookies; no hay pasarela de pago ni Turnstile integrados todavía (§16, §5.1); solo se manda a
// la IA el texto de la regla o la pregunta, nunca datos personales (§10).
export default function Privacidad() {
  return (
    <PlantillaLegal titulo="Política de privacidad">
      <p className="legal-fecha">Última actualización: borrador, sin fecha de entrada en vigor.</p>

      <h2>Quién trata tus datos</h2>
      <p>
        [Titular: nombre y NIF] es responsable del tratamiento de los datos que recogemos a través de
        liguilla. Puedes escribirnos a [correo de contacto] para cualquier cuestión sobre esta
        política.
      </p>

      <h2>Qué datos recogemos</h2>
      <ul>
        <li>Al registrarte: correo electrónico, contraseña (cifrada por Supabase Auth, nunca en
          claro) y año de nacimiento, para comprobar que tienes 14 años o más.</li>
        <li>Un alias público, distinto de tu nombre real, que es lo único que ven el resto de
          jugadores. Tu correo nunca se enseña a nadie.</li>
        <li>Las estrategias que creas: la frase que escribes, las reglas que eliges y, si la usas, la
          pregunta de sí o no que le haces a la IA sobre alguna empresa.</li>
        <li>Registros de uso de la IA (finalidad, modelo, número de tokens, coste y si hubo error),
          <b> sin el contenido</b> de tu pregunta ni la respuesta completa, que solo se guarda en su
          propia tabla, ligada a tu cuenta.</li>
        <li>Movimientos de créditos y del plan (Gratis o Pro), para poder enseñarte tu saldo y su
          historial.</li>
        <li>Datos técnicos mínimos para que la sesión funcione y para detectar abusos (dirección IP en
          los registros del servidor, por el tiempo que se indica más abajo).</li>
      </ul>
      <p>
        No pedimos ni guardamos datos bancarios: no hay pasarela de pago conectada todavía (ver
        <Link href="/legal/terminos"> Términos</Link>).
      </p>

      <h2>Para qué los usamos y con qué base legal</h2>
      <ul>
        <li><b>Prestarte el servicio</b> (ejecución del contrato): crear tu cuenta, jugar tus
          estrategias, calcular la clasificación, gestionar tus créditos.</li>
        <li><b>Tu consentimiento</b>: al registrarte aceptas estos textos (versionados) y, si usas la
          IA, el uso de tu frase o tu pregunta para generarla.</li>
        <li><b>Interés legítimo</b>: seguridad, prevención de abusos (límites de uso, moderación) y
          estadísticas agregadas de la liga, que no identifican a nadie.</li>
      </ul>

      <h2>A quién se lo pasamos (encargados del tratamiento)</h2>
      <ul>
        <li><b>Supabase</b> (autenticación y base de datos; región de la Unión Europea): guarda tu
          correo, tu contraseña cifrada y el resto de datos de la tabla anterior.</li>
        <li><b>Railway</b>: aloja el servidor que ejecuta la liguilla.</li>
        <li><b>Vercel</b>: aloja esta web.</li>
        <li><b>DeepSeek</b> y <b>Jev/TypeSafe</b>: convierten tu frase en reglas, responden tu
          pregunta de sí o no y generan las lecturas a fondo. Solo reciben el texto de la regla o la
          pregunta —<b> nunca tu correo, tu nombre real ni ningún otro dato personal</b>.</li>
        <li>Un proveedor de envío de correo [por confirmar: Resend o Brevo], solo para los correos de
          confirmación, entrada y recuperación de contraseña.</li>
      </ul>
      <p>
        Supabase, DeepSeek y Jev/TypeSafe pueden tratar datos fuera de la Unión Europea según su
        propia infraestructura; en ese caso se aplican sus garantías contractuales estándar de
        transferencia. Ninguno de ellos recibe tu correo ni tu nombre real salvo Supabase, que es
        quien gestiona tu cuenta.
      </p>

      <h2>Cuánto tiempo los guardamos</h2>
      <ul>
        <li>Los datos de tu cuenta, mientras la tengas abierta.</li>
        <li>Las pruebas de estrategias (backtests que no llegas a publicar), 90 días.</li>
        <li>Los registros técnicos del servidor, 30 días.</li>
        <li>Si publicas una estrategia y luego te das de baja, la estrategia se queda en la
          clasificación histórica marcada como «Estrategia retirada», sin ningún dato que te
          identifique.</li>
      </ul>

      <h2>Tus derechos</h2>
      <p>
        Puedes acceder, rectificar, portar o borrar tus datos, y oponerte u limitar su tratamiento,
        desde <Link href="/cuenta">Tu cuenta</Link>:
      </p>
      <ul>
        <li><b>Exportar mis datos</b>: descarga un fichero con tu información en formato legible por
          máquina (JSON), al momento.</li>
        <li><b>Darte de baja</b>: borra tu cuenta de inmediato. Tus datos personales desaparecen en
          cascada; tus estrategias publicadas quedan anonimizadas en la clasificación (ver arriba).
          No hay periodo de espera ni proceso manual.</li>
      </ul>
      <p>
        También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es) si crees
        que no hemos tratado tus datos correctamente.
      </p>

      <h2>Menores</h2>
      <p>
        Recomendamos liguilla a partir de 14 años. No pedimos documentación que lo acredite; al
        registrarte declaras tu año de nacimiento bajo tu responsabilidad.
      </p>

      <h2>Cambios en esta política</h2>
      <p>
        Si cambiamos algo importante, te lo diremos dentro de la app antes de que entre en vigor.
      </p>
    </PlantillaLegal>
  );
}
