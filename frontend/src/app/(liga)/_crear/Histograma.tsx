export function posicion(valor: number, minimo: number, maximo: number, logaritmico = false) {
  const transformar = (n: number) => logaritmico ? Math.log(Math.max(n, minimo)) : n;
  const amplitud = transformar(maximo) - transformar(minimo);
  return amplitud ? Math.max(0, Math.min(1, (transformar(valor) - transformar(minimo)) / amplitud)) : 0;
}

/** Cómo se reparte el mercado en el dato de la regla: en petróleo, las barras que pasan con el valor elegido. */
export function Histograma({ barras, desde = 0, hasta = 1 }: {
  barras: number[]; desde?: number; hasta?: number;
}) {
  const maximo = Math.max(1, ...barras);
  return <svg className="cr-histo" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
    {Array.from({ length: 36 }, (_, i) => {
      const alto = barras[i] ? Math.max(2, Math.sqrt(barras[i] / maximo) * 54) : 0;
      const dentro = (i + 0.5) / 36 >= desde && (i + 0.5) / 36 <= hasta;
      return <rect key={i} x={i * 100 / 36 + 0.3} y={56 - alto} width={100 / 36 - 0.6} rx={0.6}
        height={alto} className={dentro ? "si" : ""} fill={dentro ? "var(--accent)" : "var(--line2)"} />;
    })}
  </svg>;
}
