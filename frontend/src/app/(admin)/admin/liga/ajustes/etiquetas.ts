const slugs: Record<string, string> = { "liga.clasificacion_viva": "live_ranking", "liga.registro.abierto": "registration", "liga.visible": "league_public", "ia.conversor.activo": "ai_converter", "ia.pregunta.activo": "ai_question", "ia.lectura.activo": "ai_reading", "ia.tope_mensual_usd": "ai_cap", "ia.formacion.activo": "ai_formation", "ia.tope_formacion_usd": "ai_formation_cap", "procesos.formar.limite_preguntas_s": "form_question_limit", "creditos.bienvenida": "welcome_credits", "procesos.foto.auto": "auto_photo", "procesos.formar.auto": "auto_form", "procesos.cerrar.auto": "auto_close", "premio.visible": "prize_visible", "premio.umbral_basico": "prize_threshold_basic", "premio.umbral_completo": "prize_threshold_full", "panel.dias_sin_estrategia": "panel_dias_sin_estrategia", "panel.dias_inactiva": "panel_dias_inactiva", "panel.aviso_tope_ia_pct": "panel_aviso_tope_ia_pct" };

export function claveTituloAjuste(clave: string): string | undefined {
  const slug = slugs[clave];
  return slug ? slug.startsWith("panel_") ? `admin_settings_${slug}_titulo` : `admin_setting_${slug}_title` : undefined;
}
