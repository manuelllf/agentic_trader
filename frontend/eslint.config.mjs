// Flat config de ESLint con las reglas oficiales de Next (core-web-vitals + typescript).
// Sin reglas propias: el gate es el estándar de Next, ni más ni menos.
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // next-env.d.ts lo genera Next en cada build (no se edita): fuera del lint.
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];

export default eslintConfig;
