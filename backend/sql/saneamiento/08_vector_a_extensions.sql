-- La extension vector sale de public (asesor de Supabase 0014). El backend la sigue
-- encontrando: el search_path de postgres incluye extensions.
alter extension vector set schema extensions;
