"use client";

// Panel de control: las salas y la liguilla, tras el candado de admin con 2FA (AuthGate).

import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import { useTranslations } from "next-intl";

const SALAS = [
  { href: "/admin/alpha", nombre: "Alpha", textoKey: "admin_home_alpha_desc" },
  { href: "/admin/beta", nombre: "Beta", textoKey: "admin_home_beta_desc" },
  { href: "/admin/omega", nombre: "Omega", textoKey: "admin_home_omega_desc" },
  { href: "/admin/liga", nombre: "Vennett", textoKey: "admin_home_liga_desc" },
];

export default function Admin() {
  const t = useTranslations();
  return (
    <AuthGate>
      <main className="mx-auto max-w-md px-4 pb-10 pt-8">
        <h1 className="text-[15px] font-bold text-white">{t("admin_home_rooms")}</h1>
        <ul className="mt-4 border-t border-[#303030]">
          {SALAS.map((s) => (
            <li key={s.href} className="border-b border-[#303030]">
              <Link href={s.href} className="flex min-h-[64px] flex-col justify-center gap-0.5 py-3">
                <span className="text-[19px] text-white"
                      style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>
                  {s.nombre}
                </span>
                <span className="text-[12.5px] text-[#898781]">{t(s.textoKey)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </AuthGate>
  );
}
