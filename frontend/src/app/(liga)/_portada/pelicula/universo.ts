// Datos del EJEMPLO de la portada. Las empresas grandes son reales solo como ilustración y sus cifras
// son aproximadas e inventadas; el resto del universo es sintético y sin nombre. La pantalla lo dice.

export function mulberry32(semilla: number): () => number {
  let a = semilla;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashTexto(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function gaussiana(rnd: () => number): () => number {
  return () => {
    let u = 0, v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Índices de sector; los nombres salen del catálogo de textos (`landing_sectores`). */
export const N_SECTORES = 11;
export const SECTOR_FINANZAS = 4;

export interface Empresa {
  id: number;
  ticker: string | null;
  nombre: string | null;
  sector: number;
  cap: number;
  roe: number | null;
  ventas: number;
  deuda: number | null;
  per: number | null;
  pronto: number;
  cambio: number;
  vaiven: number;
  notas: [number, number, number, number];
  nota: number;
}

// ticker|nombre|sector|capitalización (miles de millones $)|ROE %|ventas % interanual|deuda neta/EBITDA|PER
// «-» = sin dato: bancos y aseguradoras no tienen EBITDA y con fondos propios negativos no hay ROE.
const GRANDES = `NVDA|NVIDIA|0|4400|95|55|-0.4|42
MSFT|Microsoft|0|3700|33|15|-0.2|34
AAPL|Apple|0|3400|150|6|0.3|33
AVGO|Broadcom|0|1500|30|25|1.8|38
ORCL|Oracle|0|700|80|12|3.6|36
PLTR|Palantir|0|400|14|38|-3|180
AMD|AMD|0|300|8|30|-0.5|45
CSCO|Cisco|0|270|22|6|0.6|19
IBM|IBM|0|250|33|4|2.9|24
CRM|Salesforce|0|250|11|9|-0.3|28
NOW|ServiceNow|0|200|16|21|-0.8|60
ACN|Accenture|0|190|26|6|0.2|23
INTU|Intuit|0|190|18|13|0.4|36
QCOM|Qualcomm|0|180|40|9|0.4|15
TXN|Texas Instruments|0|170|29|7|1.1|33
ADBE|Adobe|0|160|39|10|0.1|22
AMAT|Applied Materials|0|140|36|8|0.1|19
MU|Micron|0|140|12|38|0.7|14
ANET|Arista Networks|0|140|30|25|-2|45
APH|Amphenol|0|130|26|30|1|38
PANW|Palo Alto Networks|0|130|19|15|-1|55
LRCX|Lam Research|0|120|48|17|-0.2|24
APP|AppLovin|0|120|140|40|1.2|48
KLAC|KLA|0|110|90|13|0.6|27
ADI|Analog Devices|0|110|7|12|1.7|38
CRWD|CrowdStrike|0|110|-3|23|-1.5|-
CDNS|Cadence|0|85|25|13|0.1|60
FTNT|Fortinet|0|80|80|14|-1.5|35
SNPS|Synopsys|0|80|9|10|2.5|45
NXPI|NXP|0|55|25|4|1.5|20
TEL|TE Connectivity|0|50|19|8|1.2|21
GLW|Corning|0|45|10|12|2.2|28
CTSH|Cognizant|0|38|17|6|-0.5|16
GOOGL|Alphabet|1|2600|32|13|-0.6|22
META|Meta|1|1800|35|19|-0.2|25
NFLX|Netflix|1|500|40|15|0.6|45
TMUS|T-Mobile US|1|260|19|6|3.1|23
DIS|Disney|1|200|9|4|2.4|19
T|AT&T|1|190|11|1|2.9|16
VZ|Verizon|1|180|18|1|2.8|10
CMCSA|Comcast|1|130|19|2|2.4|9
CHTR|Charter|1|55|28|0|4.2|10
EA|Electronic Arts|1|50|15|4|-0.3|33
AMZN|Amazon|2|2300|24|11|0.2|35
TSLA|Tesla|2|1100|8|2|-1.2|150
HD|Home Depot|2|380|190|3|2.2|26
MCD|McDonald's|2|220|-|3|3.4|26
BKNG|Booking|2|170|-|10|0.8|30
LOW|Lowe's|2|140|-|1|3|20
TJX|TJX|2|140|60|5|0.2|29
SBUX|Starbucks|2|100|-|2|3.5|45
NKE|Nike|2|100|25|-6|0.8|35
ORLY|O'Reilly|2|80|-|6|2.3|33
ABNB|Airbnb|2|80|30|10|-3|32
MAR|Marriott|2|75|-|5|3.1|30
CMG|Chipotle|2|65|45|10|-0.6|42
GM|General Motors|2|55|11|-1|3.5|6
DHI|D.R. Horton|2|50|17|-2|0.4|11
ROST|Ross Stores|2|50|38|5|-0.4|24
F|Ford|2|45|8|2|4|9
EBAY|eBay|2|40|38|3|0.9|17
LEN|Lennar|2|35|13|3|0.5|10
PHM|PulteGroup|2|25|21|6|0.1|9
WMT|Walmart|3|800|22|5|1.4|38
COST|Costco|3|420|31|8|-0.6|52
PG|Procter & Gamble|3|360|31|2|1.6|24
KO|Coca-Cola|3|300|40|3|2.3|25
PM|Philip Morris|3|250|-|7|3|24
PEP|PepsiCo|3|200|50|1|2.6|20
MO|Altria|3|95|-|-1|2|10
MDLZ|Mondelez|3|85|14|4|2.8|22
CL|Colgate-Palmolive|3|75|300|3|1.4|24
MNST|Monster|3|60|23|6|-1.5|38
KR|Kroger|3|45|25|1|1.9|16
KMB|Kimberly-Clark|3|45|200|-1|1.9|19
BRK.B|Berkshire Hathaway|4|1050|10|3|-|22
JPM|JPMorgan|4|800|17|5|-|14
V|Visa|4|680|52|10|0.4|30
MA|Mastercard|4|520|180|12|0.6|36
BAC|Bank of America|4|350|10|4|-|13
WFC|Wells Fargo|4|250|12|2|-|13
MS|Morgan Stanley|4|230|15|8|-|16
GS|Goldman Sachs|4|230|13|8|-|15
AXP|American Express|4|220|33|9|-|21
C|Citigroup|4|170|7|3|-|11
SPGI|S&P Global|4|160|12|8|2.1|38
BLK|BlackRock|4|160|14|12|0.9|24
SCHW|Charles Schwab|4|160|14|10|-|22
PGR|Progressive|4|150|33|18|-|17
COF|Capital One|4|130|8|30|-|15
CB|Chubb|4|110|13|6|-|12
KKR|KKR|4|110|12|20|-|28
MMC|Marsh McLennan|4|100|29|9|2.5|26
ICE|ICE|4|90|11|8|3.2|30
PYPL|PayPal|4|70|23|5|0.2|14
LLY|Eli Lilly|5|750|75|35|1|50
JNJ|Johnson & Johnson|5|400|25|5|0.6|16
ABBV|AbbVie|5|340|-|5|2.8|18
UNH|UnitedHealth|5|280|14|8|1.5|18
ABT|Abbott|5|230|14|7|0.5|25
MRK|Merck|5|210|36|3|0.9|11
ISRG|Intuitive Surgical|5|190|16|20|-3|70
AMGN|Amgen|5|160|90|10|3.6|15
TMO|Thermo Fisher|5|160|13|3|2.7|23
BSX|Boston Scientific|5|150|11|19|1.9|50
PFE|Pfizer|5|140|10|-2|2.6|8
DHR|Danaher|5|140|7|3|1.7|30
SYK|Stryker|5|140|14|10|1.8|40
GILD|Gilead|5|140|30|4|1.2|14
MDT|Medtronic|5|110|9|5|2.3|16
VRTX|Vertex|5|110|-5|11|-2|-
BMY|Bristol-Myers|5|100|20|-3|2.1|8
HCA|HCA|5|90|-|6|3.2|16
CI|Cigna|5|85|17|10|2.4|11
MCK|McKesson|5|85|-|15|0.8|21
ELV|Elevance|5|80|16|8|1.6|12
ZTS|Zoetis|5|70|50|6|1.4|26
REGN|Regeneron|5|65|15|3|-2|15
GE|GE Aerospace|6|280|20|12|0.9|40
RTX|RTX|6|200|9|8|2.6|33
CAT|Caterpillar|6|190|50|-2|1.8|19
UBER|Uber|6|190|45|18|0.6|17
HON|Honeywell|6|140|31|5|2.4|24
UNP|Union Pacific|6|130|40|2|2.6|21
ETN|Eaton|6|130|21|9|1.4|34
DE|Deere|6|130|25|-10|2.5|22
ADP|ADP|6|120|75|7|0.3|30
LMT|Lockheed Martin|6|110|80|4|1.9|20
PH|Parker-Hannifin|6|90|26|1|1.8|27
GD|General Dynamics|6|85|17|9|1|21
WM|Waste Management|6|85|33|9|2.9|30
CTAS|Cintas|6|80|40|8|1|45
NOC|Northrop Grumman|6|80|25|4|2.2|20
UPS|UPS|6|80|33|-2|2.2|14
CSX|CSX|6|65|25|-1|2.6|20
FDX|FedEx|6|60|16|1|2.6|14
PCAR|PACCAR|6|55|20|-10|0.3|16
ODFL|Old Dominion|6|35|28|-4|-0.1|30
XOM|Exxon Mobil|7|470|13|-3|0.4|14
CVX|Chevron|7|280|10|-2|0.8|16
COP|ConocoPhillips|7|120|16|2|0.6|12
EOG|EOG Resources|7|65|21|5|0|11
SLB|SLB|7|55|20|4|1|13
MPC|Marathon Petroleum|7|50|20|-5|2|13
VLO|Valero|7|40|12|-6|0.7|14
LIN|Linde|8|220|17|2|1.4|32
SHW|Sherwin-Williams|8|90|60|1|2.5|33
ECL|Ecolab|8|75|22|3|2.1|38
FCX|Freeport-McMoRan|8|65|14|7|0.6|30
NEM|Newmont|8|60|12|35|0.2|13
NUE|Nucor|8|35|11|-3|0.5|18
STLD|Steel Dynamics|8|20|16|-2|0.4|13
NEE|NextEra Energy|9|150|11|5|5.6|22
CEG|Constellation|9|100|25|12|1.6|35
SO|Southern|9|100|12|6|5.4|21
DUK|Duke Energy|9|90|9|4|5.8|19
PLD|Prologis|10|100|6|7|5|35
WELL|Welltower|10|100|3|25|5|120
AMT|American Tower|10|95|20|3|5.2|40
EQIX|Equinix|10|75|8|7|3.8|80`;

export const UNIVERSO = 2987;
/** Pesos de las cuatro notas, en el orden de `Empresa.notas`: negocio, precio, deuda, algo a favor. */
export const PESOS = [35, 25, 20, 20] as const;

function calcularNotas(e: Omit<Empresa, "notas" | "nota" | "id">, enCola: boolean): [number, number, number, number] {
  let negocio = e.roe == null ? 2 : clamp(Math.round(e.roe / 8 + e.ventas / 5 + 1), 0, 9);
  let precio = e.per == null || e.per <= 0 ? 0 : clamp(Math.round(10 - e.per / 3.2), 0, 9);
  let deuda = e.deuda == null ? 3 : clamp(Math.round(8 - e.deuda * 2.2), 0, 9);
  // La cola sintética nunca supera a las grandes: así las cinco elegidas siempre tienen nombre.
  if (enCola) { negocio = Math.min(negocio, 5); precio = Math.min(precio, 6); deuda = Math.min(deuda, 7); }
  return [negocio, precio, deuda, e.pronto];
}

export function crearUniverso(): Empresa[] {
  const rnd = mulberry32(20261006);
  const g = gaussiana(rnd);
  const num = (x: string) => (x === "-" ? null : Number(x));
  const lista: Empresa[] = [];
  const alta = (base: Omit<Empresa, "notas" | "nota" | "id">, enCola: boolean) => {
    const notas = calcularNotas(base, enCola);
    const nota = notas.reduce((s, n, k) => s + PESOS[k] * n, 0) / 100;
    lista.push({ ...base, id: lista.length, notas, nota });
  };
  for (const linea of GRANDES.split("\n")) {
    const [ticker, nombre, sector, cap, roe, ventas, deuda, per] = linea.split("|");
    const h = hashTexto(ticker);
    alta({ ticker, nombre, sector: Number(sector), cap: Number(cap), roe: num(roe), ventas: Number(ventas),
      deuda: num(deuda), per: num(per), pronto: 4 + (h % 5), cambio: clamp(0.15 + g() * 1.05, -3.8, 3.8),
      vaiven: 0.12 + (h % 7) / 40 }, false);
  }
  const reparto = [0.17, 0.05, 0.11, 0.05, 0.16, 0.17, 0.13, 0.05, 0.05, 0.03, 0.03];
  const acumulado = reparto.map((_, i) => reparto.slice(0, i + 1).reduce((a, b) => a + b, 0));
  while (lista.length < UNIVERSO) {
    const r = rnd() * acumulado[acumulado.length - 1];
    const sector = acumulado.findIndex((a) => r <= a);
    const roe = clamp(7 + g() * 14, -40, 28);
    const per = roe > 0 ? clamp(Math.exp(Math.log(21) + 0.5 * g()), 4, 150) : null;
    const deuda = rnd() < 0.25 ? -3 * rnd() : clamp(Math.exp(Math.log(2) + 0.6 * g()), 0.1, 9);
    alta({ ticker: null, nombre: null, sector, cap: clamp(Math.exp(Math.log(2.6) + 1.25 * g()), 0.15, 70), roe,
      ventas: clamp(5 + g() * 13, -30, 18), deuda: sector === SECTOR_FINANZAS && rnd() < 0.6 ? null : deuda, per,
      pronto: 1 + Math.round(rnd() * 2), cambio: clamp(0.1 + g() * 1.6, -7, 7), vaiven: 0.2 + rnd() * 0.5 }, true);
  }
  return lista;
}

/** Umbrales de las cuatro reglas del ejemplo: los valores por defecto del catálogo real. */
export const UMBRALES = { roe: 15, ventas: 5, deuda: 2, per: 18 } as const;
export const PER_MIN = 16;
export const PER_MAX = 40;

export function cumple(e: Empresa, regla: number, per: number): boolean {
  switch (regla) {
    case 0: return e.roe != null && e.roe >= UMBRALES.roe;
    case 1: return e.ventas >= UMBRALES.ventas;
    case 2: return e.deuda != null && e.deuda <= UMBRALES.deuda;
    default: return e.per != null && e.per > 0 && e.per <= per;
  }
}

export interface Evaluacion {
  /** Para cada empresa, la primera regla que no cumple; -1 si las cumple todas. */
  caida: Int8Array;
  /** Empresas que quedan antes de la primera regla y tras cada una. */
  cuenta: [number, number, number, number, number];
  /** Las que cumplen, ordenadas por nota. */
  vivas: Empresa[];
  /** Las cinco de la cartera: mejor nota con como mucho dos por sector. */
  cartera: Empresa[];
}

export function evaluar(emp: Empresa[], per: number): Evaluacion {
  const caida = new Int8Array(emp.length);
  const cuenta: Evaluacion["cuenta"] = [emp.length, 0, 0, 0, 0];
  const vivas: Empresa[] = [];
  emp.forEach((e, i) => {
    let k = 0;
    while (k < 4 && cumple(e, k, per)) { k++; cuenta[k]++; }
    caida[i] = k === 4 ? -1 : k;
    if (k === 4) vivas.push(e);
  });
  vivas.sort((a, b) => b.nota - a.nota || b.cap - a.cap);
  const cartera: Empresa[] = [];
  const porSector = new Map<number, number>();
  for (const e of vivas) {
    if (cartera.length === 5) break;
    const n = porSector.get(e.sector) ?? 0;
    if (n < 2) { cartera.push(e); porSector.set(e.sector, n + 1); }
  }
  return { caida, cuenta, vivas, cartera };
}
