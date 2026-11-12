import { navegarConTransicion } from "../_ui/BarraPestanas";

// Entrar en una liga empuja la pantalla desde la derecha; volver, desde la izquierda (privadas.css).
// La marca va en <html> solo durante el cambio, para que las reglas de otras pantallas no la vean.
export function irConTransicion(href: string, sentido: "empuja" | "vuelve", router: { push: (href: string) => void }) {
  document.documentElement.dataset.vt = sentido;
  navegarConTransicion(href, router);
  window.setTimeout(() => { delete document.documentElement.dataset.vt; }, 1300);
}
