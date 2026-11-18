# Cierre de adjuntos y cupo Composio

SDD STRICT. Autorización del usuario: resolver el fallo de adjuntos y verificar el cupo gratuito para preparar publicación. Implementación/pruebas locales y lecturas administrativas; sin despliegue, migraciones/configuración remota, compras, consentimiento, herramientas de proveedor ni mensajes. Continúan FR/AC-005,006,009,011 y T-008–010 del alcance simple-mail.

## Diagnóstico y diseño

Síntoma reproducido el 17/11 hora Colombia: `tests/gmail-attachments.test.ts:235`, esperado 3, obtenido 4; 2/3 pruebas del archivo pasan antes del arreglo. Evidencia: `attachments-before.txt`.

H1: fixture con seller como responsable actual y expectativa anterior a 055. A favor: `055_case_flow.sql` define `can_manage_case_flow` por `coalesce(closer_id,seller_id)`, y `can_area(...,'closer')` usa ese permiso. La spec vigente `docs/specs/case-flow-20261116/spec.md` FR-02/AC-02 autoriza continuar sin traspaso al responsable actual. Se confirmará con aserciones de los permisos efectivos en la fixture.

H2: ampliación accidental por RLS compartida de 021. La RPC de listado es SECURITY DEFINER y filtra explícitamente por `can_area`; no basta esa política para explicar el resultado.

H3: filtro de inline incorrecto. La llamada usa `show_inline=true`; los cuatro índices corresponden a archivos de la fixture, y solo el cuarto está en área closer. No explica el permiso del responsable actual.

No se modificará SQL ni permisos productivos para restaurar una restricción obsoleta. La corrección mínima debe ajustar la fixture a la semántica actual y ampliar su cobertura, conservando la prohibición sobre adjuntos ajenos y la selección explícita antes de copiar.

## Requisitos y aceptación del cierre

| ID           | Criterio comprobable                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATT-AC01     | Seller responsable, sin closer asignado, puede listar los cuatro adjuntos y tiene acceso efectivo al área closer según 055.                                                                              |
| ATT-AC02     | Al asignar un closer, el seller conserva solo los tres adjuntos de su área y pierde edición; no puede seleccionar ni un archivo closer ni otro archivo del expediente. El closer asignado ve los cuatro. |
| ATT-AC03     | Usuario ajeno no puede listar ni seleccionar; selección vacía, copia explícita, dedupe, reintento y preservación de copias existentes siguen comprobados.                                                |
| QUOTA-AC01   | Distinguir límites publicados, plan real, periodo/consumo aplicables y tope sin cargos. No declarar remanente por inferencia de otro medidor ni escribir saldo positivo sin evidencia.                   |
| RELEASE-AC01 | Regresión relevante en verde, checks de compilación y manifest actualizado. La imposibilidad de acreditar un medidor debe quedar explícita y mantener Composio cerrado.                                  |

## Tareas

- U01: reproducción e hipótesis con permisos efectivos.
- U02: prueba de compatibilidad con propiedad antes/después de asignar closer, sin cambiar políticas.
- U03: revisar panel autenticado y documentación/API administrativa disponible de Composio; registrar hechos y límites de evidencia.
- U04: pruebas focalizadas/regresión, revisión del diff y paquete actualizado con hashes de los archivos autorizados adicionales.

## Resultado

H1 confirmada: antes del arreglo, las aserciones de `can_manage_case_flow` y `can_area(...,'closer')` devolvieron true/true y la expectativa antigua volvió a fallar (evidencia `attachments-diagnosis.txt`). U01/U02 completadas: se corrigió la prueba y se añadieron checks de responsable actual, pérdida de propiedad, closer asignado y ajeno. Una primera extensión de la fixture violó el CHECK closer/handed_off_at; se corrigió únicamente la fixture estableciendo/restaurando ambos campos. Seis pruebas de adjuntos y Case Flow pasan sobre 544b835.

La regresión sobre b861486 cerró con 537 correctas, cero fallos y seis omitidas, más typegen/TypeScript/build correctos. La evidencia final sobre 544b835 figura en `promotion-manifest.json`; no se atribuye a esa base el conteo anterior. Nuevo catálogo: 458 funciones, contratos seleccionados 16/16 correctos, dos lecturas SQL nuevas y ninguna mutación.

U03: Hobby confirmado, tarifa publicada de 1000 proxies/mes y tres ejecuciones proxy del proyecto observadas en noviembre. El panel no expone saldo global/reset del medidor. No se acredita un remanente de 997, no se siembra presupuesto, no se realiza ninguna ejecución para averiguarlo. Consulta concreta al proveedor preparada, no enviada. FR-009 conserva su cierre por defecto.

U04: revisión de cambios y package reproducible en `finalize-candidate.mjs`, con conteos TAP y hashes actuales, sin regenerar observaciones históricas. En 544b835, 85 archivos de regresión: 539 correctos, cero fallos, seis omitidos; typegen/TypeScript/build correctos. Resultado y límites en `closure.md`. Reversa del arreglo: restaurar únicamente esta prueba/documentación, sin cambios de datos ni políticas.
