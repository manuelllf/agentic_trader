// Logo de Agentic Trader: marca "señal" -- la misma línea de precio con el punto de entrada
// que aparece en la portada, reducida a monograma. Fondo oscuro + acento único (ver tokens.ts
// de cada sala), nada de círculo genérico ni icono de flecha de stock de plantilla.
export default function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Agentic Trader"
    >
      <rect x="2" y="2" width="92" height="92" rx="22" fill="#131313" stroke="#303030" strokeWidth="1.5" />
      <path
        d="M20 52 L34 58 L45 34 L58 44 L76 22"
        fill="none"
        stroke="#737373"
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="45" cy="34" r="6" fill="#4FA39D" />
    </svg>
  );
}
