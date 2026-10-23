const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function partes(fecha: Date) {
  const p = formato.formatToParts(fecha);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => Number(p.find(x => x.type === tipo)?.value);
  return { y: valor("year"), m: valor("month"), d: valor("day"), h: valor("hour"), min: valor("minute"), s: valor("second") };
}

export function fechaMadrid(fecha = new Date()): string {
  const { y, m, d } = partes(fecha);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function segundosHastaMedianoche(fecha = new Date()): number {
  const { y, m, d } = partes(fecha);
  const objetivo = Date.UTC(y, m - 1, d + 1);
  let medianoche = objetivo;
  // El desfase se calcula en la medianoche destino para respetar el cambio de hora.
  for (let i = 0; i < 3; i++) {
    const p = partes(new Date(medianoche));
    const desfase = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - medianoche;
    medianoche = objetivo - desfase;
  }
  return Math.max(0, Math.ceil((medianoche - fecha.getTime()) / 1000));
}

export function reloj(segundos: number): string {
  return [Math.floor(segundos / 3600), Math.floor(segundos / 60) % 60, segundos % 60]
    .map(n => String(n).padStart(2, "0")).join(":");
}
