# Verificación

G0–G5 locales: completados. G6: pendiente de aprobación específica, respaldo reciente y promoción del paquete revisado. Base y origin/main conciliados: a881100518f10f1fce1594010b3721f4bc9b4b24. No hay commit, push, migración o publicación de este paquete todavía.

Lectura productiva aislada repeatable-read/read-only: datos agregados del diagnóstico en spec.md. API/worker no ejecutados manualmente. Ver datos carga las once filas queued; sin error de API reproducido, problema de información operativa. No se intentó saltar cuotas, horario o permisos. La evidencia pública no contiene contactos reales.

## Evidencia ejecutada

| Requisitos | Comprobación | Resultado |
| --- | --- | --- |
| FR01–02 | Funnel por contacto, resultados por grupo, privacidad del buzón para seller propietario sin can_send, lectura dentro de transacción READ ONLY | Pasa; marcas y permisos del lector conservados; autorización operativa evaluada para el creador |
| FR03,07 | Creación atómica de dos remitentes, audiencias disjuntas, marca distinta, permisos/MFA, alcance del lote, recibos/replay, campaña clásica creada después del backfill | Pasa; un grupo visible, rollback completo ante rechazo, CRM clásico visible |
| FR03–04 | Programar, pausar, reactivar todos los miembros; remitente sin destinatarios; reasignar y excluir con historial | Pasa; una secuencia activa y nueva cola en destino; outbox anterior cancelado e inmutable |
| FR04–05 | Incierto/admitido no movible; destino con intento anterior; error técnico sin causa resuelta; Bouncer incierto; replay sin duplicar | Pasa; ninguna cola parcial o reactivación de intenciones antiguas |
| FR07 | Route Handler real con sesión/MFA simuladas:401/403, origen externo/ausente, JSON inválido/tipo erróneo/413, rol seller, RPC ausente503 | Pasa; origen rechazado antes de consultar sesión; sin llamadas de proveedor |
| Todos | Regresión de campaigns*, manual-mail API/database/dispatcher e import-rich-text con offline.mjs | 71 pruebas,71 pasan,0 fallos; [checks-result.json](checks-result.json) |
| Todos | tsc --noEmit --incremental false; next build --webpack (Node22, env ficticio, worker pausado) | Ambos exit0; no .env real ni dependencias nuevas |
| FR07 | PostgreSQL15.19 nativo, fixtures completos de marca y migración, dos transacciones concurrentes con máximo global1 | Una reserva devuelta, una sending, tres queued sin intento/admisión. [native-result.json](native-result.json), hash del SQL final coincidente |
| FR06 | CUA sobre componentes reales + RPC/SQL real en PGlite, datos ficticios,360/768/1280px, oscuro, teclado, carga/vacío/error | Sin desbordamiento horizontal. Modal360px dentro del viewport, Tab dentro del diálogo, Escape cierra; consola final sin errores |

El ensayo nativo fuerza candidatos de cuentas diferentes mediante un adaptador local inerte del claim conservado, para competir en el bloqueo del grupo. Restaura la función original después. No equivale a un ensayo real de Auth/PostgREST/Gmail. El camino de claim original y las guardas de marca se ejercitan además en las pruebas PGlite.

UI: se observó creación/programación de23 contactos,2 remitentes con máximos30/40 y global25; pausa de ambos. En un ensayo previo del mismo flujo se observaron reasignación manteniendo11 destinatarios y confirmación de una verificación ficticia; uncertain_request permaneció bloqueado. En la ejecución final del harness se registraron create1/schedule1/pause1 y19 lecturas ([ui-result.json](ui-result.json)); no se ejecutó worker o proveedor. La inyección503 mostró métricas «—» y reintentar recuperó dos tarjetas sin alertas.

Capturas de aprobación: [overview-final.jpg](evidence/overview-final.jpg), [composer-desktop.jpg](evidence/composer-desktop.jpg), [results-desktop.jpg](evidence/results-desktop.jpg). Evidencia adicional móvil/tablet/oscuro/confirmación/error/vacío en evidence/; todas usan datos ficticios.

## Conciliación de producción, solo lectura

[catalog-preflight.json](catalog-preflight.json): doce firmas y resultados compatibles; tres fuentes idénticas en bytes y nueve diferentes únicamente en CRLF/LF (las doce coinciden al normalizar solo saltos de línea). claim_outbox instalado:md5=3e2ec04ecdd70ef745a235483f2d6232; sin dependientes catalogados. El SQL aborta CC_BASE_CHANGED si cambió esa fuente. Schema/tablas nuevos aún ausentes.

[ddl-preflight.json](ddl-preflight.json): ejecución de lectura como supabase_admin, ocho eventos DDL habituales de GraphQL/PostgREST/extensiones; ninguna colisión de los triggers propuestos. Una campaña apta para backfill; sin límites inválidos, cuenta o actores ausentes. Las lecturas usan READ ONLY, timeout y rollback; cero mutaciones remotas y cero operaciones Auth/proveedor.

## Límites y pendientes

- No se ejecutó imagen Docker local: Docker/Podman no disponibles en PATH. Build Next y PostgreSQL nativo sí ejecutados. Build/health de Coolify y sesión real contra los RPC nuevos quedan para G6.
- No se enviaron correos ni se verificaron contactos reales. La cuota y la ventana reales siguen siendo condiciones necesarias para el despacho de la campaña existente.
- Reasignación a una cuenta que ya conserva enrollment del contacto se bloquea explícitamente CC_TARGET_HISTORY. No se recicla su request_key ni su intento congelado. Una cuenta destino sin intento previo sí se admite.
- Reversa SQL conservadora: rechaza retirar el límite global si existe cualquier grupo de varios miembros. Rollback de web puede conservar SQL expandido sin borrar historia.

Revisión final del alcance y controles: [review.md](review.md). Paquete canónico: [manifest.json](manifest.json). Único siguiente gate: autorización de promoción y ejecución del runbook.
