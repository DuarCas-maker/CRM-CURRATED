# Tareas y orden — AF-PG15-r1

**Actualización PG-EXEC-r1:** PG-T03 implementado y probado offline (12/12); ver [evidencia](executor-verification.md). PG-T02 sigue sin runtime/cluster, PG-T04/05 no ejecutados. El CLI por defecto imprime plan, y ejecutar en nativo requiere manifiesto privado/aprobación local futura. La tabla posterior mantiene el estado inicial de preparación; no es el estado actual de PG-T03.

| T      | FR / AC                 | Entrega verificable                                                                                                                                    | Estado04/11/2026                                                     |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| PG-T01 | FR01–06                 | Congelar049/contrato/postflight/fuentes, aceptar el preflight recibido y preparar protocolo/entorno/casos.                                             | Preparado; documentación/hashes revisados, no ejecución.             |
| PG-T02 | FR01 / AC01/02          | Elegir paquete confiable15.x con procedencia/hash/licencia, alcance de adquisición y cluster local.                                                    | Pendiente; no runtime disponible ni descarga/arranque autorizado.    |
| PG-T03 | FR01/02/05 / AC01–04/16 | Implementar controlador psql y adaptador nativo, probar guardas offline con procesos simulados. Sin alterar migraciones o fixtures aceptados.          | Pendiente de implementación; puede prepararse sin instalar el motor. |
| PG-T04 | FR02–05 / AC03–15       | Con runtime/ejecución local habilitados, ejecutar la matriz nativa en clones; guardar códigos/recibos/postflight/preservación/contención/restauración. | Pendiente; no tests nativos ejecutados.                              |
| PG-T05 | FR05/06 / AC14–16       | Revisar evidencia, conservar artefactos y detener cluster propio; entregar verdict por gate y controles productivos restantes.                         | Pendiente; no publicación por cerrar QA aislado.                     |

PG-T02 y PG-T03 pueden prepararse por separado; no iniciar otro chat o agente para ello. Toda mutación del ensayo permanece en su cluster descartable. Ninguna tarea incluye instalar servicios del CRM, modificar Coolify/Supabase real, ejecutar proveedores, cambiar flags o repetir lecturas reales aceptadas.

Bloqueo de ejecución identificado: falta runtime15 nativo y ejecutor. Es un requisito técnico concreto, no un fallo de049 ni razón para volver a probarla en producción. No se requiere otro SQL del operador para completar esta preparación.
