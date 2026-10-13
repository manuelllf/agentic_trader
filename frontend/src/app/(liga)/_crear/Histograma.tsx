export function posicion(valor: number, minimo: number, maximo: number, logaritmico = false) {
  const transformar = (n: number) => logaritmico ? Math.log(Math.max(n, minimo)) : n;
  const amplitud = transformar(maximo) - transformar(minimo);
  return amplitud ? Math.max(0, Math.min(1, (transformar(valor) - transformar(minimo)) / amplitud)) : 0;
}

export function Histograma({ barras, desde = 0, hasta = 1 }: {
  barras: number[]; desde?: number; hasta?: number;
}) {
  const maximo = Math.max(1, ...barras);
  return <svg className="reglas-histograma" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
    {Array.from({ length: 36 }, (_, i) => {
      const alto = barras[i] ? Math.max(1.5, Math.sqrt(barras[i] / maximo) * 34) : 0;
      const dentro = (i + 0.5) / 36 >= desde && (i + 0.5) / 36 <= hasta;
      return <rect key={i} x={i * 100 / 36 + 0.25} y={34 - alto} width={100 / 36 - 0.5}
        height={alto} className={dentro ? "si" : ""} fill={dentro ? "var(--accent)" : "var(--surface2)"} />;
    })}
  </svg>;
}
