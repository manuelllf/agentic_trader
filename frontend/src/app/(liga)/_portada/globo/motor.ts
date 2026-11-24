export type Senal = { tipo: "cinco"; indice: number } | { tipo: "empresa"; rango: number };
export interface Elegida { ticker: string; rango: number }
export interface OpcionesGlobo {
  total: number;
  anillos: { rango: number; etiqueta: string }[];
  alContar: (n: number) => void;
  alTocar: (s: Senal) => void;
  alPrimerToque?: () => void;
}

const DOS = Math.PI * 2;
const DORADO = Math.PI * (3 - Math.sqrt(5));
const ESCANEO = 1500;
const GIRO = 1100;
const F = 3.4;
const FUENTE = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";

// Un bit por empresa: cada dígito hex aporta cuatro, el más alto primero.
export function decodificarMapa(hex: string, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (parseInt(hex.charAt(i >> 2), 16) >> (3 - (i & 3))) & 1;
  return b;
}

// Deja las cinco de cara y un poco por encima del ecuador; gira por el camino corto.
export function objetivoGiro(
  px: Float32Array, py: Float32Array, pz: Float32Array, rangos: number[], giroY: number,
): { y: number; x: number } {
  let gx = 0, gy = 0, gz = 0;
  for (const r of rangos) { gx += px[r]; gy += py[r]; gz += pz[r]; }
  const yaw = Math.atan2(-gx, gz), z1 = -gx * Math.sin(yaw) + gz * Math.cos(yaw);
  const pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(gy, z1) - 0.12));
  const dif = ((yaw - giroY) % DOS + DOS * 1.5) % DOS - Math.PI;
  return { y: giroY + dif, x: pitch };
}

export class Globo {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly N: number;
  private readonly quieto: boolean;
  private lado = 0; private R = 0; private cx = 0; private cy = 0; private dpr = 1;
  private readonly px: Float32Array; private readonly py: Float32Array;
  private readonly pz: Float32Array; private readonly lon: Float32Array;
  private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private readonly v: Float32Array; private readonly desde: Float32Array;
  private readonly hasta: Float32Array; private readonly cambio: Float32Array;
  private readonly giro = { y: -0.6, x: -0.42, vy: 0, auto: false, y0: 0, x0: 0, yObj: null as number | null, xObj: 0, tg: 0 };
  private readonly estado = { b: null as Uint8Array | null, cinco: [] as Elegida[], foco: 0, sel: -1, encima: -1, t0: -1e9, cuenta: 0, n: 0 };
  private readonly arrastre = { activo: false, x0: 0, y0: 0, x: 0, movido: 0, ult: 0 };
  private visible = true;
  private pendiente = false;
  private ultimo = 0;
  private raf = 0;
  private tm: ReturnType<typeof setTimeout> | undefined;
  private primerToque = false;
  private destruido = false;
  private readonly tmp = [0, 0, 0];
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private tCuenta: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly lienzo: HTMLCanvasElement,
    private readonly caja: HTMLElement,
    private readonly op: OpcionesGlobo,
  ) {
    const N = op.total;
    this.N = N;
    this.quieto = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.ctx = lienzo.getContext("2d");
    this.estado.cuenta = N;
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N); this.lon = new Float32Array(N);
    this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.sz = new Float32Array(N);
    this.v = new Float32Array(N); this.desde = new Float32Array(N); this.hasta = new Float32Array(N); this.cambio = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const yy = 1 - 2 * (i + 0.5) / N, rr = Math.sqrt(1 - yy * yy), th = i * DORADO;
      this.px[i] = rr * Math.cos(th); this.py[i] = yy; this.pz[i] = rr * Math.sin(th);
      this.lon[i] = ((th % DOS) + DOS) % DOS; this.v[i] = 1; this.desde[i] = 1; this.hasta[i] = 1; this.cambio[i] = -1;
    }

    lienzo.addEventListener("pointerdown", this.alBajar);
    lienzo.addEventListener("pointermove", this.alMover);
    lienzo.addEventListener("pointerup", this.soltar);
    lienzo.addEventListener("pointercancel", this.alCancelar);
    lienzo.addEventListener("touchstart", this.alEmpezarToque, { passive: false });
    lienzo.addEventListener("mouseleave", this.alSalir);
    document.addEventListener("visibilitychange", this.alVisibilidad);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((en) => {
        this.visible = en[0].isIntersecting && !document.hidden; this.ultimo = 0;
        if (!this.visible) this.cerrarCuenta();
        this.pedir();
      });
      this.io.observe(caja);
    }
    this.medir();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => { clearTimeout(this.tm); this.tm = setTimeout(() => this.medir(), 120); });
      this.ro.observe(caja);
    }
  }

  private medir(): void {
    if (this.destruido) return;
    const r = this.caja.getBoundingClientRect();
    const movil = typeof matchMedia === "function" && matchMedia("(max-width: 899px)").matches;
    this.lado = Math.floor(Math.max(220, Math.min(r.width + (movil ? 8 : 0), r.height)));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.lienzo.style.width = this.lado + "px"; this.lienzo.style.height = this.lado + "px";
    this.lienzo.width = Math.round(this.lado * this.dpr); this.lienzo.height = Math.round(this.lado * this.dpr);
    this.cx = this.lado / 2; this.cy = this.lado / 2; this.R = this.lado * 0.4;
    this.pedir();
  }

  private pedir(): void {
    if (this.destruido || this.pendiente) return;
    this.pendiente = true;
    this.raf = requestAnimationFrame(this.dibujar);
  }

  // Rotación (giro en y, inclinación en x) y perspectiva suave.
  private proyectar(x: number, y: number, z: number, out: number[]): number[] {
    const { giro, cx, cy, R } = this;
    const cyw = Math.cos(giro.y), syw = Math.sin(giro.y), cxp = Math.cos(giro.x), sxp = Math.sin(giro.x);
    const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    const y2 = y * cxp - z1 * sxp, z2 = y * sxp + z1 * cxp;
    const k = F / (F - z2);
    out[0] = cx + x1 * R * k; out[1] = cy - y2 * R * k; out[2] = z2;
    return out;
  }

  private readonly dibujar = (t: number): void => {
    this.pendiente = false;
    const ctx = this.ctx;
    if (!ctx || this.destruido) return;
    const { giro, estado, arrastre, tmp, N, quieto, px, py, pz, sx, sy, sz, v, desde, hasta, cambio, cx, cy, R, lado } = this;
    const dt = this.ultimo ? Math.min(50, t - this.ultimo) : 16; this.ultimo = t;
    if (giro.auto && this.visible && !arrastre.activo) giro.y += dt * 0.00006;
    if (!arrastre.activo && Math.abs(giro.vy) > 0.00001) { giro.y += giro.vy * dt; giro.vy *= Math.pow(0.92, dt / 16); }
    // Al elegir una idea, el globo se gira solo hasta dejar sus 5 de cara.
    if (giro.yObj !== null && !arrastre.activo) {
      const kg = quieto ? 1 : Math.min(1, Math.max(0, (t - giro.tg) / GIRO)), eg = kg < 0.5 ? 4 * kg * kg * kg : 1 - Math.pow(-2 * kg + 2, 3) / 2;
      giro.y = giro.y0 + (giro.yObj - giro.y0) * eg; giro.x = giro.x0 + (giro.xObj - giro.x0) * eg;
      if (kg >= 1) giro.yObj = null;
    }
    const escaneando = t - estado.t0 < ESCANEO + 400, frente = (t - estado.t0) / ESCANEO * DOS;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, lado, lado);

    // El cuerpo del globo: un disco con luz de un lado y un borde fino.
    const luz = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.1, cx, cy, R * 1.05);
    luz.addColorStop(0, "rgba(143,227,214,.16)"); luz.addColorStop(0.55, "rgba(143,227,214,.06)"); luz.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.fillStyle = luz; ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, DOS); ctx.fill();
    ctx.strokeStyle = "rgba(143,227,214,.32)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, DOS); ctx.stroke();

    // Paralelos de tamaño: cortes reales de la foto.
    for (const an of this.op.anillos) {
      const y0 = 1 - 2 * an.rango / N, r0 = Math.sqrt(1 - y0 * y0);
      for (let cara = 0; cara < 2; cara++) {
        ctx.beginPath(); let empezado = false;
        for (let s = 0; s <= 72; s++) {
          const a = s / 72 * DOS; this.proyectar(r0 * Math.cos(a), y0, r0 * Math.sin(a), tmp);
          const delante = tmp[2] >= 0;
          if (delante !== (cara === 1)) { empezado = false; continue; }
          if (!empezado) { ctx.moveTo(tmp[0], tmp[1]); empezado = true; } else ctx.lineTo(tmp[0], tmp[1]);
        }
        ctx.setLineDash(cara ? [3, 4] : [2, 6]); ctx.strokeStyle = cara ? "rgba(255,255,255,.26)" : "rgba(255,255,255,.07)"; ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Empresas: por tandas de profundidad y estado, para pintar rápido.
    const NIV = 5, tandas: Path2D[] = [], b = estado.b;
    let fallosVistos = 0;
    for (let l = 0; l < NIV * 3; l++) tandas.push(new Path2D());
    for (let i = 0; i < N; i++) {
      this.proyectar(px[i], py[i], pz[i], tmp); sx[i] = tmp[0]; sy[i] = tmp[1]; sz[i] = tmp[2];
      const k = cambio[i] < 0 ? 1 : Math.min(1, Math.max(0, (t - cambio[i]) / 260));
      v[i] = desde[i] + (hasta[i] - desde[i]) * k;
      if (b && cambio[i] >= 0 && t >= cambio[i] && !b[i]) fallosVistos++;
      const prof = Math.min(NIV - 1, Math.max(0, Math.floor((tmp[2] + 1) / 2 * NIV)));
      const flash = b && b[i] && k < 1 && cambio[i] >= 0 && t >= cambio[i];
      const tipo = flash ? 2 : v[i] >= 0.5 ? 1 : 0;
      const radio = (tipo ? 1.5 : 1.1) * (0.55 + (tmp[2] + 1) * 0.32) * (lado / 380) * (flash ? 1.8 : 1);
      const p = tandas[tipo * NIV + prof]; p.moveTo(tmp[0] + radio, tmp[1]); p.arc(tmp[0], tmp[1], radio, 0, DOS);
    }
    for (let d = 0; d < NIV; d++) {
      const a0 = 0.05 + d * 0.05, a1 = 0.25 + d * 0.17;
      ctx.fillStyle = "rgba(255,255,255," + a0.toFixed(3) + ")"; ctx.fill(tandas[d]);
      ctx.fillStyle = "rgba(143,227,214," + a1.toFixed(3) + ")"; ctx.fill(tandas[NIV + d]);
      ctx.fillStyle = "rgba(220,255,248," + Math.min(1, a1 + 0.3).toFixed(3) + ")"; ctx.fill(tandas[2 * NIV + d]);
    }

    // El meridiano de escaneo: solo cuando hay trabajo que hacer.
    if (escaneando && frente < DOS) {
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(143,227,214,.9)"; ctx.shadowColor = "rgba(143,227,214,.8)"; ctx.shadowBlur = 10;
      ctx.beginPath(); let em = false;
      for (let s2 = 0; s2 <= 48; s2++) {
        const yy2 = 1 - 2 * s2 / 48, rr3 = Math.sqrt(Math.max(0, 1 - yy2 * yy2));
        this.proyectar(rr3 * Math.cos(frente), yy2, rr3 * Math.sin(frente), tmp);
        if (tmp[2] < -0.05) { em = false; continue; }
        if (!em) { ctx.moveTo(tmp[0], tmp[1]); em = true; } else ctx.lineTo(tmp[0], tmp[1]);
      }
      ctx.stroke(); ctx.restore();
    }

    // Número del titular sincronizado con el escaneo.
    if (b) {
      const n = escaneando ? N - fallosVistos : estado.n;
      if (n !== estado.cuenta) { estado.cuenta = n; this.op.alContar(n); }
    }

    // Las 5: arcos que salen del globo, en su orden, cuando acaba el escaneo.
    const cinco = estado.cinco;
    if (cinco.length) {
      const pc = quieto ? 1 : Math.min(1, Math.max(0, (t - estado.t0 - ESCANEO) / 700)), e = 1 - Math.pow(1 - pc, 3);
      ctx.save(); ctx.lineCap = "round";
      for (let j = 1; j < cinco.length; j++) {
        const parte = Math.min(1, Math.max(0, e * (cinco.length - 1) - (j - 1))); if (parte <= 0) break;
        const A = cinco[j - 1].rango, B = cinco[j].rango;
        let mx = px[A] + px[B], my = py[A] + py[B], mz = pz[A] + pz[B];
        const ml = Math.hypot(mx, my, mz) || 1;
        const dist = Math.hypot(px[A] - px[B], py[A] - py[B], pz[A] - pz[B]), alto = 1 + 0.18 + dist * 0.22;
        mx = mx / ml * alto; my = my / ml * alto; mz = mz / ml * alto;
        const pasos = 28; let ant: number[] | null = null;
        for (let s3 = 0; s3 <= pasos * parte; s3++) {
          const u = s3 / pasos, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
          this.proyectar(w0 * px[A] + w1 * mx + w2 * px[B], w0 * py[A] + w1 * my + w2 * py[B], w0 * pz[A] + w1 * mz + w2 * pz[B], tmp);
          if (ant) {
            ctx.strokeStyle = tmp[2] > -0.1 ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.2)"; ctx.lineWidth = tmp[2] > -0.1 ? 1.4 : 1;
            ctx.beginPath(); ctx.moveTo(ant[0], ant[1]); ctx.lineTo(tmp[0], tmp[1]); ctx.stroke();
          }
          ant = [tmp[0], tmp[1]];
        }
      }
      const ocupados: number[][] = [];
      for (let m = 0; m < cinco.length; m++) {
        const ix = cinco[m].rango, vis = Math.min(1, Math.max(0, e * 5 - m)); if (vis <= 0) continue;
        const delante = sz[ix] > -0.05, foco = m === estado.foco;
        ctx.globalAlpha = vis * (delante ? 1 : 0.35);
        ctx.fillStyle = "#052522"; ctx.beginPath(); ctx.arc(sx[ix], sy[ix], foco ? 7 : 5.5, 0, DOS); ctx.fill();
        ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(sx[ix], sy[ix], foco ? 4.5 : 3.5, 0, DOS); ctx.fill();
        ctx.strokeStyle = "rgba(143,227,214,.95)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx[ix], sy[ix], foco ? 8.5 : 7, 0, DOS); ctx.stroke();
        // Señal de vida de las 5: un eco cada pocos segundos, de una en una.
        if (!quieto && delante && pc >= 1) {
          const fase = ((t / 3600) + m * 0.14) % 1;
          if (fase < 0.3) { const fe = fase / 0.3; ctx.strokeStyle = "rgba(143,227,214," + (0.6 * (1 - fe)).toFixed(3) + ")"; ctx.beginPath(); ctx.arc(sx[ix], sy[ix], 8 + fe * 14, 0, DOS); ctx.stroke(); }
        }
        if (delante) {
          let ux = sx[ix] - cx, uy = sy[ix] - cy; const dd = Math.hypot(ux, uy) || 1; ux /= dd; uy /= dd;
          const tx = sx[ix] + ux * 14; let ty = sy[ix] + uy * 14 + 4;
          const txt = (m + 1) + " " + cinco[m].ticker;
          ctx.font = (foco ? "700 " : "600 ") + "12px " + FUENTE;
          ctx.textAlign = ux > 0.25 ? "left" : ux < -0.25 ? "right" : "center";
          const an = ctx.measureText(txt).width, paso = uy >= 0 ? 15 : -15;
          const x0 = () => ctx.textAlign === "left" ? tx : ctx.textAlign === "right" ? tx - an : tx - an / 2;
          for (let it = 0; it < 6; it++) {
            const xi = x0();
            if (!ocupados.some((o) => xi < o[0] + o[2] && xi + an > o[0] && ty - 12 < o[1] && ty > o[1] - 12)) break;
            ty += paso;
          }
          ocupados.push([x0(), ty, an]);
          ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(5,37,34,.92)"; ctx.strokeText(txt, tx, ty);
          ctx.fillStyle = foco ? "#8FE3D6" : "#FFFFFF"; ctx.fillText(txt, tx, ty);
        }
      }
      ctx.restore();
    }

    // Rótulos de los paralelos, en el borde derecho del globo.
    ctx.save(); ctx.font = "600 10.5px " + FUENTE; ctx.textAlign = "left"; ctx.lineWidth = 3.5;
    for (const an of this.op.anillos) {
      const y0 = 1 - 2 * an.rango / N; let best: number[] | null = null;
      for (let s4 = 0; s4 < 72; s4++) {
        const a4 = s4 / 72 * DOS;
        this.proyectar(Math.sqrt(1 - y0 * y0) * Math.cos(a4), y0, Math.sqrt(1 - y0 * y0) * Math.sin(a4), tmp);
        if (tmp[2] >= 0 && (!best || tmp[0] > best[0])) best = [tmp[0], tmp[1]];
      }
      if (!best) continue;
      ctx.textAlign = "right";
      ctx.strokeStyle = "rgba(5,37,34,.9)"; ctx.strokeText(an.etiqueta, best[0] - 8, best[1] - 5);
      ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillText(an.etiqueta, best[0] - 8, best[1] - 5);
    }
    ctx.restore();

    // Empresa señalada.
    [estado.encima, estado.sel].forEach((idx, n2) => {
      if (idx < 0) return;
      ctx.strokeStyle = n2 ? "#FFFFFF" : "rgba(255,255,255,.6)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx[idx], sy[idx], 6, 0, DOS); ctx.stroke();
    });

    const mueve = escaneando || arrastre.activo || giro.yObj !== null || Math.abs(giro.vy) > 0.00001 || (cinco.length > 0 && !quieto);
    if (mueve && this.visible) this.pedir();
  };

  // Cada empresa cambia cuando el meridiano llega a su longitud.
  encender(bits: Uint8Array, cinco: Elegida[], n: number): void {
    const { estado, giro, N, quieto } = this;
    const t = performance.now();
    estado.b = bits; estado.cinco = cinco; estado.foco = 0; estado.sel = -1;
    estado.t0 = quieto ? t - ESCANEO - 1000 : t; estado.n = n;
    for (let i = 0; i < N; i++) {
      this.desde[i] = this.v[i]; this.hasta[i] = bits[i];
      this.cambio[i] = quieto ? t - 1000 : t + this.lon[i] / DOS * ESCANEO;
    }
    if (quieto) { estado.cuenta = n; this.op.alContar(n); }
    // Si el navegador deja de pintar a mitad de escaneo, el titular acaba igual en su cifra.
    clearTimeout(this.tCuenta);
    this.tCuenta = setTimeout(() => this.cerrarCuenta(), ESCANEO + 500);
    const obj = objetivoGiro(this.px, this.py, this.pz, cinco.map((c) => c.rango), giro.y);
    giro.y0 = giro.y; giro.x0 = giro.x; giro.yObj = obj.y; giro.xObj = obj.x; giro.tg = t; giro.vy = 0;
    this.pedir();
  }

  senalar(foco: number, sel: number): void {
    this.estado.foco = foco; this.estado.sel = sel;
    this.pedir();
  }

  // Arrastrar para girar (con inercia); tocar sin arrastrar elige una empresa.
  private readonly alBajar = (e: PointerEvent): void => {
    if (e.pointerType === "touch" && !this.sobreLaBola(e.clientX, e.clientY)) return;
    if (!this.primerToque) { this.primerToque = true; this.op.alPrimerToque?.(); }
    const a = this.arrastre;
    a.activo = true; a.x0 = a.x = e.clientX; a.y0 = e.clientY; a.movido = 0; a.ult = performance.now();
    this.giro.vy = 0;
    this.lienzo.setPointerCapture?.(e.pointerId);
    this.pedir();
  };

  private readonly alMover = (e: PointerEvent): void => {
    const a = this.arrastre, giro = this.giro;
    if (!a.activo) {
      const r = this.lienzo.getBoundingClientRect();
      this.estado.encima = this.cercana(e.clientX - r.left, e.clientY - r.top, 9); if (!giro.auto) this.pedir(); return;
    }
    // El globo se agarra: lo que hay bajo el dedo sigue al dedo (un radio = un radián).
    const dx = e.clientX - a.x, dy = e.clientY - a.y0, ahora = performance.now();
    a.movido += Math.abs(dx) + Math.abs(dy);
    giro.y += dx / this.R; giro.x = Math.max(-1.25, Math.min(1.25, giro.x + dy / this.R)); giro.yObj = null;
    giro.vy = (dx / this.R) / Math.max(8, ahora - a.ult);
    a.y0 = e.clientY; a.x = e.clientX; a.ult = ahora;
    this.pedir();
  };

  private readonly soltar = (e: PointerEvent): void => {
    const a = this.arrastre;
    if (!a.activo) return;
    a.activo = false;
    if (performance.now() - a.ult > 80) this.giro.vy = 0; // dedo parado antes de soltar: sin inercia
    if (a.movido < 6) this.tocar(e);
    this.pedir();
  };

  // Un dedo sobre la bola la gira y el navegador no hace scroll ni recarga; fuera de ella, la página se mueve.
  private readonly alEmpezarToque = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (e.touches.length === 1 && t && this.sobreLaBola(t.clientX, t.clientY)) e.preventDefault();
  };

  private sobreLaBola(x: number, y: number): boolean {
    const r = this.lienzo.getBoundingClientRect();
    return Math.hypot(x - r.left - this.cx, y - r.top - this.cy) <= this.R * 1.1;
  }

  private readonly alCancelar = (): void => { this.arrastre.activo = false; };
  private readonly alSalir = (): void => { this.estado.encima = -1; this.pedir(); };
  private readonly alVisibilidad = (): void => {
    this.visible = !document.hidden; this.ultimo = 0;
    if (!this.visible) this.cerrarCuenta();
    this.pedir();
  };

  // Con el globo fuera de la vista no se dibuja: el titular no se queda con la cuenta a medias.
  private cerrarCuenta(): void {
    const estado = this.estado;
    if (estado.b !== null && estado.cuenta !== estado.n) { estado.cuenta = estado.n; this.op.alContar(estado.n); }
  }

  private cercana(x: number, y: number, radio: number): number {
    let mejor = -1, dmin = radio;
    for (let i = 0; i < this.N; i++) {
      if (this.sz[i] < 0) continue;
      const d = Math.abs(this.sx[i] - x) + Math.abs(this.sy[i] - y);
      if (d < dmin) { dmin = d; mejor = i; }
    }
    return mejor;
  }

  private tocar(ev: PointerEvent): void {
    const { estado, sx, sy, sz } = this;
    const r = this.lienzo.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let mejor = -1, dmin = 22;
    estado.cinco.forEach((c, m) => {
      const ix = c.rango; if (sz[ix] < -0.05) return;
      const d = Math.hypot(sx[ix] - x, sy[ix] - y); if (d < dmin) { dmin = d; mejor = m; }
    });
    if (mejor >= 0) {
      estado.foco = mejor; estado.sel = -1;
      this.op.alTocar({ tipo: "cinco", indice: mejor });
    } else {
      const i = this.cercana(x, y, 14); if (i < 0) return;
      estado.sel = i; estado.foco = -1;
      this.op.alTocar({ tipo: "empresa", rango: i });
    }
    this.pedir();
  }

  destruir(): void {
    this.destruido = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.tm);
    this.lienzo.removeEventListener("pointerdown", this.alBajar);
    this.lienzo.removeEventListener("pointermove", this.alMover);
    this.lienzo.removeEventListener("pointerup", this.soltar);
    this.lienzo.removeEventListener("pointercancel", this.alCancelar);
    this.lienzo.removeEventListener("touchstart", this.alEmpezarToque);
    this.lienzo.removeEventListener("mouseleave", this.alSalir);
    clearTimeout(this.tCuenta);
    document.removeEventListener("visibilitychange", this.alVisibilidad);
    this.ro?.disconnect();
    this.io?.disconnect();
  }
}
