"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Flag en localStorage: el aviso de instalación se muestra UNA sola vez por navegador.
const SEEN_KEY = "pwa_install_seen";

export default function PwaInstall() {
  const t = useTranslations();
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
    <aside className="pwa-install" aria-label={t("system_instalar_vennett")}>
      <Image src="/favicon.svg" alt="" width={32} height={32} />
      <div>
        <p><strong>{t("system_vennett_a_mano")}</strong></p>
        <p>{t("system_acceso_movil")}</p>
      </div>
      <button
        onClick={install}
        className="pwa-install-action"
      >
        {t("system_instalar")}
      </button>
    </aside>
  );
}
