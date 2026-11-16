# Tareas y evidencia

- T01/R01–05: SQL aditivo, RLS/ACL, concesiones, cuota y reversa: terminado; nativo y embebido pasan.
- T02/R01–05: servicio y rutas HTTP: terminado;106 regresiones, tipos y build correctos.
- T03/R01/R05: panel local: terminado; consulta/POST/continuación observados con datos ficticios y cero externos.
- T04/R06: controles locales y revisión: terminados. Detectados/corregidos en ensayo el fixture con reloj no atómico y un alias PL/pgSQL que chocaba con una variable; sin debilitar checks.
- T05/R06: respaldo/postflight SQL: ejecutados y verificados; ver backup.json, sql-application.json, production-postflight.json.
- T06/R06: commit/push y deployments: en curso; registrar commit e imágenes reales al terminar.
- T07/R01–06: verificación real de sesión/recuperación: pendiente de publicación saludable; sin JWT fabricado ni Google repetido.
