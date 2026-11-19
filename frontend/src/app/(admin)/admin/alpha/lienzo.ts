// En vivo: el agente y sus herramientas dibujados en un lienzo, solo con lo guardado en llamadas_modelo.
// Cada llamada se guarda al terminar (creado) y duró latencia_ms; el hueco hasta la siguiente es lo que
// tardaron sus herramientas. Nada se inventa: lo que no tiene hora propia (el código) solo dura lo justo para leerse.
import { TRAZOS_MARCA } from "../../../(liga)/_ui/Marca";
import { FAMILIAS, familiaDe, MAX_VUELTAS, type Familia } from "./catalogo";
import { ZONA_ES_ETIQUETA, ZONA_NY_ETIQUETA } from "./formato";
import type { DecisionDetalle, HerramientaPedida, LlamadaModelo } from "./tipos";

type Obj = Record<string, unknown>;
type Pt = [number, number];
type Rect = [number, number, number, number];

const leer = (s: string | null | undefined): unknown => { try { return JSON.parse(s ?? ""); } catch { return s; } };
const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const args = (h: HerramientaPedida): Obj => { const a = leer(h.function.arguments || "{}"); return esObj(a) ? a : {}; };
const ms = (iso: string) => Date.parse(iso);

/** Textos y formatos del lienzo, ya en el idioma de quien mira. */
export interface Textos {
  despertar: string; loQueLleva: string; filosofia: string; lecciones: string; fichas: string; seguimiento: string;
  vuelta: (n: number, de: number) => string; pensando: (seg: string) => string; decide: (que: string) => string;
  esperando: (n: number) => string; recibidas: (n: number) => string; enviada: string; despierto: string;
  cuentas: (llamadas: number, consultas: number) => string; familia: (clave: Familia["clave"]) => string;
  pipe: Record<Etapa, [string, string]>; repeticion: string; directo: string; decisionDe: (id: number, fecha: string) => string;
  pie: string;
  // Lo que sale en la leyenda y el registro.
  textoDespierta: (hora: string) => string; textoPiensa: (n: number, de: number, k: number) => string;
  textoDecide: (n: number, de: number, que: string) => string; textoLimites: (n: number) => string; subLimites: (n: number) => string;
  textoRevisor: (v: string) => string; textoOrdenes: (sombra: boolean) => string; subOrdenes: (sombra: boolean) => string; textoDiario: (titulo: string) => string;
  // Resúmenes de lo devuelto.
  sinDatos: string; sinFicha: string; empresas: (n: number) => string; deCon: (bien: number, total: number) => string;
  respuestas: (n: number) => string; caja: (v: string) => string; margen: (v: string) => string; recibido: string;
  lado: (l: string) => string; tipo: (t: string) => string; veredicto: (v: string | null) => string; orden: (s: unknown) => string | undefined;
  lista: (xs: string[], max?: number) => string; dinero: (v: number, dec?: number) => string; pct: (v: number) => string;
  coste: (v: number) => string; seg: (ms: number) => string; hora: (ms: number) => string; horas: (ms: number) => string; horaES: (ms: number) => string; fecha: (ymd: string) => string;
}

/* ---------- Los pasos de la repetición ---------- */

export type Etapa = "limites" | "revisor" | "ordenes" | "diario";
export interface Grupo { nombre: string; fam: Familia; n: number; tickers: string[]; ida: string; vuelta: string }
interface Base { texto: string; desde: number | null; hasta: number | null; real: number | null; coste: number; llamadas: number; herramientas: number; resultado?: string; pensamiento?: string }
export type Evento = Base & (
  | { tipo: "despertar" }
  | { tipo: "piensa"; vuelta: number; modelo: string; latencia: number; decide?: string; abierta?: boolean }
  | { tipo: "herr"; vuelta: number; grupos: Grupo[] }
  | { tipo: Etapa; billete: string; sub: string }
);
// Omit que se reparte por cada forma de la unión (el Omit normal la aplasta).
type SinCuentas<T> = T extends unknown ? Omit<T, "real" | "coste" | "llamadas" | "herramientas"> : never;
export interface Repeticion { eventos: Evento[]; inicio: number; fecha: string; id: number | null }

export interface Contexto { filosofia: number | null; lecciones: number; fichas: number; seguimiento: number }

function limpio(t: string | null | undefined, n = 420): string {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n))}…` : s;
}
function primeraFrase(t: unknown): string {
  const s = limpio(typeof t === "string" ? t : "", 600);
  if (!s) return "";
  const corte = s.slice(0, 140), punto = corte.search(/[.?!]\s/);
  return punto > 30 ? corte.slice(0, punto + 1) : corte.length < s.length ? `${corte.slice(0, corte.lastIndexOf(" "))}…` : corte;
}
function resumenResultado(nombre: string, rr: unknown, T: Textos): string {
  if (!esObj(rr)) return "";
  if (rr.error) return T.sinDatos;
  if (Array.isArray(rr.companies)) {
    const mal = rr.companies.filter(c => esObj(c) && c.error).length;
    return mal ? T.deCon(rr.companies.length - mal, rr.companies.length) : T.empresas(rr.companies.length);
  }
  if (rr.exists === false) return T.sinFicha;
  if (Array.isArray(rr.rows)) return T.empresas(Number(rr.shown ?? rr.rows.length));
  if (nombre === "portfolio" && rr.cash != null) return T.caja(T.dinero(Number(rr.cash), 0));
  if (rr.margin_of_safety != null) return T.margen(T.pct(Number(rr.margin_of_safety) * 100));
  if (rr.last_close != null) return T.dinero(Number(rr.last_close));
  if (rr.price != null) return T.dinero(Number(rr.price));
  return T.recibido;
}
const tickersDe = (a: Obj): string[] => [
  ...(Array.isArray(a.tickers) ? a.tickers.filter((x): x is string => typeof x === "string") : []),
  ...(typeof a.ticker === "string" && a.ticker ? [a.ticker] : []),
];

/** Los pasos a partir de las llamadas guardadas. Sin decisión es un ciclo en curso: acaba en la vuelta
 *  que el modelo está pensando ahora (abierta). */
export function eventosDe(llamadas: LlamadaModelo[], d: DecisionDetalle | null, T: Textos, enCurso = false): Repeticion {
  const res = new Map<string, unknown>();
  llamadas.forEach(l => l.enviado.forEach(m => { if (m.role === "tool" && m.tool_call_id) res.set(m.tool_call_id, leer(m.content)); }));
  const ag = llamadas.filter(l => l.etapa === "agente"), rev = llamadas.find(l => l.etapa === "revisor");
  const ini = (l: LlamadaModelo) => ms(l.creado) - (l.latencia_ms ?? 0);
  const despierta = Math.min(d ? ms(d.creado) : Infinity, ag[0] ? ini(ag[0]) : Infinity);
  const inicio = Number.isFinite(despierta) ? despierta : Date.now();
  const ev: Evento[] = [];
  const cuenta = { coste: 0, llamadas: 0, herramientas: 0 };
  const con = (e: SinCuentas<Evento>) =>
    ev.push({ ...e, ...cuenta, real: e.desde != null && e.hasta != null ? Math.max(0, (e.hasta - e.desde) / 1000) : null } as Evento);

  con({ tipo: "despertar", texto: T.textoDespierta(T.horas(inicio)), desde: inicio, hasta: ag[0] ? ini(ag[0]) : inicio });
  ag.forEach((l, i) => {
    cuenta.coste += Number(l.coste_usd ?? 0); cuenta.llamadas++;
    const hs = l.herramientas_pedidas;
    const base = { tipo: "piensa" as const, vuelta: i + 1, modelo: l.modelo, latencia: l.latencia_ms ?? 0, pensamiento: limpio(l.razonamiento), desde: ini(l), hasta: ms(l.creado) };
    if (!hs.length) {
      const r = leer(l.respuesta), dd = esObj(r) && esObj(r.decision) ? r.decision : null;
      const ops = (Array.isArray(dd?.operaciones) ? dd.operaciones : []).filter(esObj).map(o => `${T.lado(String(o.lado)).toLocaleLowerCase()} ${o.ticker}`);
      const que = T.lista(ops) || T.tipo(String(dd?.tipo ?? "")).toLocaleLowerCase();
      con({ ...base, decide: que, texto: T.textoDecide(i + 1, MAX_VUELTAS, que) });
      return;
    }
    con({ ...base, texto: T.textoPiensa(i + 1, MAX_VUELTAS, hs.length) });
    // Lo pedido en la misma vuelta sale a la vez: así llega en la respuesta del modelo.
    const grupos: (Grupo & { resultados: string[]; fallos: number })[] = [];
    hs.forEach(h => {
      const nombre = h.function.name, a = args(h), rr = res.get(h.id);
      let g = grupos.find(x => x.nombre === nombre);
      if (!g) { g = { nombre, fam: familiaDe(nombre), n: 0, tickers: [], ida: "", vuelta: "", resultados: [], fallos: 0 }; grupos.push(g); }
      g.n++;
      tickersDe(a).forEach(tk => { if (!g.tickers.includes(tk)) g.tickers.push(tk); });
      if (nombre === "screen") g.ida = T.orden(a.sort) ?? T.orden("drawdown") ?? "";
      if (nombre === "news" && typeof a.query === "string") g.ida = a.query;
      g.resultados.push(resumenResultado(nombre, rr, T));
      if (esObj(rr) && rr.error) g.fallos++;
    });
    grupos.forEach(g => {
      g.ida = g.tickers.length ? T.lista(g.tickers, 2) : g.ida || (g.n > 1 ? `×${g.n}` : "");
      g.vuelta = g.n === 1 ? g.resultados[0] : g.fallos ? T.deCon(g.n - g.fallos, g.n) : T.respuestas(g.n);
    });
    cuenta.herramientas += hs.length;
    const fin = ag[i + 1] ? ini(ag[i + 1]) : rev ? ini(rev) : ms(l.creado);
    con({ tipo: "herr", vuelta: i + 1, grupos, desde: ms(l.creado), hasta: Math.max(ms(l.creado), fin),
      texto: grupos.map(g => g.nombre + (g.n > 1 ? ` ×${g.n}` : "") + (g.tickers.length ? ` (${T.lista(g.tickers, 3)})` : "")).join(" · "),
      resultado: grupos.map(g => `${g.nombre}: ${g.vuelta}`).join(" · ") });
  });
  if (!d) {
    if (enCurso) {
      // El modelo está pensando la vuelta siguiente: su llamada aún no se ha guardado.
      const ultima = ag.at(-1);
      const desde = ultima ? ms(ultima.creado) : inicio;
      con({ tipo: "piensa", abierta: true, vuelta: ag.length + 1, modelo: ultima?.modelo ?? "", latencia: 0, desde, hasta: null,
        texto: T.textoPiensa(ag.length + 1, MAX_VUELTAS, 0) });
    }
    return { eventos: ev, inicio, fecha: "", id: null };
  }
  const ops = d.propuesta.operaciones ?? [];
  const billete = ops.length ? ops.map(o => `${T.lado(o.lado)} ${o.ticker}`).join(" · ") : T.tipo(d.tipo);
  const ultimo = ag.length ? ms(ag[ag.length - 1].creado) : inicio, viol = d.propuesta.violaciones?.length ?? 0;
  con({ tipo: "limites", billete, texto: T.textoLimites(viol), sub: T.subLimites(viol), desde: ultimo, hasta: rev ? ini(rev) : ultimo });
  if (rev) { cuenta.coste += Number(rev.coste_usd ?? 0); cuenta.llamadas++; }
  const ver = T.veredicto(d.revisor_veredicto);
  con({ tipo: "revisor", billete, texto: T.textoRevisor(ver), pensamiento: rev ? primeraFrase((leer(rev.respuesta) as Obj | null)?.reason) : "",
    sub: rev ? `${ver} · ${T.seg(rev.latencia_ms ?? 0)}` : ver, desde: rev ? ini(rev) : ultimo, hasta: rev ? ms(rev.creado) : ultimo });
  con({ tipo: "ordenes", billete, texto: T.textoOrdenes(d.sombra), sub: T.subOrdenes(d.sombra), desde: null, hasta: null });
  const tituloD = ops.length ? billete : T.tipo(d.tipo);
  con({ tipo: "diario", billete, texto: T.textoDiario(tituloD), sub: tituloD, desde: null, hasta: null });
  return { eventos: ev, inicio, fecha: d.fecha_ny, id: d.id };
}

/** En pantalla cada paso dura su tiempo real dividido por la velocidad. */
export const duracion = (e: Evento, vel: number) => (e.real == null ? 1.2 : Math.max(e.tipo === "herr" ? 1.4 : .9, e.real / vel));

/** El instante real que se está viendo: dentro de su paso, proporcional al avance. */
export function instante(r: Repeticion, i: number, t: number, ahora: number): number {
  for (let k = i; k >= 0; k--) {
    const e = r.eventos[k];
    if (e.desde != null) {
      if (k !== i) return e.hasta ?? ahora;
      return e.hasta == null ? ahora : e.desde + (e.hasta - e.desde) * t;
    }
  }
  return r.inicio;
}

/* ---------- Disposición: apaisada (960 de ancho, la de la imagen y el vídeo) y vertical (360) ---------- */

export interface Disposicion {
  apaisado: boolean; W: number; H: number; despertar: Rect; contexto?: Rect; agente: Rect;
  chips: Record<string, Rect>; cabezas: { f: Familia; x: number; y: number }[]; cables: Record<string, Pt[]>;
  pipe: Record<Etapa, Rect>; tubos: Record<"despertar" | Etapa, Pt[]>;
}

function bezier(a: Pt, b: Pt, c1: Pt, c2: Pt, n = 18): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    pts.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
  }
  return pts;
}

export function disposicion(apaisado: boolean): Disposicion {
  const chips: Record<string, Rect> = {}, cables: Record<string, Pt[]> = {}, cabezas: Disposicion["cabezas"] = [];
  if (apaisado) {
    const y0 = 48;
    const cols: [number, number][] = [[448, 150], [606, 134], [750, 186]], bus = 429, alto = y0 - 10, sale: Pt = [410, y0 + 31];
    FAMILIAS.forEach((f, c) => {
      const [x, w] = cols[c];
      cabezas.push({ f, x, y: y0 + 9 });
      f.herramientas.forEach((h, k) => {
        const r: Rect = [x, y0 + 20 + k * 31, w, 25], cy = r[1] + r[3] / 2;
        chips[h] = r;
        cables[h] = c === 0 ? [sale, [bus, sale[1]], [bus, cy], [x, cy]] : [sale, [bus, sale[1]], [bus, alto], [x - 8, alto], [x - 8, cy], [x, cy]];
      });
    });
    const py = y0 + 262;
    return {
      apaisado, W: 960, H: py + 56 + 18, despertar: [24, y0, 124, 64], contexto: [24, y0 + 78, 124, 158], agente: [168, y0, 242, 236], chips, cabezas, cables,
      pipe: { limites: [168, py, 242, 56], revisor: [448, py, 152, 56], ordenes: [616, py, 152, 56], diario: [784, py, 152, 56] },
      tubos: { despertar: [[148, y0 + 31], [168, y0 + 31]], limites: [[289, y0 + 236], [289, py]], revisor: [[410, py + 28], [448, py + 28]],
        ordenes: [[600, py + 28], [616, py + 28]], diario: [[768, py + 28], [784, py + 28]] },
    };
  }
  const y0 = 40, agente: Rect = [16, y0 + 60, 328, 206], sale: Pt = [180, y0 + 266];
  let y = y0 + 292;
  FAMILIAS.forEach((f, c) => {
    cabezas.push({ f, x: 16, y: y + 9 });
    y += 18;
    const dos = c < 2;
    f.herramientas.forEach((h, k) => {
      const r: Rect = dos ? [k % 2 ? 184 : 16, y + Math.floor(k / 2) * 31, 160, 25] : [16, y + k * 31, 328, 25];
      chips[h] = r;
      const fin: Pt = [r[0] + r[2] / 2, r[1]];
      cables[h] = bezier(sale, fin, [sale[0], sale[1] + (fin[1] - sale[1]) * .45], [fin[0], fin[1] - 34]);
    });
    y += (dos ? Math.ceil(f.herramientas.length / 2) : f.herramientas.length) * 31 + 12;
  });
  const py = y + 8;
  return {
    apaisado, W: 360, H: py + 124 + 12, despertar: [16, y0, 328, 46], agente, chips, cabezas, cables,
    pipe: { limites: [16, py, 160, 52], revisor: [184, py, 160, 52], ordenes: [184, py + 62, 160, 52], diario: [16, py + 62, 160, 52] },
    tubos: { despertar: [[180, y0 + 46], [180, y0 + 60]], limites: bezier([agente[0] + 60, agente[1] + agente[3]], [96, py], [agente[0] + 60, py - 120], [96, py - 60], 24),
      revisor: [[176, py + 26], [184, py + 26]], ordenes: [[264, py + 52], [264, py + 62]], diario: [[184, py + 88], [176, py + 88]] },
  };
}

/* ---------- Dibujo ---------- */

const ESC = { bg: "#030707", punto: "rgba(155,230,220,.055)", tarjeta: "#0C1313", tarjetaViva: "#111B1B", borde: "rgba(255,255,255,.07)",
  ink: "#F2F6F5", muted: "#7F8E8C", apagado: "#4A5856", accent: "#4FA39D", vivo: "#9BE6DC", hondo: "#0B6E68" };
const FUENTE = '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
const ETAPAS: Etapa[] = ["limites", "revisor", "ordenes", "diario"];
export const FONDO_LIENZO = ESC.bg;

const hexA = (h: string, a: number) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
const reloj2 = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
type Ctx = CanvasRenderingContext2D;
const espaciar = (x: Ctx, v: string) => { (x as Ctx & { letterSpacing?: string }).letterSpacing = v; };

function trazar(x: Ctx, pts: Pt[]) {
  x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
  if (pts.length > 6) { for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]); return; }
  const largo = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 1; k < pts.length - 1; k++) x.arcTo(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], Math.min(7, largo(pts[k - 1], pts[k]) / 2, largo(pts[k], pts[k + 1]) / 2));
  x.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}
function enCurva(pts: Pt[], t: number): Pt {
  const tramos = pts.slice(1).map((q, k) => Math.hypot(q[0] - pts[k][0], q[1] - pts[k][1])), total = tramos.reduce((s, v) => s + v, 0);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let k = 0; k < tramos.length; k++) {
    if (d <= tramos[k] || k === tramos.length - 1) {
      const f = tramos[k] ? Math.min(1, d / tramos[k]) : 0;
      return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f];
    }
    d -= tramos[k];
  }
  return pts[pts.length - 1];
}
function envolver(x: Ctx, txt: string, ancho: number, max: number): string[] {
  const pal = txt.split(" "), out: string[] = [];
  let l = "", k = 0;
  for (; k < pal.length; k++) {
    const s = l ? `${l} ${pal[k]}` : pal[k];
    if (x.measureText(s).width > ancho && l) { out.push(l); l = pal[k]; if (out.length === max) break; } else l = s;
  }
  if (out.length < max && l) { out.push(l); k = pal.length; }
  if (k < pal.length) out[max - 1] = `${out[max - 1].replace(/[\s,.;:]*$/, "")}…`;
  return out;
}
function corta(x: Ctx, txt: string, ancho: number): string {
  let r = String(txt);
  if (x.measureText(r).width <= ancho) return r;
  while (r.length > 2 && x.measureText(`${r}…`).width > ancho) r = r.slice(0, -1);
  return `${r.trimEnd()}…`;
}
function tarjeta(x: Ctx, [X, Y, w, h]: Rect, r: number, o: { viva?: boolean; color?: string; hecha?: boolean; discontinua?: boolean } = {}) {
  const color = o.color ?? ESC.vivo;
  x.save(); x.beginPath(); x.roundRect(X, Y, w, h, r);
  if (o.viva) { x.shadowColor = hexA(color, .35); x.shadowBlur = 22; }
  x.fillStyle = o.viva ? ESC.tarjetaViva : ESC.tarjeta; x.fill(); x.shadowBlur = 0;
  x.lineWidth = 1; x.strokeStyle = o.viva ? hexA(color, .85) : o.hecha ? hexA(color, .32) : ESC.borde;
  if (o.discontinua) x.setLineDash([4, 4]);
  x.stroke(); x.restore();
  // Un filo de luz arriba, como el cristal de iOS.
  x.save(); x.beginPath(); x.roundRect(X + .5, Y + .5, w - 1, h - 1, r); x.clip();
  const g = x.createLinearGradient(0, Y, 0, Y + 18); g.addColorStop(0, "rgba(255,255,255,.05)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(X, Y, w, 18); x.restore();
}
function etiqueta(x: Ctx, txt: string, cx: number, cy: number, color: string, { relleno = "rgba(3,7,7,.92)", tinta = color, px = 10.5 } = {}) {
  x.font = `600 ${px}px ${MONO}`;
  const w = x.measureText(txt).width + 14, h = px + 9;
  x.beginPath(); x.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2); x.fillStyle = relleno; x.fill(); x.lineWidth = 1; x.strokeStyle = hexA(color, .7); x.stroke();
  x.fillStyle = tinta; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, cx, cy + .5); x.textAlign = "left"; x.textBaseline = "alphabetic";
}
function chispa(x: Ctx, p: Pt, color: string, cola: Pt[] | null) {
  if (cola) {
    x.save(); x.globalCompositeOperation = "lighter";
    cola.forEach((q, k) => { x.beginPath(); x.arc(q[0], q[1], 3.4 * (1 - k / cola.length), 0, Math.PI * 2); x.fillStyle = hexA(color, .28 * (1 - k / cola.length)); x.fill(); });
    x.restore();
  }
  const g = x.createRadialGradient(p[0], p[1], 0, p[0], p[1], 12); g.addColorStop(0, hexA(color, .55)); g.addColorStop(1, hexA(color, 0));
  x.fillStyle = g; x.fillRect(p[0] - 12, p[1] - 12, 24, 24);
  x.beginPath(); x.arc(p[0], p[1], 3.6, 0, Math.PI * 2); x.fillStyle = "#FFFFFF"; x.fill(); x.lineWidth = 1.6; x.strokeStyle = color; x.stroke();
}
// El agente: un núcleo de petróleo con dos órbitas; respira despacio y gira deprisa mientras piensa.
function nucleo(x: Ctx, cx: number, cy: number, R: number, reloj: number, piensa: boolean, quieto: boolean) {
  const r = R * (quieto ? 1 : 1 + Math.sin(reloj / (piensa ? 260 : 900)) * .045);
  const halo = x.createRadialGradient(cx, cy, 0, cx, cy, R * 3.4);
  halo.addColorStop(0, `rgba(155,230,220,${piensa ? .34 : .2})`); halo.addColorStop(1, "rgba(155,230,220,0)");
  x.fillStyle = halo; x.fillRect(cx - R * 3.4, cy - R * 3.4, R * 6.8, R * 6.8);
  const g = x.createRadialGradient(cx - r * .35, cy - r * .4, 1, cx, cy, r);
  g.addColorStop(0, "#E8FFFB"); g.addColorStop(.32, ESC.vivo); g.addColorStop(.72, ESC.accent); g.addColorStop(1, ESC.hondo);
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  const giro = quieto ? 0 : reloj * (piensa ? .0065 : .0016);
  for (let o = 0; o < 2; o++) {
    const ang = giro * (o ? -1.3 : 1) + o * Math.PI, rx = R + 7, ry = R * .42;
    x.save(); x.translate(cx, cy); x.rotate(o ? .9 : -.5);
    x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); x.strokeStyle = "rgba(155,230,220,.32)"; x.lineWidth = 1; x.stroke();
    x.beginPath(); x.arc(Math.cos(ang) * rx, Math.sin(ang) * ry, 2.1, 0, Math.PI * 2); x.fillStyle = ESC.vivo; x.fill(); x.restore();
  }
}
function fondo(x: Ctx, L: Disposicion, foco: Pt) {
  x.fillStyle = ESC.bg; x.fillRect(0, 0, L.W, L.H);
  x.fillStyle = ESC.punto;
  for (let px = 12; px < L.W; px += 18) for (let py = 12; py < L.H; py += 18) x.fillRect(px, py, 1.2, 1.2);
  const r = Math.max(L.W, L.H) * .6, g = x.createRadialGradient(foco[0], foco[1], 0, foco[0], foco[1], r);
  g.addColorStop(0, "rgba(79,163,157,.13)"); g.addColorStop(.5, "rgba(79,163,157,.03)"); g.addColorStop(1, "rgba(79,163,157,0)");
  x.fillStyle = g; x.fillRect(0, 0, L.W, L.H);
}
function estadoEn(ev: Evento[], i: number, t: number) {
  const usos: Record<string, number> = {};
  let ultimaPiensa: Extract<Evento, { tipo: "piensa" }> | null = null, vueltas = 0;
  for (let k = 0; k <= i && k < ev.length; k++) {
    const e = ev[k];
    if (e.tipo === "piensa") { ultimaPiensa = e; vueltas = e.vuelta; }
    if (e.tipo === "herr" && (k < i || t > .36)) e.grupos.forEach(g => { usos[g.nombre] = (usos[g.nombre] ?? 0) + g.n; });
  }
  return { usos, ultimaPiensa, vueltas };
}

export interface Opciones { directo?: boolean; quieto?: boolean; ahora?: number }

/** Un cuadro del lienzo: `i` es el paso y `t` su avance (0 a 1); `reloj` mueve lo que respira. */
export function dibujar(x: Ctx, L: Disposicion, r: Repeticion, i: number, t: number, reloj: number, T: Textos, ctx: Contexto, op: Opciones = {}) {
  const ev = r.eventos, e = ev[i], quieto = Boolean(op.quieto), s = estadoEn(ev, i, t), A = L.agente, C = ESC, ap = L.apaisado;
  const ahora = op.ahora ?? Date.now();
  const nucleoP: Pt = [A[0] + (ap ? 30 : 32), A[1] + 31];
  fondo(x, L, nucleoP);
  const pipeI = e ? ETAPAS.indexOf(e.tipo as Etapa) : -1;

  // Cables a las herramientas: apagados si no las ha tocado, con su color si sí, y vivos mientras viaja la petición.
  const activos = new Set(e?.tipo === "herr" ? e.grupos.map(g => g.nombre) : []);
  if (ap) {
    for (const f of FAMILIAS) for (const h of f.herramientas) {
      if (activos.has(h)) continue;
      x.save(); trazar(x, L.cables[h]); x.lineWidth = 1; x.strokeStyle = s.usos[h] ? hexA(f.color, .26) : "rgba(255,255,255,.05)"; x.stroke(); x.restore();
    }
  }
  for (const h of activos) {
    x.save(); trazar(x, L.cables[h]); x.lineWidth = 1.4; x.strokeStyle = hexA(familiaDe(h).color, .9); x.setLineDash([3, 5]);
    x.lineDashOffset = quieto ? 0 : (t < .5 ? -1 : 1) * reloj * .03; x.stroke(); x.restore();
  }
  // Tubos del recorrido de la decisión.
  for (const [k, pts] of Object.entries(L.tubos) as [keyof Disposicion["tubos"], Pt[]][]) {
    const n = ETAPAS.indexOf(k as Etapa), hecho = k === "despertar" || (pipeI >= n && n >= 0), vivo = k === e?.tipo;
    // En vertical el tubo a los límites cruza las herramientas: solo se ve mientras pasa la propuesta.
    if (!ap && k === "limites" && !vivo) continue;
    x.save(); trazar(x, pts); x.lineWidth = vivo ? 1.6 : 1; x.strokeStyle = vivo ? C.vivo : hecho ? hexA(C.accent, .55) : "rgba(255,255,255,.08)";
    if (vivo && !quieto) { x.setLineDash([3, 5]); x.lineDashOffset = -reloj * .03; }
    x.stroke(); x.restore();
  }

  // Despertar.
  {
    const rc = L.despertar, viva = e?.tipo === "despertar";
    tarjeta(x, rc, 12, { viva, hecha: true });
    x.fillStyle = C.ink; x.font = `600 13px ${FUENTE}`; x.fillText(T.despertar, rc[0] + 14, rc[1] + (ap ? 25 : 28));
    x.fillStyle = viva ? C.vivo : C.muted; x.font = `500 11.5px ${MONO}`;
    // Las dos horas: Nueva York (la del agente) y Madrid. En la tarjeta estrecha van una debajo de otra.
    if (ap) { x.fillText(`${T.hora(r.inicio)} ${ZONA_NY_ETIQUETA}`, rc[0] + 14, rc[1] + 42); x.fillText(`${T.horaES(r.inicio)} ${ZONA_ES_ETIQUETA}`, rc[0] + 14, rc[1] + 57); }
    else {
      x.textAlign = "right";
      x.fillText(`${T.hora(r.inicio)} ${ZONA_NY_ETIQUETA} · ${T.horaES(r.inicio)} ${ZONA_ES_ETIQUETA}`, rc[0] + rc[2] - 14, rc[1] + 22);
      if (r.fecha) x.fillText(T.fecha(r.fecha), rc[0] + rc[2] - 14, rc[1] + 38);
      x.textAlign = "left";
    }
  }
  // Con qué despierta: lo que lee de su memoria antes de la primera vuelta.
  if (L.contexto) {
    const rc = L.contexto;
    tarjeta(x, rc, 12);
    x.fillStyle = C.muted; x.font = `600 10px ${FUENTE}`; espaciar(x, "1px"); x.fillText(T.loQueLleva.toLocaleUpperCase(), rc[0] + 14, rc[1] + 22); espaciar(x, "0px");
    ([[T.filosofia, ctx.filosofia != null ? `v${ctx.filosofia}` : "—"], [T.lecciones, String(ctx.lecciones)], [T.fichas, String(ctx.fichas)], [T.seguimiento, String(ctx.seguimiento)]] as const)
      .forEach(([k, v], n) => {
        const y = rc[1] + 50 + n * 28;
        x.fillStyle = C.muted; x.font = `400 12px ${FUENTE}`; x.fillText(k, rc[0] + 14, y);
        x.fillStyle = C.ink; x.font = `500 12px ${MONO}`; x.textAlign = "right"; x.fillText(v, rc[0] + rc[2] - 14, y); x.textAlign = "left";
        if (n < 3) { x.fillStyle = "rgba(255,255,255,.05)"; x.fillRect(rc[0] + 14, y + 10, rc[2] - 28, 1); }
      });
  }

  // El agente.
  {
    const piensa = e?.tipo === "piensa", pz = s.ultimaPiensa;
    tarjeta(x, A, 16, { viva: piensa || e?.tipo === "herr", hecha: true });
    nucleo(x, nucleoP[0], nucleoP[1], 12, reloj, piensa, quieto);
    const tx = A[0] + (ap ? 56 : 58), dentro = A[2] - (tx - A[0]) - 14;
    x.fillStyle = C.ink; x.font = `650 15px ${FUENTE}`; x.fillText("Alpha", tx, A[1] + 27);
    x.fillStyle = C.muted; x.font = `500 11px ${MONO}`; x.fillText(corta(x, `${pz?.modelo || "deepseek"} · ${T.vuelta(s.vueltas, MAX_VUELTAS)}`, dentro), tx, A[1] + 43);
    // Las vueltas que permite el código: llenas las hechas, la de ahora late.
    const vy = A[1] + 62, vw = (A[2] - 28 - (MAX_VUELTAS - 1) * 4) / MAX_VUELTAS;
    for (let k = 0; k < MAX_VUELTAS; k++) {
      const n = k + 1, hecha = n < s.vueltas || (n === s.vueltas && !piensa), ya = n === s.vueltas && piensa;
      x.beginPath(); x.roundRect(A[0] + 14 + k * (vw + 4), vy, vw, 4, 2);
      x.fillStyle = ya ? hexA(C.vivo, quieto ? 1 : .55 + .45 * Math.abs(Math.sin(reloj / 300))) : hecha ? C.accent : "rgba(255,255,255,.08)"; x.fill();
    }
    // Qué hace ahora, con su tiempo real.
    let estado = T.despierto, tono = C.ink;
    if (e?.tipo === "piensa") {
      const lleva = e.abierta && e.desde != null ? ahora - e.desde : e.latencia * Math.min(1, t);
      estado = e.decide && t > .7 ? T.decide(e.decide) : T.pensando(T.seg(lleva)); tono = C.vivo;
    } else if (e?.tipo === "herr") {
      const n = e.grupos.reduce((a, g) => a + g.n, 0);
      estado = t < .5 ? T.esperando(n) : T.recibidas(n); tono = C.vivo;
    } else if (pipeI >= 0) { estado = T.enviada; tono = C.muted; }
    x.fillStyle = tono; x.font = `600 13px ${FUENTE}`; x.fillText(corta(x, estado, A[2] - 28), A[0] + 14, A[1] + 90);
    // Su razonamiento real de esa vuelta, que se escribe mientras dura la llamada.
    if (pz?.pensamiento) {
      x.font = `400 12px ${FUENTE}`;
      const lineas = envolver(x, pz.pensamiento, A[2] - 28, ap ? 6 : 4);
      const total = lineas.join(" ").length, ver = piensa && !quieto && e === pz ? Math.floor(total * Math.min(1, t * 1.25 + .03)) : total;
      let usados = 0;
      lineas.forEach((ln, k) => {
        const resto = Math.max(0, ver - usados); usados += ln.length + 1;
        if (!resto) return;
        x.fillStyle = piensa && e === pz ? "#B9C6C4" : "#6E7C7A"; x.fillText(ln.slice(0, resto), A[0] + 14, A[1] + 114 + k * 17);
      });
    }
    x.fillStyle = "rgba(255,255,255,.05)"; x.fillRect(A[0] + 14, A[1] + A[3] - 30, A[2] - 28, 1);
    x.fillStyle = C.muted; x.font = `500 11px ${MONO}`;
    x.fillText(corta(x, T.cuentas(e?.llamadas ?? 0, e?.herramientas ?? 0), A[2] - 28), A[0] + 14, A[1] + A[3] - 12);
  }

  // Las herramientas, por familias.
  for (const { f, x: hx, y: hy } of L.cabezas) {
    x.fillStyle = hexA(f.color, .9); x.font = `600 10px ${FUENTE}`; espaciar(x, "1px"); x.fillText(T.familia(f.clave).toLocaleUpperCase(), hx + 2, hy); espaciar(x, "0px");
  }
  for (const f of FAMILIAS) for (const h of f.herramientas) {
    const [X, Y, w, hh] = L.chips[h], usos = s.usos[h] ?? 0, viva = activos.has(h) && t > .3 && t < .72, cy = Y + hh / 2;
    x.save(); x.beginPath(); x.roundRect(X, Y, w, hh, 7);
    if (viva) { x.shadowColor = hexA(f.color, .5); x.shadowBlur = 16; }
    x.fillStyle = viva ? hexA(f.color, .16) : usos ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.015)"; x.fill(); x.shadowBlur = 0;
    x.lineWidth = 1; x.strokeStyle = viva ? hexA(f.color, .95) : usos ? hexA(f.color, .3) : "rgba(255,255,255,.055)"; x.stroke(); x.restore();
    x.beginPath(); x.arc(X + 11, cy, 2.8, 0, Math.PI * 2);
    if (usos || viva) { x.fillStyle = f.color; x.fill(); } else { x.lineWidth = 1; x.strokeStyle = C.apagado; x.stroke(); }
    // El nombre nunca se recorta: lo devuelto ocupa solo el hueco que queda.
    const g = viva && t > .48 && e?.tipo === "herr" ? e.grupos.find(v => v.nombre === h) : undefined;
    x.font = `500 11px ${MONO}`;
    const hueco = w - 30 - x.measureText(h).width - 10;
    const cuenta = g && hueco > 40 ? corta(x, g.vuelta, hueco) : usos ? `×${usos}` : "", cw = cuenta ? x.measureText(cuenta).width + 8 : 0;
    x.fillStyle = viva ? C.ink : usos ? "#DCE5E3" : C.apagado; x.fillText(corta(x, h, w - 30 - cw), X + 21, cy + 4);
    if (cuenta) { x.fillStyle = viva ? f.color : C.muted; x.textAlign = "right"; x.fillText(cuenta, X + w - 9, cy + 4); x.textAlign = "left"; }
  }
  // Las peticiones de esta vuelta: salen juntas, llegan, y vuelven con lo que devolvió cada herramienta.
  if (e?.tipo === "herr") {
    e.grupos.forEach(g => {
      const pts = L.cables[g.nombre], col = g.fam.color;
      if (!pts) return;
      if (!ap) { x.save(); trazar(x, pts); x.lineWidth = 1.2; x.strokeStyle = hexA(col, .55); x.setLineDash([3, 5]); x.lineDashOffset = quieto ? 0 : (t < .5 ? -1 : 1) * reloj * .03; x.stroke(); x.restore(); }
      const pos = (tt: number) => (tt < .36 ? enCurva(pts, tt / .36) : tt < .64 ? pts[pts.length - 1] : enCurva(pts, 1 - (tt - .64) / .36));
      const p = pos(t), cola = quieto || (t > .36 && t < .64) ? null : Array.from({ length: 8 }, (_, k) => pos(Math.max(0, t - (k + 1) * .01)));
      chispa(x, p, col, cola);
      const txt = t < .3 ? g.ida : t >= .7 ? g.vuelta : "";
      if (txt) etiqueta(x, corta(x, txt, 150), p[0], p[1] - 15, col);
    });
  }

  // El recorrido de la decisión: límites, revisor, órdenes y diario.
  const sombra = ev.find(v => v.tipo === "ordenes") as Extract<Evento, { tipo: Etapa }> | undefined;
  for (const k of ETAPAS) {
    const rc = L.pipe[k], n = ETAPAS.indexOf(k), viva = e?.tipo === k, hecha = pipeI > n || (viva && t > .45);
    const enSombra = k === "ordenes" && hecha && Boolean(sombra && r.id != null && sombra.sub === T.subOrdenes(true));
    tarjeta(x, rc, 12, { viva, hecha: pipeI >= n, discontinua: enSombra });
    const [X, Y, w, h] = rc, [titulo, fijo] = T.pipe[k];
    const dato = hecha ? (ev.find(v => v.tipo === k) as Extract<Evento, { tipo: Etapa }> | undefined)?.sub : undefined;
    x.beginPath(); x.arc(X + 15, Y + h / 2, 3.2, 0, Math.PI * 2);
    if (hecha) { x.fillStyle = C.accent; x.fill(); } else { x.lineWidth = 1; x.strokeStyle = viva ? C.vivo : C.apagado; x.stroke(); }
    x.fillStyle = hecha || viva ? C.ink : "#A3B0AE"; x.font = `600 12.5px ${FUENTE}`; x.fillText(corta(x, titulo, w - 40), X + 27, Y + h / 2 - 3);
    x.fillStyle = dato ? (viva ? C.vivo : "#B9C6C4") : C.muted; x.font = `400 11.5px ${FUENTE}`; x.fillText(corta(x, dato || fijo, w - 40), X + 27, Y + h / 2 + 13);
  }
  // La propuesta viaja como un billete por el recorrido.
  if (pipeI >= 0 && e && "billete" in e) {
    const pts = L.tubos[e.tipo as Etapa], rc = L.pipe[e.tipo as Etapa];
    const p = t < .45 && !quieto ? enCurva(pts, t / .45) : [rc[0] + rc[2] / 2, rc[1] - 13] as Pt;
    etiqueta(x, corta(x, e.billete, 170), p[0], p[1], C.vivo, { relleno: "#06201E", tinta: "#E8FFFB", px: 11 });
  }

  // Arriba: si es directo o repetición, y la hora real de Nueva York, el tiempo desde que despertó y el coste.
  const ahoraReal = instante(r, i, t, ahora), hy = ap ? 26 : 22;
  x.font = `600 ${ap ? 10 : 9.5}px ${FUENTE}`; espaciar(x, "1px");
  const rot = (op.directo ? T.directo : T.repeticion).toLocaleUpperCase(), rw = x.measureText(rot).width + 16, rx = ap ? 24 : 16;
  x.beginPath(); x.roundRect(rx, hy - 12, rw, 18, 9); x.strokeStyle = op.directo ? C.vivo : "rgba(255,255,255,.18)"; x.lineWidth = 1; x.stroke();
  x.fillStyle = op.directo ? C.vivo : C.muted; x.fillText(rot, rx + 8, hy + 1.5); espaciar(x, "0px");
  if (ap && r.id != null) { x.font = `400 12px ${FUENTE}`; x.fillStyle = C.muted; x.fillText(T.decisionDe(r.id, T.fecha(r.fecha)), rx + rw + 10, hy + 1.5); }
  x.font = `500 ${ap ? 12 : 11}px ${MONO}`; x.fillStyle = C.vivo; x.textAlign = "right";
  const madrid = ap ? ` · ${T.horaES(ahoraReal)} ${ZONA_ES_ETIQUETA}` : "";   // en la vista estrecha no cabe
  x.fillText(`${T.hora(ahoraReal)} ${ZONA_NY_ETIQUETA}${madrid}  +${reloj2((ahoraReal - r.inicio) / 1000)}  ${T.coste(e?.coste ?? 0)}`, L.W - (ap ? 24 : 16), hy + 1.5); x.textAlign = "left";
}

export const ANCHO_MARCO = 960, ALTO_MARCO = 540;

/** Imagen y vídeo: el lienzo apaisado con título arriba y firma abajo (960 × 540, se escala a 1200 × 675). */
export function dibujarMarco(x: Ctx, r: Repeticion, i: number, t: number, reloj: number, T: Textos, ctx: Contexto, titulo: string, sub: string, op: Opciones = {}) {
  const L = disposicion(true), H = ALTO_MARCO, arriba = 92;
  x.fillStyle = ESC.bg; x.fillRect(0, 0, ANCHO_MARCO, H);
  x.save(); x.translate(0, arriba); dibujar(x, L, r, i, t, reloj, T, ctx, op); x.restore();
  const g = x.createLinearGradient(0, 0, 0, arriba + 10); g.addColorStop(0, ESC.bg); g.addColorStop(1, "rgba(3,7,7,0)");
  x.fillStyle = g; x.fillRect(0, 0, ANCHO_MARCO, arriba + 10);
  x.fillStyle = ESC.ink; x.font = `700 26px ${FUENTE}`; x.fillText(corta(x, titulo, ANCHO_MARCO - 48), 24, 46);
  x.fillStyle = ESC.muted; x.font = `400 14px ${FUENTE}`; x.fillText(corta(x, sub, ANCHO_MARCO - 48), 24, 70);
  const e = r.eventos[i];
  if (e) { x.fillStyle = ESC.ink; x.font = `400 15px ${FUENTE}`; x.fillText(corta(x, e.texto, 520), 24, H - 26); }
  x.fillStyle = ESC.muted; x.font = `400 12px ${FUENTE}`; x.textAlign = "right"; x.fillText(T.pie, ANCHO_MARCO - 24 - 112, H - 26); x.textAlign = "left";
  const esc = 18 / 210;
  x.save(); x.translate(ANCHO_MARCO - 24 - 999 * esc, H - 26 - 15); x.scale(esc, esc); x.translate(2, -38);
  TRAZOS_MARCA.forEach((d, k) => { x.fillStyle = k === 2 ? ESC.accent : ESC.ink; x.fill(new Path2D(d)); });
  x.restore();
}
