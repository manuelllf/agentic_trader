import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Marca } from "./(liga)/_ui/Marca";
import "./(liga)/liga/ranking.css";
import "./(liga)/_ui/grupos.css";
import "./(liga)/_ui/paginas.css";

// 404 propia, para que nunca salga la de Vercel. Vale también para /admin/lo-que-sea y el blog.
export default async function NoEncontrada() {
  const t = await getTranslations();
  return (
    <div className="lg">
      <main className="scroll lv-pagina pg-pagina">
        <header className="cab centrada">
          <span />
          <Link href="/" className="pg-sello" aria-label="Vennett"><Marca className="marca" /></Link>
          <span />
        </header>
        <div className="pg">
          <div className="pg-vacio">
            <svg className="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 5h15l10 10v28H13z" />
              <path d="M28 5v10h10" />
              <path d="M22 25a3.5 3.5 0 1 1 4.7 3.3c-.8.3-1.2 1-1.2 1.7v.6M25.5 35.5v.3" />
            </svg>
            <h1>{t("system_no_encontrada")}</h1>
            <p>{t("system_direccion_no_existe")}</p>
            <div className="acciones">
              <Link className="cu-boton" href="/">{t("system_volver_portada")}</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
