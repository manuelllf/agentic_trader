// Orden genérico de tablas: mismo comportamiento que el grid de finalistas de ScanFullModal
// (toggle desc→asc en la misma columna, null/undefined siempre al final, desempate estable).
import { useMemo, useState } from "react";

export type OrdenDir = "asc" | "desc";
type Accessor<Row, Key extends string> = (row: Row, key: Key) => string | number | null | undefined;

// Aparte de useOrden, exportada suelta: para aplicar el MISMO key/dir a varios grupos de filas
// bajo una sola cabecera (p.ej. Outcomes: decisiones y observatorios comparten columna y control).
export function sortRows<Row, Key extends string>(
  rows: Row[], accessor: Accessor<Row, Key>, key: Key | null, dir: OrdenDir,
): Row[] {
  if (key == null) return rows;
  const withIdx = rows.map((row, i) => ({ row, i }));
  withIdx.sort((a, b) => {
    const av = accessor(a.row, key);
    const bv = accessor(b.row, key);
    if (av == null && bv == null) return a.i - b.i;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv) : (av as number) - (bv as number);
    const primary = cmp * (dir === "asc" ? 1 : -1);
    return primary !== 0 ? primary : a.i - b.i;
  });
  return withIdx.map((x) => x.row);
}

export function useOrden<Row, Key extends string>(
  rows: Row[],
  accessor: Accessor<Row, Key>,
  initial?: { key: Key; dir: OrdenDir },
) {
  const [key, setKey] = useState<Key | null>(initial?.key ?? null);
  const [dir, setDir] = useState<OrdenDir>(initial?.dir ?? "desc");

  const toggle = (col: Key) => {
    setDir((d) => (key === col && d === "desc" ? "asc" : "desc"));
    setKey(col);
  };

  const sorted = useMemo(() => sortRows(rows, accessor, key, dir), [rows, accessor, key, dir]);

  const ariaSort = (col: Key): "ascending" | "descending" | "none" =>
    key !== col ? "none" : dir === "asc" ? "ascending" : "descending";

  return { sorted, sortKey: key, sortDir: dir, toggle, ariaSort };
}
