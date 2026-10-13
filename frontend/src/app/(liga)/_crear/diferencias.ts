export function diferenciaCartera(antes: string[], despues: string[]): { entra: string[]; sale: string[] } {
  const previas = new Set(antes), siguientes = new Set(despues);
  return { entra: [...siguientes].filter(t => !previas.has(t)), sale: [...previas].filter(t => !siguientes.has(t)) };
}
