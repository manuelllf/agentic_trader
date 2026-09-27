// Todo lo de la liguilla vive dentro de .lg (liga.css, cargada en el layout raíz): sus tokens
// no llegan a las salas.
export default function LigaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="lg">{children}</div>;
}
