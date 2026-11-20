# Verificación

## Antes del arreglo

- Reproducción en el navegador de Codex: descarga y preview fallan con el mismo mensaje genérico; contexto del expediente correcto.
- `node --experimental-test-module-mocks --import ./tests/offline.mjs --import tsx --test tests/document-attachment-download.test.ts`: dos escenarios rojos (descarga/preview500), acceso revocado correcto y llamada sin contexto denegada. El test padre también falla por sus dos hijos.
- No se guardaron/aprobaron documentos ni se enviaron archivos a OpenAI. Ninguna mutación remota, push o publicación de este incremento.

## Cierre

Corrección local completada. Descarga y revisión comparten `documentBytes`; la lectura humana del adjunto directo obtiene un contexto ligado a su origen RLS, y se vuelve a comprobar antes de emitir. Las llamadas sin contexto siguen denegadas. El límite de tamaño conocido se comprueba antes de consultar Gmail.

- **27/27 pruebas correctas**, cero fallos/omisiones, en nueve archivos. Comando: `node --experimental-test-module-mocks --import ./tests/offline.mjs --import ./tests/simple-mail-register.mjs --import tsx --test --test-concurrency=2 tests/document-attachment-download.test.ts tests/document-review.test.ts tests/document-intake.test.ts tests/bank-document-management.test.ts tests/gmail-attachments.test.ts tests/gmail-thread-attachments.test.ts tests/document-package-delivery.test.ts tests/legacy-worker-mail.test.ts tests/pipeline-os-s01-mail-permissions-api.test.ts`.
- El nuevo test incluye descarga, hash/MIME del preview, origen legacy, bytes inline/Storage, revocación durante preparación, cambio de buzón, tamaños declarados excesivos y rechazo sin contexto. Usa rutas y fachada Gmail reales con DB/SDK/red ficticios.
- TypeScript `tsc --noEmit --incremental false` correcto. `git diff --check` correcto. Formato de fuentes/test/documentación comprobado.
- Build Next16.3.8/webpack aislado correcto (`scripts/lender-composer-build-qa.cjs` reutilizado): Node24.22.1 del host, variables sintéticas, sin env reales y fetch externo bloqueado. No se atribuye un build Linux/Docker o despliegue a este resultado.
- Navegador **Codex**, fixture local con PDF válido creado mediante pdf-lib y componente DocumentReview real: canvas renderizado840×1120, descarga PDF del navegador completada, una solicitud automática de clasificación y cero guardados/aprobaciones. La respuesta de clasificación de esta prueba visual está **simulada**; los tests de clasificación existentes verifican por separado la petición/bytes y el tipo retornado mediante proveedor falso.
- Evidencia local ficticia: `.local/document-recovery-qa/review-preview.jpg`, `browser-verification.json` y `build/next-build.json` del coordinador. No contienen documentos de clientes.
- Revisión con safe-code-review: contratos HTTP y prompts existentes conservados, lectura GET exacta, fuente/cuenta revalidadas, sin fallback adicional ni cambios al worker, cuotas, SQL, claves, manifiestos o lockfile. RLS precede credenciales; los errores no generan bytes parciales.

## Archivos de producto

- `src/lib/server/authorized-gmail-attachment.ts`: lectura exacta con el contexto humano autorizado y el control de cuotas existente.
- `src/lib/server/gmail-attachment-preview.ts`: revalidación del snapshot visible antes de consultar el adjunto.
- `src/lib/server/document-review.ts`: revalidación de origen saved/legacy, control de tamaño y uso del lector autorizado.
- `src/app/api/gmail/files/[id]/route.ts`: usa la misma lectura binaria que preview y clasificación.
- `tests/document-attachment-download.test.ts`: regresión HTTP/Gmail y casos negativos.

## Pendiente de producción

**No publicado.** Se requiere autorización específica para promover este incremento. La reproducción real confirma el síntoma, pero la corrección solo se ha ejecutado con datos ficticios. Después de publicar: verificar descarga/preview del archivo autorizado y su sugerencia con la integración OpenAI ya existente, sin guardar o aprobar por el usuario. El rollback está descrito en design.md. El incremento del tamaño del chat ya publicado se conserva en la base4cbe7e8.
