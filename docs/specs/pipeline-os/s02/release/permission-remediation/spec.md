# Especificación PRM — planificación

**Autorización posterior de implementación (01/11/2026):** el usuario solicitó implementar/probar PRM1 y VR1 offline, conservando 43 Instantly y sin remoto. No nuevas ambigüedades de negocio: matriz/contratos y límites del plan confirmados. [Diseño implementado](implementation-design.md) y [42 pruebas/evidencia](implementation-verification.md) cubren FR01–06 localmente; publicación y lectura real quedan fuera. Las exclusiones de código/SQL ejecutable que siguen corresponden a la preparación anterior; la autorización actual incorpora únicamente candidato de fixture y diagnóstico READ ONLY, fuera de supabase/migrations.

Nivel STRICT por privilegios y futura migración sobre la base del CRM. Instrucción humana 01/11/2026: preparar corrección acotada/revisión de tres vistas, conservando 43 Instantly, sin aplicar migraciones, llamadas reales o despliegue. SDD y supabase-engineer aplicadas. No se implementa código en este incremento.

## Alcance y clarificaciones

Destino reportado por el operador: Supabase self-hosted del CRM, no Admin Charlom/Cloud. Fuente PD-R1 validada SHA256 `9aaaaf19fc497169b54b710866bc0af99f106ab88c73c681a69cc59ca404d430`, motor 150008/READ ONLY. La consulta ya demostró ejecución en el motor real; no se reabre el requisito de instalar PG15 para repetirla. La [CR-001 de PD](../permission-diagnostic/changes/CR-001-real-readonly-validation.md) no autoriza migraciones o pruebas de escritura reales.

No nuevas preguntas de negocio: usuario y código ya fijan preservación del flujo actual, aislamiento por marca/permisos y proveedores apagados. El alcance técnico mínimo elegido es reparar permisos excesivos de anon/authenticated en 28 relaciones; conservar derechos del servidor y DML legítimo. No inventar una necesidad de revocar funciones internas o cambiar defaults globales para cerrar este incremento.

## FR / AC

| FR       | Resultado                                                                                                                           | AC       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PRM-FR01 | Matriz finita 28 relaciones/roles/operaciones basada en migraciones y consumidores, con precondiciones y preservación del servidor. | PRM-AC01 |
| PRM-FR02 | Diseñar corrección de solo excesos observados, con límites, transacción/abortos y sin cambios de datos/RLS/owners/vistas/Storage.   | PRM-AC02 |
| PRM-FR03 | Separar 70 funciones/defaults y política de creación de futuros objetos, evitando recortes de servicio o cierres falsos de PUBLIC.  | PRM-AC03 |
| PRM-FR04 | Explicar seis dependencias por metadata y acotar VR1 a tres definiciones de vistas con evidencia sin cuerpos/datos reales.          | PRM-AC04 |
| PRM-FR05 | Definir QA local, presupuestos/autorizaciones, preservación/recuperación y siguiente paso sin cambios remotos.                      | PRM-AC05 |
| PRM-FR06 | Preservar fuentes/pruebas previas, 47 migraciones, 49 hashes operativos, HEAD/index y contadores.                                   | PRM-AC06 |

No funcionales: sin dependencias nuevas, sintaxis futura común de PG15, argumentos/identificadores en allowlist fija, errores saneados y sin retry automático. La corrección futura debe ser idempotente respecto a los privilegios excedentes y fallar ante drift de contrato; no «reparar» objetos faltantes o grants inesperados para hacerla pasar.

## Exclusiones

No SQL ejecutable ni archivo en supabase/migrations en esta preparación. No editar CLI PD-R1, pruebas/fixtures existentes, cinco SQL sandbox ABC o fuentes de S01. No defaults GLOBAL, cambio de role memberships, nuevas claves, restore/reset/stash/clean, instalación, colas o bootstrap de marcas. No declarar equivalencia SQL por una huella normalizada de manera insegura. No dar por cerrado G5/G6 al escribir este plan.

Rollout/recuperación se definen en el [diseño](design.md); no ADR nuevo de arquitectura: se conserva separación de diagnóstico, remediación y publicación. Las decisiones técnicas aquí acotan PRM1 y difieren cambios de alcance en lugar de asumir permisos adicionales.
