// Saca del código fuente cada dirección que el frontend pide a un backend. Solo lo usan las pruebas.
import ts from "typescript";

export type Servicio = "vennett" | "agente";
export type Llamada = { servicio: Servicio; metodo?: string; ruta: string; donde: string };
export type Lectura = { llamadas: Llamada[]; sinResolver: string[] };

type Envoltorio = { servicio: Servicio; metodo?: string | ((n: ts.CallExpression) => string | undefined); prefijo?: string };

const VARIABLE = "\u0000";
const BASE_API = /^(API_URL|API|process\.env\.NEXT_PUBLIC_API_URL\b.*)$/;

function metodoDeOpciones(opciones: ts.Expression | undefined): string | undefined {
  if (!opciones) return "GET";
  if (!ts.isObjectLiteralExpression(opciones)) return undefined;
  for (const p of opciones.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === "method") {
      return ts.isStringLiteral(p.initializer) ? p.initializer.text : undefined;
    }
  }
  return opciones.properties.some(ts.isSpreadAssignment) ? undefined : "GET";
}

// Las funciones que reciben la ruta. Una nueva que llame a la API se añade aquí.
function envoltorio(nombre: string, fichero: string): Envoltorio | null {
  if (nombre === "llamar" && fichero === "lib/blog/admin.ts") {
    return {
      servicio: "vennett", prefijo: "/blog/admin",
      metodo: (n) => !n.arguments[1] ? "GET" : ts.isStringLiteral(n.arguments[1]) ? n.arguments[1].text : undefined,
    };
  }
  const tabla: Record<string, Envoltorio> = {
    llamar: { servicio: "vennett", metodo: (n) => metodoDeOpciones(n.arguments[1]) },
    get: { servicio: "vennett", metodo: "GET" },
    post: { servicio: "vennett", metodo: "POST" },
    put: { servicio: "vennett", metodo: "PUT" },
    del: { servicio: "vennett", metodo: "DELETE" },
    postFile: { servicio: "vennett", metodo: "POST" },
    request: { servicio: "vennett", metodo: (n) => metodoDeOpciones(n.arguments[1]) },
    leer: { servicio: "vennett", metodo: "GET" },
    solicitarCorreo: { servicio: "vennett", metodo: "POST", prefijo: "/liga/registro" },
    getAgente: { servicio: "agente", metodo: "GET" },
    useCarga: { servicio: "agente", metodo: "GET" },
    postAgente: { servicio: "agente", metodo: "POST" },
    useLista: { servicio: "vennett", metodo: "GET" },
  };
  if (nombre === "leer" && fichero !== "lib/aprender.ts") return null;
  return Object.prototype.hasOwnProperty.call(tabla, nombre) ? tabla[nombre] : null;
}

/** Las constantes del módulo: una ruta puede guardarse en una, o en una función que la monta. */
function constantesDe(fuente: ts.SourceFile): Map<string, ts.Expression> {
  const constantes = new Map<string, ts.Expression>();
  for (const frase of fuente.statements) {
    if (!ts.isVariableStatement(frase)) continue;
    for (const d of frase.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) constantes.set(d.name.text, d.initializer);
    }
  }
  return constantes;
}

/** Las formas posibles de una expresión de ruta, con las partes variables marcadas; null si no se sabe. */
function textos(e: ts.Expression, constantes: Map<string, ts.Expression>): string[] | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) {
    return [e.head.text + e.templateSpans.map((s) => VARIABLE + s.literal.text).join("")];
  }
  if (e.kind === ts.SyntaxKind.NullKeyword) return [];
  if (ts.isConditionalExpression(e)) {
    const a = textos(e.whenTrue, constantes), b = textos(e.whenFalse, constantes);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(e)) {
    const valor = constantes.get(e.text);
    return valor && !ts.isIdentifier(valor) ? textos(valor, constantes) : null;
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const monta = constantes.get(e.expression.text);
    return monta && ts.isArrowFunction(monta) && !ts.isBlock(monta.body) ? textos(monta.body, constantes) : null;
  }
  return null;
}

/** Sin query; un trozo variable pegado al final es la query, y un segmento variable vale por cualquiera. */
export function normalizar(texto: string): string {
  const sinQuery = texto.split("?")[0].replace(new RegExp(`([^/])${VARIABLE}$`), "$1");
  const partes = sinQuery.split("/").map((p) => p.includes(VARIABLE) ? "*" : p);
  return partes.join("/").replace(/(.)\/$/, "$1");
}

export function leerLlamadas(fichero: string, codigo: string): Lectura {
  const fuente = ts.createSourceFile(fichero, codigo, ts.ScriptTarget.Latest, true,
    fichero.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const llamadas: Llamada[] = [], sinResolver: string[] = [];
  const donde = (n: ts.Node) => `${fichero}:${fuente.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const constantes = constantesDe(fuente);

  const anotar = (n: ts.Node, formas: string[], env: Envoltorio, metodo: string | undefined) => {
    for (const forma of formas) {
      llamadas.push({ servicio: env.servicio, metodo, ruta: normalizar((env.prefijo ?? "") + forma), donde: donde(n) });
    }
  };

  (function recorrer(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const env = envoltorio(n.expression.text, fichero), ruta = n.arguments[0];
      if (env && ruta) {
        const formas = textos(ruta, constantes);
        if (formas) anotar(n, formas, env, typeof env.metodo === "function" ? env.metodo(n) : env.metodo);
        else sinResolver.push(`${fichero} ${n.expression.text}(${ruta.getText()})`);
      }
    }
    // `${API_URL}/...` escrito a mano, dentro o fuera de un fetch.
    if (ts.isTemplateExpression(n) && n.head.text === "" && BASE_API.test(n.templateSpans[0].expression.getText())) {
      const [base, ...resto] = n.templateSpans;
      const padre = n.parent;
      const enFetch = ts.isCallExpression(padre) && padre.expression.getText() === "fetch" && padre.arguments[0] === n;
      if (!base.literal.text.startsWith("/")) {
        sinResolver.push(`${fichero} ${n.getText()}`);
      } else {
        const texto = base.literal.text + resto.map((s) => VARIABLE + s.literal.text).join("");
        // `.../registro${ruta}`: el final lo pone quien llama a la función, y se comprueba allí.
        const delega = resto.length > 0 && resto.at(-1)!.expression.getText() === "ruta"
          && resto.at(-1)!.literal.text === "" && !texto.slice(0, -1).endsWith("/");
        if (!delega) {
          anotar(n, [texto], { servicio: "vennett" },
            enFetch ? metodoDeOpciones((padre as ts.CallExpression).arguments[1]) : undefined);
        }
      }
    }
    ts.forEachChild(n, recorrer);
  })(fuente);
  return { llamadas, sinResolver };
}

/** Si el backend sirve esa llamada: mismos segmentos, y mismo método cuando se conoce. */
export function existe(llamada: Pick<Llamada, "metodo" | "ruta">, rutas: string[]): boolean {
  const pedida = llamada.ruta.split("/");
  return rutas.some((r) => {
    const [metodo, ruta] = r.split(" ");
    const servida = ruta.split("/");
    return (!llamada.metodo || llamada.metodo === metodo) && servida.length === pedida.length
      && servida.every((s, i) => s.startsWith("{") || pedida[i] === "*" || s === pedida[i]);
  });
}
