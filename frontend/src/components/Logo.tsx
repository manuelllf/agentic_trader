// Logo de Agentic Trader: círculo verde con la marca de tendencia. Reutilizable a cualquier tamaño.
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
      <circle cx="48" cy="48" r="46" fill="#059669" />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(48,48)"
      >
        <path d="M-28 16 L-9 -3 L3 9 L25 -13" />
        <path d="M15 -13 L28 -13 L28 0" />
      </g>
    </svg>
  );
}
