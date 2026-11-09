# MR-FINAL-r1 — aceptación

MR-AUTH-r1: [aceptación adicional](auth-session-bugfix.md) exige ambos tipos de refreshed_at, rechazo de otros tipos, UTC independiente de TimeZone y conservación de todas las restricciones de sesión. El overlay de dos expresiones/dos helpers se declara separado de las fuentes recibidas.

MR01: seis fuentes fijadas por SHA256, generador determinista y050 sin wrappers de fixture, manteniendo todas las guardas funcionales.049 se preserva byte a byte. Contrato/install/preflight/postflight se regeneran juntos, nunca editar un hash esperado para aprobar una diferencia.

MR02: ejecutor sin rol correcto, Auth incompleto, esquema existente o trabajo activo se detiene antes de DDL. Preflight/postflight READ ONLY no escriben filas; el candidato usa transacción serializable y termina en COMMIT. LF/CRLF del instalador y de cuerpos heredados no cambia el contrato; un cambio real sí se rechaza.

MR03: en fixture local, el archivo final completo no modifica filas públicas anteriores, mantiene RLS/ACL y conserva catálogo fuera del delta. Las tablas nuevas no conceden acceso directo a anon/authenticated/service_role. Las cinco entradas antiguas de alta quedan cercadas y solo se exponen las RPCs humanas/servicio nuevas previstas. Ninguna configuración, ruta o cuenta se activa al instalar.

MR04: rollback del archivo exacto restaura catálogo/filas; fallo intencional del postcondition no deja DDL parcial; COMMIT y postflight independiente pasan. Una función privada extra o grant PUBLIC se detectan. Evidencia PGlite, no PG15 físico.

MR05: paquete incluye fuentes públicas actuales y Dockerfiles de ambos recursos; omite env reales, .local, .git, dependencias y builds. CSP admite únicamente el nuevo host exacto de consentimiento, manteniendo Google y sin añadir fetch de navegador a Composio. La publicación y el piloto no quedan aceptados por empaquetar fuentes.
