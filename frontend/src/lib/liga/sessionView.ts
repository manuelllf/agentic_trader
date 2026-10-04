export function sessionViewKey(pathname: string, uid: string | null): string {
  // El alta y el login conservan su estado mientras Auth establece la sesión.
  return pathname === "/entrar" || pathname === "/registrar" ? "acceso" : uid ?? "visitante";
}
