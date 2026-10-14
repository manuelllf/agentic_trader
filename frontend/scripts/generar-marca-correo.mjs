import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Logo de los correos: la palabra de `Marca.tsx` en PNG sobre una pastilla clara, válido en modo claro y oscuro.
// La última t va en petróleo, como en la app.
const dir = path.dirname(fileURLToPath(import.meta.url));
const marca = await fs.readFile(path.join(dir, "../src/app/(liga)/_ui/Marca.tsx"), "utf8");
const trazos = [...marca.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
if (trazos.length !== 3) throw new Error(`Marca.tsx: esperaba 3 trazos y hay ${trazos.length}`);

// 200 × 48 en el correo, a doble densidad. La palabra ocupa 132 × 28 centrada en la pastilla.
const ANCHO = 400, ALTO = 96;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">`
  + `<rect width="${ANCHO}" height="${ALTO}" rx="16" fill="#F0F6F6"/>`
  + `<svg x="68" y="20" width="264" height="56" viewBox="-2 38 999 210">`
  + `<path fill="#111315" d="${trazos[0]}"/><path fill="#111315" d="${trazos[1]}"/>`
  + `<path fill="#0B6E68" d="${trazos[2]}"/></svg></svg>`;

const salida = path.join(dir, "../public/correo");
await fs.mkdir(salida, { recursive: true });
await sharp(Buffer.from(logo), { density: 144 })
  .resize(ANCHO, ALTO).png().toFile(path.join(salida, "marca-correo.png"));
