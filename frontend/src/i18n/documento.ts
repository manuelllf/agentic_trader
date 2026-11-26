/** Carga la página desde el servidor, sin la navegación interna de Next. Aparte para poder probarlo. */
export function cargarDocumento(url: string): void {
  window.location.assign(url);
}
