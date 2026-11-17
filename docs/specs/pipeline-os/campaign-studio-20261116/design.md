# Diseño y ADR-01

Se amplía `/api/campaigns/import` con GET `mode=review` y POST `kind=retry`, reutilizando sesión, MFA, origen exacto, JSON acotado y cliente por solicitud. Dos RPC aditivas: `campaign_import_review_page(uuid,text,text,int)` y `campaign_retry_import(uuid,uuid[],int,uuid)`. Solo authenticated puede ejecutarlas; se revoca también el privilegio heredado service_role. No se modifica crm_command, worker ni funciones previas.

La lista usa el helper privado existente y la última verificación. Solo devuelve identidad básica y códigos seguros de motivo, no payloads del proveedor. Las solicitudes inciertas no son reintentables. La escritura bloquea recibo, lote y contactos ordenados; valida toda la selección y reutiliza crm_command. Cantidad distinta revierte la transacción. El recibo guarda la selección canónica para replay incluso cuando cambió el estado.

ADR-01: mantener un modo Pipeline opcional en el compositor compartido, reutilizando estado y submit; no duplicar creación/activación. La vista previa usa el renderer seguro y variables ficticias existentes. Se agrupan opciones avanzadas sin desmontar campos. Volver a revisión respeta protección de cambios. El panel de contactos conserva el formulario abierto y consulta solo su lote.

Riesgos: reintentar consume créditos cuando el worker procesa la cola; confirmación obligatoria. Estado concurrente: bloqueo y revalidación. Backend aún no instalado: 503 cerrado, sin fallback global. Cambios ajenos en main: conciliar antes de promover. Sin dependencias nuevas.
