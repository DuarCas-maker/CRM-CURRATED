# Recuperar descarga y revisión de adjuntos

Modo implementación; nivel STRICT por lectura de documentos sensibles. Base `4cbe7e8`, checkout aislado `codex/document-recovery-20261119`; el WIP del coordinador se conserva.

## Requisitos y clarificación

La solicitud confirma restaurar el flujo existente del CRM dentro de Pipeline OS: descargar, abrir vista previa e identificar automáticamente el tipo con la integración OpenAI actual. No solicita nuevas credenciales, permisos, aprobación automática, migraciones ni publicación de este incremento. Las decisiones de clasificación y confirmación humana se conservan del código existente; no hay una decisión nueva de producto pendiente para esta reparación.

- FR-001 / AC-001: descargar un adjunto referenciado autorizado entrega sus bytes originales y `no-store`, con la política de cuotas activada.
- FR-002 / AC-002: la revisión obtiene los mismos bytes, MIME seguro y hash; el flujo existente puede iniciar su sugerencia automática al recibir ese hash.
- FR-003 / AC-003: acceso revocado, origen modificado o cuenta distinta se rechazan antes de una petición externa. Una llamada Gmail sin contexto continúa denegada.
- FR-004 / AC-004: archivos ya almacenados no consultan Gmail; se conservan fuentes saved/legacy, límites de tamaño y proveedores configurados.
- FR-005 / AC-005: no cambiar prompts, claves, modelos, envío de correos, SQL, datos reales ni aprobación humana. Las pruebas usan datos ficticios y proveedor simulado.

## Evidencia inicial y causa

El navegador de Codex reproduce el error genérico al descargar y en la revisión. El contexto del expediente sí carga. El buzón afectado está conectado y no tiene asociación Composio; la ruta administrativa de selección informa `R06_NOT_READY` porque el ruteo global está apagado.

La regresión offline usa las rutas reales y la fachada Gmail real, con DB/SDK/red ficticios y política activa. Descarga y preview devuelven 500 antes del arreglo; la llamada sin contexto se rechaza con `QGR_DENIED`, antes de credenciales/red. La protección nueva del worker no ofrece a estas lecturas humanas el contexto de origen que ya verificaron por RLS.

La clasificación automática ya existe en `DocumentIntake` y requiere el hash de una vista previa obtenida correctamente; no es la causa del fallo inicial. No se ha hecho una llamada real a OpenAI ni exportado documentos reales.
