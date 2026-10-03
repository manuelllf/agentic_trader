import Link from "next/link";

// Datos del titular y versión de los textos legales, en un solo sitio.
export const TITULAR = {
  nombre: "Manuel Llao Freire",
  ubicacion: "Galicia, España",
  // Con correo, todos los textos lo enseñan; sin él, remiten a la propia app.
  correo: null as string | null,
};

export const VERSION_LEGAL = "2026-10-03";
export const FECHA_LEGAL = "3 de octubre de 2026";

/** Cómo contactar con el titular: el correo si existe; si no, la propia aplicación. */
export function Contacto() {
  if (TITULAR.correo) return <a href={`mailto:${TITULAR.correo}`}>{TITULAR.correo}</a>;
  return (
    <>
      la propia aplicación (desde <Link href="/cuenta">Tu cuenta</Link>: descargar tus datos,
      cambiar tu nombre o borrar la cuenta, todo al momento)
    </>
  );
}
