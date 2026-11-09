# Publicación propuesta de A/B/C — todavía sin ejecutar

Estado posterior: [050 aplicada y postflight conforme](../050-application/result-review.md). No repetir050. Pendiente publicación de las fuentes web/worker del paquete actual y smoke apagado. La imagen/archivo histórico descrito abajo no contiene estos incrementos.

Revisión MR-AUTH-r1 del [paquete actual](../mail-runtime-final/README.md): usar hashes nuevos; el candidato anterior falló antes deDDL por tipo de Auth. Sin instalación050 ni publicación; la compilación previa de código web/worker conserva su alcance, no acredita el SQL revisado en PG15 físico.

Estado vigente MR-FINAL-r1: usar el [nuevo paquete050/web-worker y su protocolo](../mail-runtime-final/README.md). El archivo histórico descrito abajo no contiene el delta.355 correctos/dos omisiones nativas, build Next Windows aislado y heartbeat paused; aún sin imagen Linux, SQL remoto o despliegue. Composio apagado e Instantly43.

Estado vigente08/11: [CW-I03/HTTP-I01](../../onboarding-http/verification.md) integra T-009 y rutas/panel de alta offline.344 correctos/dos omisiones nativas, TypeScript y QA de fixtures correctos. El archivo histórico no contiene este delta. Seguir el [runbook actual](../../onboarding-http/runbook.md): SQL final nuevo y revisión/publicación/configuración/piloto; no repetir048/049. Composio apagado, Gmail directo e Instantly43. Las notas de entregas anteriores que siguen no son su estado actual.

Continuidad08/11: [CW-I02](../../integration/connect-runtime/verification.md) incorpora motor/adaptador de alta completos T-003/T-004 y prueba su composición con dobles, sin caller/UI ni activación. T-009 sigue en F2. El próximo paquete final debe conciliar persistencia con CW/R06 antes de SQL/corte; no usar el archivo de fuentes histórico como si incluyera estas adiciones.

Actualización08/11: [R06-I03 recepción/panel](../../transport-selection/i03-verification.md) implementado offline, con manifiesto de delta propio y262 correctos/una omisión nativa. El archivo histórico de fuentes no contiene CW/R06. Conciliar alta F2/persistencia y preparar SQL final/corte antes de una versión operable. Composio bloqueado, routing false por defecto y Gmail directo conservado; no hay nueva publicación, SQL remoto ni consumo de proveedores por este incremento.

05/11/2026 · [Candidato y hashes](manifest.json), [fuentes](sources.json), [resultado local](verification.md).

**06/11/2026 — protocolo de construcción controlada preparado:** [CB-20261106-r1](controlled-build/protocol.md), con límites, vigilancia, egress, fuentes y evidencia. No ejecutado ni autorizado. El operador acredita Docker Linux en el VPS existente; la memoria disponible reportada2.4GiB no pasa el inicio propuesto3GiB. Plugin, límites efectivos, control de salida y capacidad reciente siguen pendientes. El commit local de base común50d2f91 existe para los worktrees; no es una publicación ni reemplaza el contexto sellado indicado abajo. Las afirmaciones de ausencia de commit que siguen describen la preparación original05/11.

## Qué se publica

Un mismo candidato de fuentes para **CRM web** y **curated-worker**, basado en fb9f201 y árbol de fuentes `8c9690dbe5c4421f709608f5e51062a140f42f3b62ddabd1ff586d7885ad6710`. El archivo privado `.local/abc-release-20261105/abc-web-worker-sources.tar.gz` contiene 776 archivos públicos; no contiene node_modules, env reales, .local ni .git. Es un contexto de fuentes, no una imagen construida. No hay commit nuevo todavía.

Destino conocido por el historial del operador: recursos existentes del proyecto CRM-CURRATED/production en Coolify; web https://crm.finlabinc.com y curated-worker. Base del CRM https://supabase.finlabinc.com. Esta preparación no consultó esos servicios; no afirma su estado actual o un digest nuevo.

## SQL: paso ya cerrado para este CRM

**No ejecutar 048, 049, diagnóstico ni los cinco local.sql al publicar el código.** El postflight recibido ya acredita el catálogo 049 con contrato e9b0928a… y huella protegida 6bb4165d…. Dockerfile/CMD web y Dockerfile.worker/CMD no tienen pasos de migración automática.

La carpeta histórica de migraciones permanece en 001–047 y sus fixtures no cambian. Los archivos finales 048/049 permanecen en sus paquetes de docs/specs; no se añaden a un runner automático. Una base nueva necesitaría la secuencia 001–047, 048 y 049 bajo un protocolo de instalación propio. Este candidato se prepara para el CRM existente ya comprobado, sin inventar o rellenar un historial remoto.

## Configuración que se conserva

- Web: Dockerfile, Node22-alpine, pnpm11.19.0, Next16.3.8, standalone, usuario crm y puerto3000. Build usa NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY existentes; runtime conserva su configuración actual.
- Worker: Dockerfile.worker, mismo Node/pnpm y fuentes src/worker; entrada tsx worker/index.ts y heartbeat. No se arranca el scheduler para probar el paquete.
- Ninguna variable nueva por A/B/C. Conservar APP_ORIGIN, SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_ENCRYPTION_KEY, GOOGLE_OAUTH_ORGANIZATIONS y modos Gmail ya usados por cada recurso. Revisar nombres/ubicación, sin copiar ni exponer valores.
- Gmail directo sigue seleccionado por código. Composio no tiene selector activo en esta versión; crear o confirmar una asociación no cambia el transporte. INSTANTLY_WEBHOOK_ENABLED debe permanecer ausente/false. No activar ensayos, campañas o verificaciones pagas.

## Checks previos a cualquier publicación

1. Confirmar fuentes/archivo frente al manifiesto; verificar que ningún cambio nuevo de código entró después del sellado. No usar otro checkout S01 ni archivos de configuración privados en el contexto.
2. Completar build Linux de ambos Dockerfiles y revisar imágenes/digests, standalone/server.js, static/public/pdfjs, usuario no-root y dependencia tsx del worker. No declarar apta para producción una imagen compilada con variables ficticias. El host actual carece de Docker/Linux usable y Windows no permite los symlinks del standalone.
3. Completar la inspección visual pendiente del delta: marcas/asignaciones, marca revisada y bloqueo antes de envío, asociación técnica y estados de error/solo lectura en ES/EN y 360/768/1280. La fixture está preparada localmente; el control de seguridad del navegador impidió observarla. No repetir recepción/adjuntos/importación aceptadas.
4. Revisar los controles de concurrencia/transición todavía no acreditados por el postflight: versiones web/worker frente a SQL049, admisión/revocación e intenciones sending/uncertain. La ejecución positiva PG15 del operador no sustituye contención física o restauración. Registrar explícitamente lo pendiente en la decisión de publicación.
5. Confirmar en Coolify commit/digest/estado de ambos recursos, rama y comportamiento del autodeploy/autoarranque. La pausa completa fue reportada por el operador; no se verifica de nuevo ni se cambia desde esta entrega. Un push podría arrancar ambos servicios: resolver el mecanismo de control antes de autorizarlo, sin inventar un flag de pausa.
6. Revisar el commit futuro y autorizar por separado push/main, despliegue y cualquier arranque del worker. Arrancar worker/index.ts inicia jobs y puede llamar Gmail, Bouncer u otros servicios, aunque Composio esté apagado. La restricción actual de cero llamadas reales sigue vigente. La decisión previa de prescindir de respaldo queda registrada y no se reabre aquí ni equivale a recuperación probada.

## Comandos futuros de construcción — propuestos, no ejecutados

En Linux aislado y con acceso a dependencias/configuración previamente acordado:

```sh
docker build -f Dockerfile \
  --build-arg NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY \
  -t crm-abc-web:8c9690dbe5c4 .
docker build -f Dockerfile.worker -t crm-abc-worker:8c9690dbe5c4 .
```

No hay instalación, descarga de imágenes o acceso a registros autorizados por esta preparación. No usar Redeploy del recurso productivo como un build de QA. Registrar las imágenes construidas realmente; los tags propuestos no acreditan existencia de imágenes.

## Secuencia después de superar los checks y obtener autorización

1. Mantener impedidos los despachos/mutaciones afectados y su autoarranque. Preparar el commit exacto del mismo conjunto para web y worker. No introducir otra migración en ese commit para el CRM actual.
2. Publicar los binarios del candidato revisado en el orden ensayado, con el worker aún bajo control operativo. La autorización debe indicar si permite arrancarlo y el tráfico que eso implica; no inferirlo de que el contenedor esté healthy.
3. Smoke nuevo y acotado al incremento: health/versión, Configuración con MFA (marcas/asignaciones y asociación técnica), revisión de marca de correo/campaña sin enviarlos y errores de permiso controlados. Proponer dos GET públicos (health y raíz) y revisión manual autenticada de estas pantallas; delimitar ese alcance antes de usar red. No copiar cookies ni credenciales.
4. Revisar marcas, membresías y cuentas reales con superadmin/MFA antes de autorizar nuevas operaciones. No inferirlas del dominio, de M1/M2 o de datos ficticios. Mantener legado/sending/uncertain sin reenvío o reasignación automática.
5. Conservar resultados y versiones reales; reanudar solo lo autorizado. Publicar código no activa Composio ni autoriza enviar mensajes, verificar leads o ejecutar Instantly C.

## Recuperación

No se propone un down de 049 ni volver a abrir grants. Conservar la base comprobada y controlar despachos afectados ante errores. La imagen histórica fb9f201 no se declara compatible por haber estado healthy antes: no contiene todas las guardas B2. Preferir corrección hacia adelante o una versión compatible ensayada. Ningún rollback, restart, restauración o reanudación se ejecuta por este runbook.
