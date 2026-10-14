/** Interruptor de los ajustes: un botón con `role="switch"` y área de toque de 44 px. */
export function Interruptor({ activo, etiqueta, desactivado = false, onCambio }: {
  activo: boolean; etiqueta: string; desactivado?: boolean; onCambio: (activo: boolean) => void;
}) {
  return <button type="button" role="switch" aria-checked={activo} aria-label={etiqueta}
    className="interruptor" disabled={desactivado} onClick={() => onCambio(!activo)} />;
}
