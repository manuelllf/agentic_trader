"use client";

import { Analytics } from "@vercel/analytics/next";
import { dejarPasar } from "@/lib/analitica";

// Solo mide las páginas que deja pasar lib/analitica.ts.
export default function AnaliticaPublica() {
  return <Analytics beforeSend={dejarPasar} />;
}
