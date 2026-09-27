"""Procesos de la liga (plan §13): código del backend, nunca trabajos en la BD.

- `temporadas`: la pretemporada y la temporada 1 con sus jornadas.
- `foto`: qué foto y qué escaneo de decisión usa cada jornada (plan B incluido).
- `formar`: las carteras del día 1 (estrategias apuntadas y equipos de la casa).
- `diario`: cierres de lo que está en cartera y la tabla provisional, calculada.
- `cerrar`: resultados oficiales y rentabilidad del S&P de la jornada.

Cada uno se controla desde admin (`app.liga.rutas_admin`) con vista previa y ejecución. Corren
como sistema (dueño de la BD, sin RLS): son procesos, no peticiones de usuario. Lo que está hecho
lo dicen los estados del dominio (`jornadas.estado`) y los únicos de las tablas; que no corran dos
a la vez, un candado en el propio proceso (`comun.candado`).
"""
