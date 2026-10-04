import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

async function generar() {
  const publico = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
  const marca = await fs.readFile(path.join(publico, "logo.svg"), "utf8");
  const contenido = marca.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const envolver = (interior) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Vennett">${interior}</svg>\n`;
  const encajar = (interior) => `<svg x="0" y="24" width="512" height="464" viewBox="0 0 630 571">${interior}</svg>`;
  const svg = envolver(`<defs><clipPath id="tile"><rect width="512" height="512" rx="112"/></clipPath></defs><g clip-path="url(#tile)"><rect width="512" height="512" fill="#fff"/>${encajar(contenido)}</g>`);
  const mascara = envolver(`<rect width="512" height="512" fill="#fff"/><g transform="translate(51.2 51.2) scale(.8)">${encajar(contenido)}</g>`);
  await fs.writeFile(path.join(publico, "favicon.svg"), svg);
  await fs.writeFile(path.join(publico, "../src/lib/brandIcon.ts"),
    `// Fuente vectorial compartida con las tarjetas exportadas.\nexport const VENNETT_ICON = ${JSON.stringify(svg.trim())};\n`);
  for (const lado of [192, 512]) {
    await sharp(Buffer.from(svg)).resize(lado, lado).png().toFile(path.join(publico, `icon-${lado}.png`));
    await sharp(Buffer.from(mascara)).resize(lado, lado).png().toFile(path.join(publico, `icon-maskable-${lado}.png`));
  }
  await sharp(Buffer.from(svg)).resize(180, 180).flatten({ background: "#FFFFFF" })
    .png().toFile(path.join(publico, "apple-touch-icon.png"));
  const tamanos = [16, 32, 48];
  const imagenes = await Promise.all(tamanos.map((lado) => sharp(Buffer.from(svg)).resize(lado, lado).png().toBuffer()));
  const cabecera = Buffer.alloc(6 + 16 * tamanos.length);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(tamanos.length, 4);
  let posicion = cabecera.length;
  imagenes.forEach((png, i) => {
    const entrada = 6 + 16 * i;
    cabecera[entrada] = tamanos[i]; cabecera[entrada + 1] = tamanos[i];
    cabecera.writeUInt16LE(1, entrada + 4);
    cabecera.writeUInt16LE(32, entrada + 6);
    cabecera.writeUInt32LE(png.length, entrada + 8);
    cabecera.writeUInt32LE(posicion, entrada + 12);
    posicion += png.length;
  });
  await fs.writeFile(path.join(publico, "favicon.ico"), Buffer.concat([cabecera, ...imagenes]));
}

generar().catch((error) => { console.error(error); process.exitCode = 1; });
