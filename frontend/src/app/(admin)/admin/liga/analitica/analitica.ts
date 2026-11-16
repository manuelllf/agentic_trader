export function porcentaje(parte: number, total: number): number | null {
  return total === 0 ? null : Math.round(parte / total * 100);
}

export function ritmo(actual: number, anterior: number): "subiendo" | "bajando" | "igual" {
  return actual > anterior ? "subiendo" : actual < anterior ? "bajando" : "igual";
}
