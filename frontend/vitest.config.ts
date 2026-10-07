import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// El alias `@` y el JSX automático replican lo que Next hace al compilar, para poder probar componentes.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
