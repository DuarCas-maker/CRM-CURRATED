# PRM-20261101 — permisos acotados y tres vistas

**SQL final preparado (01/11/2026):** [paquete PRM-FINAL-r1 / 048](final/README.md), [protocolo](final/protocol.md), [16 pruebas/evidencia](final/verification.md). 28 objetivos DCL, 39 relaciones bloqueables y postflight READ ONLY. Reserva 048 solo local, fuera de autodiscovery; 001–047 intactas. Antes de autorizar aplicación faltan controles de respaldo/ventana/frescura/contención independiente y exclusión DDL/DCL. No aplicación o deploy; Instantly 43.

**Resultado VR1 vigente (01/11/2026):** [las tres vistas quedaron aclaradas](vr1-result-review.md). Una ejecución READ ONLY reportada por el operador en PG15.8; 0 ejecuciones del agente/reintentos. Metadata y hashes exactos coinciden al cualificar únicamente las posiciones sintéticas de origen conocidas; referencia/SQL/lexer/comparador originales intactos. No se recrearon vistas ni aplicaron permisos. Próximo paso PRM-T06: preparar SQL correctivo final y protocolo; Instantly 43/0 nuevas. Las constancias anteriores conservan su fecha.

**Implementación vigente (01/11/2026):** PRM-T03/04 completadas offline: **42/42 nuevas y TypeScript correctos**. [Evidencia](implementation-verification.md), [uso/orden siguiente](offline-runbook.md), [diseño](implementation-design.md), [manifiesto](implementation-manifest.json). Candidato local protegido y VR1 de lectura implementados; las tres vistas reales siguen pendientes de comparar. No migración final, SQL remoto, push/deploy o activación. Instantly 43/0 nuevas. El texto de preparación siguiente conserva su alcance histórico; ya no hay que pedir implementar otra vez.

01/11/2026 · SDD STRICT · **Preparado; sin SQL correctivo ejecutable, migración final o llamada remota.** [Requisitos](spec.md), [diseño](design.md), [aceptación](acceptance.md), [tareas](tasks.md), [evidencia](verification.md), [matriz por objeto](permissions-matrix.json), [inventario de funciones](function-inventory.json), [revisión de vistas](view-review.json).

## Corrección propuesta PRM1

Restablecer únicamente los permisos previstos de `anon` y `authenticated` en 28 relaciones públicas. La referencia es 001–047/fb9f201, contrastada con PD-R1 aportado por el operador. La matriz declara 28 objetivos concretos; **no permite revocar en todas las tablas de public**.

| Rol / grupo                                                     | Objetivo de PRM1                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| anon                                                            | Sin acceso directo en las 28 relaciones. Revocar solo privilegios excedentes actuales.                                |
| authenticated, 23 relaciones                                    | Conservar SELECT y retirar únicamente los extras. RLS continúa filtrando filas.                                       |
| authenticated, mail_drafts y mail_recipient_selections          | Conservar SELECT/INSERT/UPDATE/DELETE: las rutas actuales guardan borradores y selecciones con la sesión del usuario. |
| authenticated, gmail_api_slots/gmail_api_usage/gmail_sent_usage | Sin acceso directo; mantener los contratos de RPC/servidor existentes.                                                |
| service_role/owners/roles de plataforma                         | Ningún cambio en PRM1. El worker y las rutas de servidor conservan derechos.                                          |

No modificar RLS, políticas, definiciones de vistas, datos, grants de columna, owners, membresías, callbacks Google, credenciales, Storage o las 70 funciones con EXECUTE de servicio adicional. Si el preflight muestra PUBLIC/herencia/grants de columna inesperados, faltan derechos legítimos o cambia el alcance, detenerse; no ampliar la corrección automáticamente.

La reducción de permisos existentes se puede preparar/probar independientemente de cambiar definiciones de vistas. La publicación A/B/C seguirá bloqueada mientras queden diferencias relevantes sin revisar. PRM1 no requiere código web/worker nuevo ni activa proveedores, pero cualquier aplicación real requerirá SQL exacto y autorización posterior.

## Defaults y funciones: tratamiento separado

Los defaults de supabase_admin/public explican un mecanismo actual compatible con los grants; no reconstruyen historia. PRM1 no los cambia. Se prepara una política de creación segura para las migraciones finales A/B/C: permisos explícitos por objeto/función dentro de la misma transacción, con revocaciones PUBLIC/anon/authenticated según contrato y grants legítimos específicos antes del COMMIT.

Un cambio posterior de defaults de relaciones/secuencias para ese creador/esquema se valorará solo tras comprobar todos los creadores y el contrato de objetos futuros. Para funciones, retirar grants por esquema **no elimina por sí solo EXECUTE de PUBLIC que provenga del default global/builtin**. No se propone un cambio GLOBAL del propietario para arreglar solo public, ni se declara el problema futuro resuelto con un REVOKE de esquema. [Detalles y límites](design.md).

Las 70 diferencias de EXECUTE solo afectan a service_role; se conservan mientras se revisan sus consumidores/llamadas indirectas. El inventario distingue evidencia literal de ausencia de evidencia. No interpretar una función sin `.rpc("nombre")` como innecesaria.

## Vistas: qué quedó aclarado

Sin hacer otra consulta, las seis dependencias adicionales de PD-R1 coincidieron exactamente con `md5('relation:' + vista + ':0')`: referencias de cada vista a su propia relación. Se explican esas seis entradas como metadata de dependencia; **no prueban equivalencia de la definición de las vistas**.

Siguen abiertas únicamente las huellas de:

- `public.campaign_workspace`: definición de producción esperada en 043, anterior al cambio B2 todavía local.
- `public.opportunity_inbox`: definición vigente de 024, que exige conversación activada.
- `public.opportunity_tasks`: definición de 007, que exige una tarea abierta.

El contrato de la futura lectura VR1 pide hashes sin pretty-print, huellas léxicas conservadoras con cobertura completa, columnas/opciones y dependencias para esas tres vistas; nunca SQL real completo o filas de clientes. Si la huella conserva diferencias de tokens, no se aprueba por intuición ni se reemplaza la vista. [Protocolo VR1](design.md).

## Orden y presupuesto

1. Implementar PRM1 como candidato local marcado y VR1 como consulta de lectura, con fixtures nuevos; sin número de migración definitivo.
2. Probar permisos de usuario/servidor y negativos con datos ficticios en el motor local disponible. No repetir pilotos aceptados ni probar escrituras de corrección en producción por la excepción READ ONLY de PD.
3. Presentar VR1/hash exactos para autorización de **una ejecución de lectura** del operador. Cero reintentos automáticos. Revisar el resultado y frescura del preflight, sin modificación.
4. Tras QA y cierre de alcance, materializar migración numerada coordinada, su preservación/ventana y autorización de SQL. No reaplicar 046/047. La aplicación de PRM1 no autoriza publicar A/B/C.
5. Si se autoriza/aplica la corrección, proponer **una lectura postflight** de las 28 relaciones y estado protegido. Ese permiso no existe hoy.

**Ahora 0 remoto. Propuesta posterior: 1 lectura VR1 antes de la corrección; 1 script correctivo y 1 lectura postflight con permisos separados.** No son peticiones HTTP estimadas del panel. Instantly 43/0 nuevas y Composio 0 peticiones; sin envíos, verificaciones pagas, instalación o despliegue. No se reutilizan permisos de PD-R1 ya consumidos.

Siguiente paso: implementar/probar PRM1 y VR1 offline dentro de esta ventana definida, cuando lo indique el usuario. Hoy solo se entrega el plan revisable. No tienes que ejecutar una migración o instalar otro motor por esta preparación.
