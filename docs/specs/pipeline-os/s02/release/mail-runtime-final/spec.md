# MR-FINAL-r1 — SQL y versión web/worker

08/11/2026 · STRICT · implementación/preparación local autorizada por «Hazlo». Continúa CW-I03/HTTP-I01; reutiliza decisiones F2, R06 y autorización de infraestructura existente. No hay nueva decisión de negocio. No ejecutar SQL remoto, push/deploy, proveedores o envíos por preparar el paquete.

| FR / AC     | Criterio                                                                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MR01 / AC01 | Conciliar seis SQL WC/CW/R06/T-009 completos, con hash/procedencia, sin editar fuentes local-only ni repetir048/049. Reservar050 solo en esta entrega final                                                                       |
| MR02 / AC02 | Preflight READ ONLY con catálogo/cola/contexto; aplicación atómica con guardas y COMMIT final; postflight READ ONLY ligado al mismo contrato. Comparación de funciones normaliza únicamente LF/CRLF; no admitir cambios de cuerpo |
| MR03 / AC03 | Conservación de metadatos/datos anteriores, funciones heredadas protegidas y ACL; nuevas tablas privadas con RLS, RPCs mínimos. No configuración real, live/sync, bindings, credenciales o rutas habilitadas por migrar           |
| MR04 / AC04 | Ensayo local del archivo final exacto, rollback transaccional, postflight y negativos; distinguir PGlite de PG15 físico y smoke productivo                                                                                        |
| MR05 / AC05 | Paquete de fuentes revisable web/worker sin secretos, dependencias o privados; nombres de variables, orden de publicación, pausa/corte y recuperación. Política CSP admite solo el dominio exacto de navegación ya validado       |

No se garantiza operación real ni se da G6 por preparar artefactos. Gmail directo permanece; Composio y alta apagados por defecto, Instantly43. El SQL final será candidato hasta completar su ensayo PG15 y controles de aplicación. La autorización productiva general previa se conserva; no se ejecuta en este turno.
