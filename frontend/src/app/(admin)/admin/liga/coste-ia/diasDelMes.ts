export function diasDelMes(mes: string, porDia: { dia: string; pagado_usd: string }[]): { dia: number; pagado: number }[] {
  const [anio, numeroMes] = mes.split("-").map(Number);
  const cantidad = new Date(Date.UTC(anio, numeroMes - 1 + 1, 0)).getUTCDate();
  const gastos = new Map(porDia.filter((fila) => fila.dia.slice(0, 7) === mes)
    .map((fila) => [Number(fila.dia.slice(8)), Number(fila.pagado_usd)]));
  return Array.from({ length: cantidad }, (_, indice) => ({
    dia: indice + 1,
    pagado: gastos.get(indice + 1) ?? 0,
  }));
}

export function maximoDia(dias: { pagado: number }[]): number {
  return dias.reduce((maximo, dia) => Math.max(maximo, dia.pagado), 0);
}
