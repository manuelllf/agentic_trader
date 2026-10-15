export function mensajeErrorLogin(
  error: { code?: string; status?: number } | null,
  t: (clave: string) => string,
): string | null {
  if (!error) return null;
  if (error.code === "email_not_confirmed") return t("auth_correo_sin_confirmar");
  return t(error.status === 429 ? "auth_muchos_intentos" : "auth_credenciales_incorrectas");
}
