const CONSERVAN_ESTADO = ["/entrar", "/registrar", "/confirmar"];

export function sessionViewKey(pathname: string, uid: string | null): string {
  // El alta, el login y la confirmación abren la sesión ellos mismos: no se remontan al conseguirla.
  return CONSERVAN_ESTADO.includes(pathname) ? "acceso" : uid ?? "visitante";
}
