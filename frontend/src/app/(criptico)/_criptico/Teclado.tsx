import type { Idioma, Traducir } from "@/lib/criptico/tipos";

export default function Teclado({ idioma, escribir, borrar, comprobar, ocupado, t }: {
  idioma: Idioma; escribir: (letra: string) => void; borrar: () => void;
  comprobar: () => void; ocupado: boolean; t: Traducir;
}) {
  const filas = ["QWERTYUIOP", idioma === "es" ? "ASDFGHJKLÑ" : "ASDFGHJKL", "ZXCVBNM"];
  return <div className="cr-pie-teclado">
    <button type="button" className="btn pri wide" disabled={ocupado} onClick={comprobar}>{t("cr_comprobar")}</button>
    <div className="cr-teclado" role="group" aria-label={t("cr_teclado")}>
      {filas.map((fila, i) => <div className="cr-fila" key={fila}>
        {[...fila].map(letra => <button type="button" key={letra} disabled={ocupado}
          aria-label={t("cr_tecla", { letra })} onClick={() => escribir(letra)}>{letra}</button>)}
        {i === 2 && <button type="button" className="cr-borrar" disabled={ocupado} aria-label={t("cr_borrar")} onClick={borrar}>⌫</button>}
      </div>)}
    </div>
  </div>;
}
