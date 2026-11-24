# Diseño

El RPC overview conserva los mismos grupos autorizados. Un CTE MATERIALIZED obtiene facts con group_id una sola vez; otros CTE derivan métricas y pendientes por remitente. Un CTE de cuentas distintas calcula budgets una vez por cuenta autorizada. Un helper privado summary_with_context reutiliza esos agregados para producir el mismo JSON que summary.

summary(uuid) conserva su firma y contrato: prepara el contexto de un grupo y llama al helper privado. El resto de modos del RPC se conserva. El helper vuelve a comprobar access y aplica las mismas restricciones de marca y ocultación de correo/cupo del remitente. No se expone como RPC ni recibe permisos para anon/authenticated/service_role.

Decisión: materialización por solicitud, sin caché persistente ni nuevas tablas. Reemplazos CREATE OR REPLACE preservan atributos, owner y ACL; pre/postflight fijan las definiciones esperadas. Reversa restaura las dos funciones originales y elimina únicamente el helper nuevo, en transacción. No hay cambios de filas, roles o timeouts.
