# S02-ADR-001 — Fachada estable y selección operativa diferida

31/10/2026 · Estado: **adoptada en la implementación local de S02-I01 autorizada por el usuario**. No es permiso de corte, llamadas reales o publicación. [Diseño](design.md).

## Decisión propuesta

Conservar `gmail` como fachada de los consumidores y extraer HTTP directo detrás de un contrato compatible. Añadir proxy Composio con fetch/binding inyectados, sin selección operativa desde producto en I01. Identidad, cuotas, cola, permisos y callback final siguen siendo responsabilidad del sistema actual y de los contratos S01 que se integren después.

Motivo: envío, recepción y adjuntos ya funcionan. Sustituirlos por un stack de tools nuevo o importar un ejecutor S00 duplicaría reglas y perdería la frontera de despacho que hoy usa recheck_outbox_delivery. Una implementación local del adaptador puede avanzar mientras se prepara la integración S01; activar cuentas no puede saltar esos permisos y asociaciones.

| Alternativa | Resultado |
|---|---|
| Fachada compatible + adaptadores + directo fijo en I01 | Propuesta: menor cambio, límites revisables, sin datos nuevos o activación. |
| Cambiar todas las cuentas mediante una variable global | Descartada: no verifica identidad/marca por cuenta y dificulta un escritor único/rollback seguro. |
| Reemplazar correo/adjuntos por tools Composio independientes | Descartada: rehace comportamiento aceptado, añade contratos no demostrados y duplica reconciliación. |
| Copiar scripts S00 a producto y usar su journal como mapeo | Descartada: sus alias, presupuestos y estados de ensayo no son la configuración durable del CRM. |
| Esperar todo S01 antes de preparar el transporte puro | No necesaria para I01; sí se exige completar sus dependencias antes de habilitación operativa. |

## Consecuencias y revisión

Habrá una fase con adaptador Composio probado solo por inyección y sin cuenta productiva que lo seleccione. Es una frontera de incremento explícita, no una integración operativa declarada terminada. Proyecto de cuota, propietario Composio, identidad física, estado y revisión de binding se resolverán antes del cambio real por cuenta. El adaptador no obtiene autoridad por recibir una API key.

La extracción no preserva como requisito la ampliación de área de021 detectada por S01-I02. Su corrección es otro paquete ya desarrollado localmente y pendiente de integración; no se revierte para mantener una prueba antigua. Cambios de propiedad S01 y migraciones finales requieren coordinación explícita.

Rollback de I01 no necesita SQL ni reautorizar cuentas. Si se propone seleccionar Composio en producto dentro de I01, revisar este ADR/spec y la dependencia S01 antes del código. No promover una opción técnica a decisión humana aprobada por silencio.
