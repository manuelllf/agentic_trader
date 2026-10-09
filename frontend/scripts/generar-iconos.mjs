import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Icono de Vennett: las dos t de la palabra hechas velas (tinta y petróleo) sobre blanco petróleo.
// De aquí sale todo: favicon, iconos de la app, el de iPhone y los dos neutros de las notificaciones.
const T1 = '<path d="M53 58H67V144Q67 159 82 159H104V173H82Q53 173 53 144Z"/><rect x="35" y="82" width="50" height="44" rx="5"/>';
const T2 = '<path d="M115 30H129V144Q129 159 144 159H166V173H144Q115 173 115 144Z"/><rect x="97" y="46" width="50" height="44" rx="5"/>';
const DEFS = '<defs>'
  + '<linearGradient id="vn-fondo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0F6F6"/><stop offset="1" stop-color="#E2EEED"/></linearGradient>'
  + '<linearGradient id="vn-tinta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#30353B"/><stop offset="1" stop-color="#15171B"/></linearGradient>'
  + '<linearGradient id="vn-petroleo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13877F"/><stop offset="1" stop-color="#09534E"/></linearGradient>'
  + '<filter id="vn-sombra" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="4"/>'
  + '<feComponentTransfer><feFuncA type="linear" slope=".14"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
  + '<clipPath id="vn-tesela"><rect width="200" height="200" rx="44"/></clipPath>'
  + '</defs>';
const FONDO = '<rect width="200" height="200" fill="url(#vn-fondo)"/>'
  + '<path d="M0 62H200M0 100H200M0 138H200" stroke="#0B6E68" stroke-opacity=".07" stroke-width="1.5"/>';
// La línea discontinua es el nivel del índice; la t de petróleo queda por encima.
const FIGURA = '<path d="M24 82H178" stroke="#0B6E68" stroke-opacity=".26" stroke-width="2.5" stroke-dasharray="6 5"/>'
  + `<g filter="url(#vn-sombra)"><g fill="url(#vn-tinta)">${T1}</g><g fill="url(#vn-petroleo)">${T2}</g></g>`;
const svg = (interior) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="Vennett">${interior}</svg>\n`;
const centrar = (escala, interior) => `<g transform="translate(100 100) scale(${escala}) translate(-100.5 -101.5)">${interior}</g>`;
const silueta = (color) => `<g fill="${color}">${T1}${T2}</g>`;

// Icono de app: fondo a sangre completa y solo las dos velas. Sin rayas ni línea de nivel.
const VELAS = `<g fill="url(#vn-tinta)">${T1}</g><g fill="url(#vn-petroleo)">${T2}</g>`;
const FONDO_APP = '<rect width="200" height="200" fill="url(#vn-fondo)"/>';
const cuadrado = svg(DEFS + FONDO_APP + centrar(0.8, VELAS)); // iOS pone sus propias esquinas; las velas quedan en el 80 % central
const tesela = svg(`${DEFS}<g clip-path="url(#vn-tesela)">${FONDO}${FIGURA}</g>`);
// Disco petróleo con esquinas transparentes: el lanzador de Android lo muestra redondo, no como baldosa.
const redondo = svg(`${DEFS}<circle cx="100" cy="100" r="100" fill="url(#vn-fondo)"/>${centrar(0.8, VELAS)}`);
// Las notificaciones piden neutro: el icono grande en tinta sobre blanco y la insignia solo como silueta (Android usa su alfa).
const aviso = svg(`<rect width="200" height="200" fill="#FFFFFF"/>${centrar(0.78, silueta("#111315"))}`);
const insignia = svg(centrar(1.15, silueta("#FFFFFF")));

const rasterizar = (fuente, lado) => sharp(Buffer.from(fuente), { density: Math.ceil((72 * lado) / 200) }).resize(lado, lado);

// Pantalla de arranque de la app instalada en iPhone: iOS la escala desde un icono pequeño y sale borrosa.
// Cada medida es la del panel del dispositivo (px físicos) y su densidad (dpr), que pide el enlace del layout.
const PANTALLAS_ARRANQUE = [
  { ancho: 1290, alto: 2796, dpr: 3 }, { ancho: 1179, alto: 2556, dpr: 3 }, { ancho: 1170, alto: 2532, dpr: 3 },
  { ancho: 1284, alto: 2778, dpr: 3 }, { ancho: 1206, alto: 2622, dpr: 3 }, { ancho: 1320, alto: 2868, dpr: 3 },
  { ancho: 1242, alto: 2688, dpr: 3 }, { ancho: 1125, alto: 2436, dpr: 3 }, { ancho: 828, alto: 1792, dpr: 2 },
  { ancho: 750, alto: 1334, dpr: 2 }, { ancho: 640, alto: 1136, dpr: 2 },
];
// Fondo blanco como el tema claro y el disco de la app centrado, a la resolución de cada pantalla.
const arranque = (ancho, alto) => {
  const lado = Math.round(Math.min(ancho, alto) * 0.42);
  const x = (ancho - lado) / 2;
  const y = (alto - lado) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">${DEFS}`
    + `<rect width="${ancho}" height="${alto}" fill="#FFFFFF"/>`
    + `<g transform="translate(${x} ${y}) scale(${lado / 200})"><circle cx="100" cy="100" r="100" fill="url(#vn-fondo)"/>${centrar(0.8, VELAS)}</g></svg>\n`;
};

async function generar() {
  const publico = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
  await fs.writeFile(path.join(publico, "logo.svg"), cuadrado);
  await fs.writeFile(path.join(publico, "favicon.svg"), tesela);
  await fs.writeFile(path.join(publico, "../src/lib/brandIcon.ts"),
    `// Fuente vectorial compartida con las tarjetas exportadas.\nexport const VENNETT_ICON = ${JSON.stringify(tesela.trim())};\n`);
  await fs.writeFile(path.join(publico, "../src/lib/pantallasArranque.ts"),
    `// Pantallas de arranque de iPhone: las genera scripts/generar-iconos.mjs.\nexport const PANTALLAS_ARRANQUE = ${JSON.stringify(PANTALLAS_ARRANQUE)};\n`);
  for (const { ancho, alto } of PANTALLAS_ARRANQUE) {
    await sharp(Buffer.from(arranque(ancho, alto))).png().toFile(path.join(publico, `apple-splash-${ancho}x${alto}.png`));
  }
  for (const lado of [192, 512]) await rasterizar(redondo, lado).png().toFile(path.join(publico, `icon-${lado}.png`));
  await rasterizar(cuadrado, 180).flatten({ background: "#F0F6F6" }).png().toFile(path.join(publico, "apple-touch-icon.png"));
  await rasterizar(aviso, 192).png().toFile(path.join(publico, "notif-192.png"));
  await rasterizar(insignia, 96).png().toFile(path.join(publico, "badge-96.png"));
  const tamanos = [16, 32, 48];
  const imagenes = await Promise.all(tamanos.map((lado) => rasterizar(tesela, lado).png().toBuffer()));
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
