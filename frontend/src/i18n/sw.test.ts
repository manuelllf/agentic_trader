import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const entries = new Map<string, Response>();
  const key = (request: string | { url: string }) => typeof request === "string" ? request : request.url;
  const cache = { put: async (request: string | { url: string }, response: Response) => { entries.set(key(request), response); } };
  const fetch = vi.fn();
  const showNotification = vi.fn();
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    URL, Response, Map, fetch,
    caches: { open: async () => cache, match: async (request: string | { url: string }) => entries.get(key(request))?.clone() },
    self: { location: { origin: "https://vennett.test" }, registration: { showNotification },
      addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => handlers.set(type, callback) },
  });
  const notifyLocale = async (locale: string, id = "tab") => {
    let pending: Promise<unknown> | undefined;
    handlers.get("message")!({ data: { type: "VENNETT_LOCALE", locale }, source: { id }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  const request = (path: string, mode = "navigate", clientId = "tab") => {
    let result: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { url: `https://vennett.test${path}`, method: "GET", mode }, clientId,
      respondWith: (promise: Promise<Response>) => { result = promise; } });
    return result;
  };
  return { handlers, entries, fetch, showNotification, notifyLocale, request };
}

describe("PWA language isolation", () => {
  it("never intercepts private pages, APIs or RSC requests", () => {
    const sw = worker();
    expect(sw.request("/mias")).toBeUndefined();
    expect(sw.request("/api/review/liga/yo")).toBeUndefined();
    expect(sw.request("/", "cors")).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it("serves only the selected language from the public offline cache", async () => {
    const sw = worker();
    for (const locale of ["es", "en"]) {
      sw.fetch.mockResolvedValueOnce(new Response(locale, { headers: { "Content-Language": locale } }));
      expect(await (await sw.request("/"))!.text()).toBe(locale);
    }
    sw.fetch.mockRejectedValue(new Error("offline"));
    await sw.notifyLocale("es");
    expect(await (await sw.request("/"))!.text()).toBe("es");
    await sw.notifyLocale("en");
    expect(await (await sw.request("/"))!.text()).toBe("en");
  });

  it("rejects invalid locale messages and does not cache unlabelled HTML", async () => {
    const sw = worker();
    await sw.notifyLocale("../en");
    sw.fetch.mockResolvedValue(new Response("unknown"));
    await sw.request("/");
    expect(sw.entries.size).toBe(0);
  });

  it("localizes fallback notifications while preserving supplied content", async () => {
    const sw = worker();
    await sw.notifyLocale("en");
    let pending: Promise<unknown> | undefined;
    sw.handlers.get("push")!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(sw.showNotification.mock.calls[0][1].body).toBe("New alert.");
    sw.handlers.get("push")!({ data: { json: () => ({ body: "Original report" }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(sw.showNotification.mock.calls[1][1].body).toBe("Original report");
  });
});
