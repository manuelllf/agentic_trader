// Forma del contenido mientras llega (DESIGN §10): sin texto visible; la etiqueta solo la leen los lectores de pantalla.
export function Esqueleto({ variante, etiqueta }: { variante: "juego" | "lista"; etiqueta: string }) {
  return <div className={`cr-esq cr-esq-${variante}`} role="status" aria-busy="true">
    <span className="cr-sr">{etiqueta}</span>
    {variante === "juego" ? <>
      <div className="cr-esq-fila" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <i aria-hidden="true" className="cr-esq-linea corta" />
      <i aria-hidden="true" className="cr-esq-titular" />
      <i aria-hidden="true" className="cr-esq-linea" />
      <div className="cr-esq-casillas" aria-hidden="true"><i className="cr-esq-caja" /><i className="cr-esq-caja" /><i className="cr-esq-caja" /><i className="cr-esq-caja" /></div>
      <i aria-hidden="true" className="cr-esq-boton" />
    </> : <>
      <i aria-hidden="true" className="cr-esq-linea" />
      <i aria-hidden="true" className="cr-esq-linea" />
      <i aria-hidden="true" className="cr-esq-linea corta" />
    </>}
  </div>;
}
