# Manifiesto del candidato local

Base a881100 · rama codex/lender-composer-20261116 · STRICT · sin push/merge/publicación.

## Producto

- `src/components/mail-editor.tsx`: modal amplio, biblioteca, preview por lender y revisión final antes de confirmar.
- `src/components/mail-composer.css`: diseño responsive del editor y biblioteca, estados y foco visible.
- `src/components/mail-lender-recipients.tsx`: catálogo completo, contador sin 20, errores y tarjetas desplegables.
- `src/components/lender-mail-preview.tsx`: To/CC/asunto/cuerpo/firma y campos faltantes por destinatario.
- `src/components/lender-templates.tsx`: selector, biblioteca, creación/edición/archivo y refresco del borrador.
- `src/components/pipeline-os/workspace.tsx`: acceso Plantillas en navegación y tarjetas de inicio.
- `src/components/campaign-editor.tsx`: reutilización del editor con props aditivas y etiqueta accesible.
- `src/components/ui.tsx`: clase opcional de modal, sin ampliar los demás diálogos.
- `src/lib/lender-templates.ts`: contrato de plantillas, variables del expediente y renderer seguro compartido.
- `src/lib/mail-manager.ts`: targets sin límite fijo de 20, formato y digest revisado, validación de bytes/duplicados.
- `src/lib/mail-recipient-selections.ts`: selección personal acotada por bytes y validación de contactos.
- `src/lib/server/lender-preview.ts`: resolver registros autorizados actuales y calcular digest.
- `src/lib/server/mail-manager.ts`: comprobar digest y encolar el contenido personalizado revisado.
- `src/app/api/mail/lender-preview/route.ts`: preview de solo lectura, origen/sesión/MFA y respuestas privadas.
- `src/app/api/mail/templates/route.ts`: biblioteca/versiones y escritura administrativa con CAS.
- `supabase/migrations/056_lender_composer.sql`: tablas/RLS/RPC/versiones y ampliación conservadora de la cola instalada.

## Validación y operación local

- `tests/lender-composer.test.ts`: catálogo, plantillas, variables, seguridad de formato y MIME.
- `tests/lender-composer-server.test.ts`: digest y contratos del servidor.
- `tests/lender-composer-db.test.ts`: lote 73, atomicidad/idempotencia, permisos, versiones y reversa.
- `tests/lender-composer-pg15.test.ts`: instalación sobre 049/055, concurrencia real y rollback.
- `tests/mail-recipient-selections.test.ts`: actualizar expectativa anterior de 20 y representación de tarjetas.
- `scripts/lender-composer-qa.cjs`: runner reproducible offline con dependencias existentes.
- `scripts/lender-composer-browser-qa.cjs`: componentes reales con HTTP/acciones ficticios, loopback solamente.
- `scripts/lender-composer-build-qa.cjs`: build con configuración sintética y fetch externo bloqueado.
- `docs/specs/lender-composer-20261116/**`: requisitos, ADR/diseño, tareas, aceptación, rollout, reversa y evidencia no sensible.

## Resultado y siguiente paso

[Verificación completa](verification.md): 62 pruebas únicas aprobadas, build/typecheck, revisión visual y capturas. FR-001–FR-007 cubiertos localmente. No hay datos reales importados ni correos reales enviados por esta tarea.

Antes de activar en Curated: revisar integración y número 056 contra la base compartida, obtener autorización específica, aplicar migración con backup y publicar el candidato. La verificación productiva deberá ser read-only, sin importar clientes ni enviar mensajes. [Rollout/rollback](rollout.md).
