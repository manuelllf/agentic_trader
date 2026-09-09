"use client";

// La puerta a Alpha: transición de fundido a oscuro antes de navegar.
// El overlay usa el MISMO color de fondo que /alpha para que el traspaso sea invisible.

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AlphaDoor() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  const enter = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => router.push("/alpha"), 430);
  };

  return (
    <>
      <button
        onClick={enter}
        className="group inline-flex items-center gap-2 rounded-md bg-[#16191D] px-3 py-1.5 text-[11px] font-bold text-slate-200 ring-1 ring-inset ring-slate-700 transition-all hover:ring-[#4FA39D] hover:text-white"
        title="Cuenta real: el agente propone, tú decides"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#4FA39D]" />
        ALPHA
      </button>
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-[100] bg-[#131313] transition-opacity duration-[420ms] ease-in ${leaving ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}
