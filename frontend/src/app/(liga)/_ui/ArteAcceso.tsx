import { useTranslations } from "next-intl";

export function ArteAcceso({ variante }: { variante: "fondo" | "bloque" }) {
  const t = useTranslations();
  if (variante === "fondo") return <svg className="acc-arte acc-arte-fondo" viewBox="0 0 390 330"
    preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
    <g stroke="var(--line)" strokeWidth="1">
      {[60, 104, 148, 192, 236, 280].map(y => <line key={y} x1="0" x2="390" y1={y} y2={y} />)}
      {[30, 76, 122, 168, 214, 260, 306, 352].map(x => <line key={x} x1={x} x2={x} y1="0" y2="330" />)}
    </g>
    <path d="M-10 214 C30 208 60 224 100 216 S170 190 210 200 S280 222 320 208 S370 200 400 202"
      fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeDasharray="6 6" strokeLinecap="round" />
    <path d="M-10 222 C30 212 60 220 100 204 S170 160 210 164 S280 150 320 118 S370 96 380 94"
      fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
    <circle cx="380" cy="94" r="12" fill="var(--accent-bg)" />
    <circle cx="380" cy="94" r="5.5" fill="var(--accent)" />
  </svg>;
  return <svg className="acc-arte acc-arte-bloque" viewBox="0 0 350 96" role="img" aria-label={t("auth_arte_alt")} focusable="false">
    <g stroke="var(--line)" strokeWidth="1">
      {[10, 34, 58, 82].map(y => <line key={y} x1="0" x2="350" y1={y} y2={y} />)}
      {[30, 76, 122, 168, 214, 260, 306].map(x => <line key={x} x1={x} x2={x} y1="0" y2="86" />)}
    </g>
    <path d="M0 62 C30 58 52 70 82 64 S130 48 160 56 S214 70 246 60 S290 56 336 56"
      fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" />
    <path d="M0 66 C30 60 52 68 82 58 S130 38 160 42 S214 44 246 30 S290 26 336 22"
      fill="none" stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" />
    <circle cx="336" cy="22" r="9" fill="var(--accent-bg)" />
    <circle cx="336" cy="22" r="4.5" fill="var(--accent)" />
    <g fontSize="12" fontWeight="600" fontFamily="inherit">
      <text x="0" y="94" fill="var(--accent)">{t("auth_arte_tu")}</text>
      <text x="350" y="94" fill="var(--muted)" textAnchor="end">{t("auth_arte_indice")}</text>
    </g>
  </svg>;
}
