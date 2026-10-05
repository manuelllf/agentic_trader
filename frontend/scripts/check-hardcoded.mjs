// Falla si queda texto visible o un formato de idioma escrito a mano fuera de los catálogos.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const RAIZ = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ATRIBUTOS = new Set(["title", "aria-label", "placeholder", "alt", "label", "text", "description", "aria-description"]);
const LOCALES_FIJOS = /^(es|en)(-[A-Z]{2})?$/;
// Marcas y términos técnicos que se escriben igual en los dos idiomas.
const IGUALES = new Set(["vennett", "alpha", "beta", "omega", "lambda", "jev", "s&p", "vs", "etf", "usd",
  "pro", "ok", "per", "roe", "ath", "ebitda", "sharpe", "sortino", "deepseek", "flash", "qwen", "yahoo",
  "supabase", "railway", "vercel", "google", "mb", "vix", "score", "gate", "pts", "error", "admin"]);
const hallazgos = [];

function* ficheros(dir) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) yield* ficheros(ruta);
    else if (/\.(tsx|ts)$/.test(nombre) && !/\.test\./.test(nombre)) yield ruta;
  }
}

function visible(texto) {
  const limpio = texto.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (!/\p{L}{2,}/u.test(limpio) || /^[a-z0-9]+([-_][a-z0-9]+)+$/i.test(limpio)) return false;
  return limpio.split(/[\s·:()/%,.;-]+/).filter(Boolean).some((palabra) =>
    !IGUALES.has(palabra.toLowerCase()) && !/[\d_]/.test(palabra) && palabra.length > 2
    && palabra !== palabra.toUpperCase());
}

for (const ruta of ficheros(RAIZ)) {
  const rel = relative(RAIZ, ruta).split(sep).join("/");
  if (rel.startsWith("i18n/")) continue;
  const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true,
    ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const anotar = (nodo, tipo, texto) => {
    const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart());
    hallazgos.push(`${rel}:${line + 1}  ${tipo}  ${texto.replace(/\s+/g, " ").trim().slice(0, 80)}`);
  };
  const recorrer = (nodo) => {
    if (ts.isJsxText(nodo) && visible(nodo.getText())) anotar(nodo, "texto en JSX", nodo.getText());
    if (ts.isJsxAttribute(nodo) && ATRIBUTOS.has(nodo.name.getText()) && nodo.initializer
        && ts.isStringLiteral(nodo.initializer) && visible(nodo.initializer.text)) {
      anotar(nodo, `atributo ${nodo.name.getText()}`, nodo.initializer.text);
    }
    if (ts.isCallExpression(nodo)) {
      const llamada = nodo.expression.getText();
      const arg0 = nodo.arguments[0];
      if (/^(window\.)?(confirm|alert)$/.test(llamada) && arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0) || ts.isTemplateExpression(arg0))) {
        anotar(nodo, llamada, arg0.getText());
      }
      if (/toLocale\w*String$/.test(llamada) && arg0 && ts.isStringLiteral(arg0) && LOCALES_FIJOS.test(arg0.text)) {
        anotar(nodo, "idioma fijo", nodo.getText());
      }
    }
    if (ts.isNewExpression(nodo) && /^Intl\./.test(nodo.expression.getText())) {
      const arg0 = nodo.arguments?.[0];
      // "en-CA" solo sirve para obtener fechas ISO.
      if (arg0 && ts.isStringLiteral(arg0) && arg0.text !== "en-CA" && LOCALES_FIJOS.test(arg0.text)) anotar(nodo, "idioma fijo", nodo.getText());
    }
    if (ts.isConditionalExpression(nodo) && /locale\s*===\s*"(en|es)"/.test(nodo.condition.getText())
        && ts.isStringLiteral(nodo.whenTrue) && ts.isStringLiteral(nodo.whenFalse)
        && /^(es|en)(-[A-Z]{2})$/.test(nodo.whenTrue.text) ) {
      anotar(nodo, "idioma elegido a mano", nodo.getText());
    }
    ts.forEachChild(nodo, recorrer);
  };
  recorrer(fuente);
}

if (hallazgos.length) {
  console.error(`${hallazgos.length} textos o formatos fuera de los catálogos:\n${hallazgos.join("\n")}`);
  process.exit(1);
}
console.log("Sin textos ni idiomas fijos fuera de los catálogos.");
