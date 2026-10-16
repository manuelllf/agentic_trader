"use client";

import { useEffect, useRef } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: {
    sitekey: string;
    size: "flexible";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => string;
  remove?: (id: string) => void;
  reset?: (id: string) => void;
};

declare global {
  interface Window { turnstile?: Turnstile }
}

export default function TurnstileWidget({ onToken, resetKey = 0 }: {
  onToken: (token: string) => void;
  resetKey?: number;
}) {
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    if (!sitekey || typeof window === "undefined") return;
    let active = true;
    const render = () => {
      if (!active || typeof window === "undefined" || !window.turnstile || !container.current || widget.current !== undefined) return;
      widget.current = window.turnstile.render(container.current, {
        sitekey, size: "flexible",
        callback: token => { if (active) callback.current(token); },
        "expired-callback": () => { if (active) callback.current(""); },
        "error-callback": () => { if (active) callback.current(""); },
      });
    };
    callback.current("");
    let script = document.querySelector<HTMLScriptElement>('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render);
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", render);
    }
    render();
    const loadedScript = script;
    return () => {
      active = false;
      loadedScript.removeEventListener("load", render);
      if (typeof window !== "undefined" && widget.current !== undefined) {
        window.turnstile?.remove?.(widget.current);
      }
      widget.current = undefined;
    };
  }, [sitekey]);

  useEffect(() => {
    if (!sitekey || typeof window === "undefined" || !resetKey) return;
    callback.current("");
    if (widget.current !== undefined) window.turnstile?.reset?.(widget.current);
  }, [resetKey, sitekey]);

  if (!sitekey) return null;
  return <div ref={container} data-turnstile-widget="" style={{ width: "100%", minWidth: 0 }} />;
}
