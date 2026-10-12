import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";

afterEach(() => vi.unstubAllEnvs());

describe("robots", () => {
  it("permite rastrear producción y anuncia el sitemap", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/", "/cuenta/"] },
      sitemap: "https://vennett.app/sitemap.xml",
    });
  });
  it.each(["preview", "development", "", "otro", undefined])("bloquea el entorno %s", (entorno) => {
    vi.stubEnv("VERCEL_ENV", entorno);
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
