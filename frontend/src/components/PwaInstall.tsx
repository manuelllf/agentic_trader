"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Flag en localStorage: el aviso de instalación se muestra UNA sola vez por navegador.
const SEEN_KEY = "pwa_install_seen";

export default function PwaInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Registrar el service worker.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Si ya se enseñó una vez, no volver a registrarlo (Chrome relanza el evento en cada navegación).
    if (localStorage.getItem(SEEN_KEY)) return;

    // Capturar el evento de instalación, marcarlo como visto y mostrar el aviso unos segundos.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      localStorage.setItem(SEEN_KEY, "1"); // marcado: no volverá a aparecer nunca más
      setPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
      setTimeout(() => setVisible(false), 6000);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const install = async () => {
    if (!prompt) return;
    setVisible(false);
    await prompt.prompt();
    setPrompt(null);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
      <div className="text-lg">📈</div>
      <div className="flex-1 text-sm">
        <p className="font-semibold text-slate-900">Instala Agentic Trader</p>
        <p className="text-slate-500">Acceso directo en tu móvil</p>
      </div>
      <button
        onClick={install}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        Instalar
      </button>
    </div>
  );
}
