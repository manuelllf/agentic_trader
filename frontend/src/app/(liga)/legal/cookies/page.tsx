import { PlantillaLegal } from "../PlantillaLegal";

export const metadata = { title: "Cookies — liguilla" };

// Grounded in the actual code, not just the plan: `src/lib/liga/supabase.ts` guarda la sesión en
// `localStorage` (clave `liguilla-sesion`), no en una cookie, y no hay ningún script de
// analítica, publicidad o medición en el repo (comprobado: sin gtag/posthog/plausible en
// frontend/src ni en package.json). Si eso cambia (p. ej. al integrar Turnstile, que sí pone su
// propia cookie), esta página debe actualizarse antes de desplegarlo.
export default function Cookies() {
  return (
    <PlantillaLegal titulo="Política de cookies">
      <p className="legal-fecha">Última actualización: borrador, sin fecha de entrada en vigor.</p>

      <h2>Resumen</h2>
      <p>
        liguilla no usa cookies de analítica, publicidad ni medición de ningún tipo. No hay banner de
        cookies porque no hace falta pedir tu consentimiento para nada de lo que usamos: solo lo
        estrictamente necesario para que la app funcione.
      </p>

      <h2>Cómo mantenemos tu sesión</h2>
      <p>
        Cuando entras, guardamos tu sesión de Supabase Auth en el <b>almacenamiento local de tu
        navegador</b> (localStorage), no en una cookie. Ese dato se queda en tu dispositivo, no lo
        recibimos nosotros salvo cuando tu navegador nos manda el token para confirmar que eres tú.
        Si borras los datos del sitio en tu navegador, o usas otro dispositivo, tendrás que volver a
        entrar.
      </p>

      <h2>Si más adelante añadimos algo</h2>
      <p>
        Cuando activemos el CAPTCHA (Turnstile, de Cloudflare) en el registro y la entrada, para
        frenar cuentas automáticas, ese servicio pone su propia cookie técnica mientras resuelves el
        reto. Esta página se actualizará en cuanto esté activo. No añadiremos analítica ni publicidad
        sin cambiar antes esta política y pedirte tu consentimiento.
      </p>
    </PlantillaLegal>
  );
}
