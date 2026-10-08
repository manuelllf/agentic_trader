"use client";

// Los diálogos del navegador rompen la sensación nativa de la app instalada.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./Confirmar.module.css";

export interface OpcionesConfirmar {
  titulo: string;
  texto?: string;
  aceptar: string;
  peligro?: boolean;
}
export interface OpcionesTexto {
  titulo: string; texto?: string; aceptar: string;
  etiqueta: string;
  max?: number;
}
type Pendiente =
  | { opciones: OpcionesConfirmar; modo: "confirmar"; resolver: (valor: boolean) => void }
  | { opciones: OpcionesTexto; modo: "texto"; resolver: (valor: string | null) => void };

function cancelar(p: Pendiente) {
  if (p.modo === "confirmar") p.resolver(false);
  else p.resolver(null);
}

export function useConfirmar(): {
  confirmar: (o: OpcionesConfirmar) => Promise<boolean>;
  pedirTexto: (o: OpcionesTexto) => Promise<string | null>;
  dialogo: ReactNode;
} {
  const t = useTranslations();
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const actual = useRef<Pendiente | null>(null);
  const [texto, setTexto] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const aceptar = useRef<HTMLButtonElement>(null);
  const cancelarBoton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const tituloId = useId();
  const textoId = useId();
  const abrir = useCallback((p: Pendiente) => {
    if (actual.current) cancelar(actual.current);
    actual.current = p;
    setTexto("");
    setPendiente(p);
  }, []);
  const confirmar = useCallback((opciones: OpcionesConfirmar) =>
    new Promise<boolean>((resolver) => abrir({ opciones, modo: "confirmar", resolver })), [abrir]);
  const pedirTexto = useCallback((opciones: OpcionesTexto) =>
    new Promise<string | null>((resolver) => abrir({ opciones, modo: "texto", resolver })), [abrir]);
  const cerrar = (aceptado = false) => {
    const p = actual.current;
    if (!p) return;
    if (!aceptado) cancelar(p);
    else if (p.modo === "confirmar") p.resolver(true);
    else {
      if (!texto.trim()) return;
      p.resolver(texto.trim());
    }
    actual.current = null;
    setPendiente(null);
  };
  useEffect(() => () => {
    if (actual.current) cancelar(actual.current);
    actual.current = null;
  }, []);
  useEffect(() => {
    const d = dialog.current;
    if (!pendiente || !d) return;
    d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (pendiente.modo === "texto") campo.current?.focus();
    else if (pendiente.opciones.peligro) cancelarBoton.current?.focus();
    else aceptar.current?.focus();
    return () => { d.close(); document.body.style.overflow = overflow; };
  }, [pendiente]);

  const peligro = pendiente?.modo === "confirmar" && pendiente.opciones.peligro;
  const dialogo = pendiente ? (
    <dialog ref={dialog} className={styles.dialogo} role={peligro ? "alertdialog" : "dialog"}
      aria-labelledby={tituloId} aria-describedby={pendiente.opciones.texto ? textoId : undefined}
      onCancel={(event) => { event.preventDefault(); cerrar(); }}
      onClick={(event) => { if (event.target === event.currentTarget) cerrar(); }}>
      <div className={styles.contenido}>
        <div className={styles.asa} aria-hidden="true" />
        <h3 id={tituloId}>{pendiente.opciones.titulo}</h3>
        {pendiente.opciones.texto && <p id={textoId}>{pendiente.opciones.texto}</p>}
        {pendiente.modo === "texto" && <textarea ref={campo} className={styles.campo}
          aria-label={pendiente.opciones.etiqueta} maxLength={pendiente.opciones.max ?? 500}
          value={texto} onChange={(event) => setTexto(event.target.value)} />}
        <div className={styles.acciones}>
          <button ref={aceptar} type="button" className={`${styles.boton} ${peligro ? styles.peligro : styles.primario}`}
            disabled={pendiente.modo === "texto" && !texto.trim()} onClick={() => cerrar(true)}>{pendiente.opciones.aceptar}</button>
          <button ref={cancelarBoton} type="button" className={styles.boton} onClick={() => cerrar()}>{t("common_cancelar")}</button>
        </div>
      </div>
    </dialog>
  ) : null;
  return { confirmar, pedirTexto, dialogo };
}
