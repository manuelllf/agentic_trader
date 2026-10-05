// El informe conserva el idioma en que se escribió: se reconocen los encabezados de los dos.
const ENCABEZADOS = new RegExp(
  "(?:^|\\n|(?<=\\.)\\s+)(Recent news|Financials|Valuation|Risks|Conclusion|Catalysts"
  + "|Noticias recientes|Finanzas|Valoración|Valuación|Riesgos|Conclusión|Catalizadores):\\s*", "gi");

export function esInformeEnEspanol(texto: string): boolean {
  return /(?:Noticias recientes|Finanzas|Valoración|Valuación|Riesgos|Conclusión|Catalizadores):/i.test(texto);
}

export function textoInforme(texto: string, locale: string): string {
  const normalizado = texto.replace(/\\r\\n|\\n/g, "\n").replace(/\r\n/g, "\n")
    .replace(ENCABEZADOS, "\n\n### $1\n\n");
  const frases = new Intl.Segmenter(esInformeEnEspanol(texto) ? "es" : locale, { granularity: "sentence" });
  return normalizado.split("\n").map((linea) => {
    if (linea.length < 650 || /^(?:#|\||\s*[-*]\s)/.test(linea)) return linea;
    const parrafos: string[] = [];
    let actual = "";
    for (const { segment } of frases.segment(linea)) {
      if (actual.length >= 450) { parrafos.push(actual.trim()); actual = ""; }
      actual += segment;
    }
    if (actual) parrafos.push(actual.trim());
    return parrafos.join("\n\n");
  }).join("\n");
}
