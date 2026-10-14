import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Logo de los correos: la palabra de `Marca.tsx` en PNG, porque los clientes de correo no muestran SVG.
// Uno en tinta para fondo claro y otro en blanco para fondo oscuro; la última t, siempre en petróleo.
const dir = path.dirname(fileURLToPath(import.meta.url));
const marca = await fs.readFile(path.join(dir, "../src/app/(liga)/_ui/Marca.tsx"), "utf8");
const trazos = [...marca.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
if (trazos.length !== 3) throw new Error(`Marca.tsx: esperaba 3 trazos y hay ${trazos.length}`);

const ANCHO = 264, ALTO = 56; // el doble de lo que ocupa en el correo (132 × 28), para pantallas densas
const svg = (tinta, petroleo) => `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="-2 38 999 210">`
  + `<path fill="${tinta}" d="${trazos[0]}"/><path fill="${tinta}" d="${trazos[1]}"/><path fill="${petroleo}" d="${trazos[2]}"/></svg>`;

const salida = path.join(dir, "../public/correo");
await fs.mkdir(salida, { recursive: true });
for (const [nombre, tinta, petroleo] of [["marca-clara", "#111315", "#0B6E68"], ["marca-oscura", "#F3F4F4", "#4FA39D"]]) {
  await sharp(Buffer.from(svg(tinta, petroleo)), { density: 300 })
    .resize(ANCHO, ALTO, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(path.join(salida, `${nombre}.png`));
}
