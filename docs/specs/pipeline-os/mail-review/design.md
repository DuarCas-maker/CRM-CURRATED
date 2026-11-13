# Diseño

## Arquitectura y contratos

Se añade revisión dentro del panel del expediente; Conversaciones conserva su asociación manual de Pendientes. GET `/api/pipeline-os/mail-review?case_id=&before=` devuelve contexto autorizado, 20 mensajes entrantes y cursor; no descarga Gmail. POST usa origen/sesión/MFA, cuerpo limitado y Zod: operaciones analyze (message_id/process_id/submission_id/request_key/retry/revision) y approve (review_id/revision/request_key/value). 400 validación, 401 sesión, 403 autorización, 409 estado/contexto, 503 migración/config ausentes. Respuestas sin caché ni texto privado en logs.

## Datos y consistencia

Migración aditiva 053 (050–052 reservadas por otros incrementos): `pipeline_mail_reviews` mantiene mensaje, expediente, proceso, evaluación, huella del cuerpo/contexto, revisión, intento, propuesta, corrección humana y IDs resultantes. `pipeline_mail_requirements` conserva el requisito individual y su fuente; `submissions.next_action` refleja la próxima acción. No copia archivos ni modifica tablas históricas. RLS y funciones definer con search_path vacío; solo RPC autenticadas cambian estado, finalización IA solo servidor.

Como los paquetes coordinados 048–052, la 053 y su reversa se conservan en `mail-review/migrations/` y se aplican explícitamente en tests. La base histórica 001–047 y sus catálogos/hash permanecen intactos. La primera ejecución completa detectó que añadir 053 al directorio histórico cambiaba el inventario de esos paquetes; se corrigió la ubicación, sin aceptar nuevos hashes, cambiar conteos esperados o desactivar comprobaciones. El adaptador del test del catálogo ahora conserva el código PostgreSQL real para probar ausencia de contrato como lo hace PostgREST.

Una fila por mensaje evita análisis simultáneos. Begin devuelve fresh=false para el mismo intento; reintentar un fallo requiere acción humana y revisión vigente. Finish compara intento. Approve bloquea revisión y valida mensaje/contexto, proceso/evaluación y responsable de nuevo; todas las escrituras y recibo son atómicas. Aprobación repetida con idéntica solicitud devuelve IDs originales; distinta solicitud no reescribe lo aprobado. Se conserva propuesta original y aprobación corregida. No se altera el estado del proceso ni se interpreta una oferta como aceptada.

Reanalizar una propuesta lista también requiere acción explícita y revisión vigente. `pipeline_mail_review_attempts` conserva el snapshot del intento reemplazado y el actor, con RLS heredada de la revisión. Permite recuperarse de una fuente o asociación corregida dentro del mismo expediente, sin sobrescribir evidencia ni repetir IA por actualización. Una revisión aprobada no se reinicia; resultados tardíos de un intento anterior no pueden finalizar el nuevo.

Si el hilo ya tiene expediente pero falta proceso/evaluación, la elección explícita se conserva en la revisión y solo se aplica a la conversación al aprobar. Se respeta cualquier asociación previa no nula y el vínculo histórico de Gmail; las contradicciones requieren corregirlas en Conversaciones. El recibo ya aprobado puede releerse con la misma solicitud sin repetir efectos, después de comprobar otra vez autorización/contexto.

## IA y seguridad

Proveedor Responses existente, modelo de underwriting_settings y clave A_OPENAI_API_KEY autorizados para reutilización. Contabilidad application_extraction existente; revisión identifica propósito mail-review/v1 (no se inventa servicio de contabilidad ni una nueva clave). Timeout acotado, store:false, salida JSON estricta, sin reintentos automáticos. Input limitado al texto legible del mensaje, tratado como datos no confiables; no se cargan adjuntos, URLs ni herramientas por instrucciones del correo. Evidencia literal se valida contra texto enviado; valores inexistentes quedan para edición. IA nunca ejecuta comandos. El usuario puede corregir la propuesta; la fuente y el actor quedan auditados.

## Updates, compatibilidad y calidad

Pipeline OS mezcla acontecimientos aprobados con su resumen actual, sin duplicar el mismo expediente por mera modificación causada por aprobación; cada evento tiene clave propia, fecha y fuente. Cambios a tipos y catálogo son aditivos. Lectura del nuevo contrato ausente se presenta como función pendiente de instalar, sin fallback a service_role/demo. UI reutiliza estilos y formularios protegidos; errores no pierden la corrección ni repiten aprobación. Presupuestos: 20 mensajes por página, texto máximo 40.000 caracteres por análisis y 4.000 tokens de salida. Operaciones históricas no cambian.

## Riesgos y pruebas

Riesgos: proveedor incierto, concurrencia, asociación cambiada, edición obsoleta y exposición closer → tests de estado/idempotencia/huella/RLS y proveedor falso. PGlite prueba transacción y políticas, no certifica contención de PG15 nativo. QA visual 360/768/1280 y teclado con datos ficticios. Rollout y reversa en rollout.md. MR01–08 trazados a tareas y verificación.
