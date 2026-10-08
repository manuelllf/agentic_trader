// Proveedores para entrar con una cuenta externa. Apple está montado pero apagado: se enciende
// cuando la cuenta de Apple Developer y su configuración en Supabase estén listas.
export const GOOGLE_ACTIVO = true;
export const APPLE_ACTIVO = false;

/** Solo nombres de alias válidos: minúsculas, números, punto y guion bajo, de 3 a 20. */
export function esAliasValido(alias: string): boolean {
  return /^[a-z0-9_.]{3,20}$/.test(alias);
}
