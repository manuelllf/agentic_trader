import { useState } from 'react';
import type { OutcomeBook, OutcomeScan, OutcomeStats } from '@/lib/api';
import { fmtDay, sign } from './helpers';
import { Details } from './ui';

/** Un retorno medio de grupo, coloreado por signo y con el tamaño del grupo al lado. */
export function OutPct({ s }: { s: OutcomeStats }) {
  if (!s.n || s.avg == null) return <span className="text-[#565654]">—</span>;
  return (
    <>
      <span className={s.avg >= 0 ? "font-semibold text-[#6BBE8A]" : "font-semibold text-[#E0776C]"}>
        {sign(s.avg)}{s.avg.toFixed(1)}%
      </span>
      <span className="text-[#6E6E6B]"> ({s.n})</span>
    </>
  );
}

/** Una cohorte de la traza como fila de la tabla. En los observatorios, "en cartera" es la
 *  construcción HIPOTÉTICA de ese martes (nada se compró); el pie de la tabla lo aclara. */
export function OutRow({ s, pct }: { s: OutcomeScan; pct: (v: number | null) => string }) {
  return (
    <tr className="border-t border-[#303030]">
      <td className="py-1.5 pr-3">
        del {fmtDay(s.at)} a hoy
        <span className="text-[#6E6E6B]"> · {s.days} d · {s.mode}</span>
      </td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.cartera} /></td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.seleccionados} /></td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.descartados} /></td>
      <td className="px-3 py-1.5 text-right">
        {s.groups.spy == null ? "—" : `${sign(s.groups.spy)}${s.groups.spy.toFixed(1)}%`}
      </td>
      <td className="px-3 py-1.5 text-right text-[#6E6E6B]">
        {s.corte.fuera.n ? `${pct(s.corte.fuera.avg)} / ${pct(s.corte.dentro.avg)}` : "—"}
      </td>
    </tr>
  );
}

/** La traza LEÍDA: qué hizo después cada grupo de cada cohorte. Son agregados puros —
 *  visibles también sin sesión, como el embudo: comportamiento sí, nombres no. Cada fila es
 *  un escaneo; el retorno va desde el precio del día del escaneo hasta hoy, a igual peso.
 *  Dos tarjetas, dos preguntas: "¿eligió bien?" (barras por grupo) y "¿el score predice?"
 *  (la nube score↔retorno) — cada una con su propio guard de "aún sin historial suficiente". */
export function OutcomesRead({ scans, book, onExportGrupos, msgGrupos, onExportScore, msgScore }: {
  scans: OutcomeScan[]; book: OutcomeBook | null;
  onExportGrupos: (p: "x" | "linkedin") => void; msgGrupos: string;
  onExportScore: (p: "x" | "linkedin") => void; msgScore: string;
}) {
  // Por defecto solo DECISIONES (mezclar filas semanales y mensuales invita a compararlas
  // entre sí, y el semanal analiza otra franja); los observatorios quedan tras un toggle —
  // siguen alimentando "¿el score predice?", tirarlos del todo sería desperdiciar señal.
  const [verObs, setVerObs] = useState(false);
  if (!scans.length && !book) return null;
  const pct = (v: number | null) => (v == null ? "—" : `${sign(v)}${v.toFixed(1)}%`);
  const decisiones = scans.filter((s) => s.mode === "decisión");
  const observatorios = scans.filter((s) => s.mode !== "decisión");
  const mostrarObs = verObs || (!book && decisiones.length === 0);
  const masVieja = scans.length ? Math.max(...scans.map((s) => s.days)) : 0;
  const diasLibro = book?.since
    ? Math.max(0, Math.floor((Date.now() - new Date(book.since).getTime()) / 86_400_000))
    : null;
  return (
    <div className="mb-6">
    <Details head={<>
        La auditoría, leída
        {/* La referencia de cada % tiene que estar EN la cabecera, no en la letra pequeña:
            sin "de su escaneo a hoy" la tabla eran números sin origen ni ventana. */}
        <span className="ml-2 text-[13px] font-normal normal-case tracking-normal text-[#6E6E6B]">
          cuánto ha subido o bajado cada grupo de nombres desde su escaneo hasta hoy
        </span>
      </>}>
      <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[#6E6E6B]">
                <th className="py-1.5 pr-3 font-semibold">Escaneo → hoy</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="media del grupo desde el precio del día del escaneo; entre paréntesis, cuántos nombres">En cartera</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="los del top-10 que el constructor dejó sin peso">Elegidos s/fondear</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="analizados a fondo y no seleccionados">Descartados</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="el índice en la misma ventana: la vara de medir">S&P 500</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="los 10 mejores pre-scores que no llegaron al profundo vs los 10 peores que sí entraron">
                  Corte: fuera / dentro
                </th>
              </tr>
            </thead>
            <tbody>
              {/* LO REAL primero: el libro vigente desde su compra (ledger, a valor de
                  mercado). La traza no alcanza a la decisión que lo compró, así que esta
                  fila es la única imagen real hasta que las cohortes nuevas maduren. */}
              {book && (
                <tr className="border-t border-[#303030]"
                    title="libro real a valor de mercado — anterior al inicio de la traza; el resto de columnas no puede reconstruirse">
                  <td className="py-1.5 pr-3">
                    cartera vigente{book.since ? ` · desde el ${fmtDay(book.since)}` : ""}
                    {diasLibro != null && <span className="text-[#6E6E6B]"> · {diasLibro} d</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {book.ret == null ? "—" : (
                      <>
                        <span className={book.ret >= 0 ? "font-semibold text-[#6BBE8A]" : "font-semibold text-[#E0776C]"}>
                          {sign(book.ret)}{book.ret.toFixed(1)}%
                        </span>
                        <span className="text-[#6E6E6B]"> ({book.n})</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right">
                    {book.spy == null ? "—" : `${sign(book.spy)}${book.spy.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                </tr>
              )}
              {decisiones.map((s) => <OutRow key={s.at} s={s} pct={pct} />)}
              {observatorios.length > 0 && (
                <tr className="border-t border-[#303030]">
                  <td colSpan={6} className="py-1.5">
                    <button onClick={() => setVerObs(!verObs)}
                            className="text-[11px] text-[#6E6E6B] hover:text-[#A3A3A0]">
                      {mostrarObs ? "▴ ocultar" : "▾ ver"} observatorios ({observatorios.length})
                      {mostrarObs ? "" : " — su «en cartera» es hipotético"}
                    </button>
                  </td>
                </tr>
              )}
              {mostrarObs && observatorios.map((s) => <OutRow key={s.at} s={s} pct={pct} />)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 border-t border-[#303030] pt-2 text-[11px] text-[#6E6E6B]">
          retorno simple desde el precio del día del escaneo, a igual peso dentro de cada grupo ·
          un profundo ilegible no cuenta como descarte
          {observatorios.length > 0 &&
            " · en los observatorios, «en cartera» es la construcción hipotética de ese martes, no el libro"}
          {masVieja > 0 && masVieja < 14 &&
            ` · la cohorte más vieja tiene ${masVieja} día${masVieja === 1 ? "" : "s"}: aún es ruido, la lectura seria llega con semanas`}
        </p>
        <ExportButtons onExport={onExportGrupos} msg={msgGrupos} label="¿Eligió bien?" />
        <ExportButtons onExport={onExportScore} msg={msgScore} label="¿El score predice?" />
      </div>
    </Details>
    </div>
  );
}

/** Un formato por red: cada una recorta a su ratio, y lo que no puede perderse en el recorte
 *  es justamente la cabecera y el pie legal — de ahí que se exporte ya al tamaño de destino.
 *  `label` distingue qué tarjeta exporta este grupo de botones cuando un mismo panel ofrece
 *  varias (la lectura de la auditoría, con "¿eligió bien?" y "¿el score predice?"). */
export function ExportButtons({ onExport, msg, label }: {
  onExport: (preset: "x" | "linkedin") => void; msg: string; label?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
      {msg && <span className="mr-auto text-[11px] text-[#6E6E6B]">{msg}</span>}
      <span className="text-[11px] text-[#6E6E6B]">{label ? `${label} · exportar tarjeta` : "Exportar tarjeta"}</span>
      {([["x", "X", "16:9 · 1600×900"], ["linkedin", "LinkedIn", "1,91:1 · 1200×627"]] as const)
        .map(([key, netLabel, ratio]) => (
          <button
            key={key} onClick={() => onExport(key)}
            title={`PNG ${ratio}, con cabecera, cifras y descargo legal dentro de la imagen`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#303030] px-2.5 py-1 text-[11px] font-medium text-[#6E6E6B] transition hover:bg-[#232323] hover:text-[#A3A3A0]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {netLabel}
          </button>
        ))}
    </div>
  );
}
