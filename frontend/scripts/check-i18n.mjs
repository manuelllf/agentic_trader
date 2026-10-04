import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@formatjs/icu-messageformat-parser";

const root = resolve(import.meta.dirname, "..", "messages");
const catalogs = { es: {}, en: {} };
const failures = [];

function parameters(nodes, result = new Set()) {
  for (const node of nodes) {
    if ([1, 2, 3, 4, 5, 6, 8].includes(node.type)) result.add(node.value);
    if (node.options) for (const option of Object.values(node.options)) parameters(option.value, result);
    if (node.children) parameters(node.children, result);
  }
  return [...result].sort();
}

for (const locale of ["es", "en"]) {
  for (const filename of readdirSync(resolve(root, locale)).filter((name) => name.endsWith(".json"))) {
    const messages = JSON.parse(readFileSync(resolve(root, locale, filename), "utf8"));
    for (const [key, message] of Object.entries(messages)) {
      if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(key)) failures.push(`${locale}/${filename}: invalid key ${key}`);
      if (key in catalogs[locale]) failures.push(`${locale}: duplicate key ${key}`);
      if (typeof message !== "string" || !message.trim()) failures.push(`${locale}: empty message ${key}`);
      try { catalogs[locale][key] = parameters(parse(message)); }
      catch (error) { failures.push(`${locale}/${key}: ${error.message}`); }
    }
  }
}
for (const key of new Set([...Object.keys(catalogs.es), ...Object.keys(catalogs.en)])) {
  if (!(key in catalogs.es) || !(key in catalogs.en)) failures.push(`Missing language pair: ${key}`);
  else if (JSON.stringify(catalogs.es[key]) !== JSON.stringify(catalogs.en[key])) failures.push(`Different parameters: ${key}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`${Object.keys(catalogs.es).length} paired keys; ICU syntax and parameters verified.`);
