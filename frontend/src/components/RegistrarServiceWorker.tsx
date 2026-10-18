"use client";

import { useEffect } from "react";

// En el layout raíz: así cualquier página es instalable como app.
export default function RegistrarServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
