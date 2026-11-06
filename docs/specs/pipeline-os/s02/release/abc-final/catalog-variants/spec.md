# AF-CVAR-r1 — funciones heredadas y representación de vistas

SDD STRICT. Continuación local de la corrección de 049; no autoriza nuevas ejecuciones remotas. El diagnóstico AF-FDIAG-r1 recibido muestra 14 diferencias, todas de huellas: 9 funciones y 5 vistas; inventario exacto, sin truncamiento, PG150008. La pausa fue confirmada por el operador y este decidió prescindir del respaldo. El intento de diagnóstico está consumido; la limpieza final permanece indicada por su protocolo, sin resultado aportado aún.

## Causa comprobada y alcance

Las nueve huellas de funciones corresponden exactamente a variantes previas que el contrato ya admite. Cuatro funciones pasan a nombres `before_brand_b2`; otras cinco conservan el nombre. La comparación final había fijado solo la fuente del fixture, omitiendo estas variantes heredadas.

Las cinco huellas de vistas coinciden exactamente con definiciones reconstruidas desde la referencia local: columnas con sus alias explícitos y, en campaign_workspace, tablas/función de esquema public explícito. No se ignoran alias, columnas ni schemas globalmente. Se conserva como evidencia cada definición sintética canónica y calificada, sus hashes y la coincidencia con los fingerprints del diagnóstico. No se presenta esta reconstrucción como ejecución nativa PG15.

## Requisitos / aceptación

| FR / AC        | Resultado                                                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CV-FR01 / AC01 | Admitir para nueve firmas finales únicamente las fuentes ya aceptadas de sus firmas previas verificadas, con linaje explícito. Conservar las otras 117 variantes y las dos variantes protegidas.                                                                                        |
| CV-FR02 / AC02 | Para cinco vistas exactas admitir solo dos hashes completos: referencia y reconstrucción que coincide con el diagnóstico. Todos los atributos distintos de viewHash siguen exactos. No normalización runtime, relajación por nombre o aceptación de hashes desconocidos.                |
| CV-FR03 / AC03 | Actualizar contrato/049/postflight/preflight/pins/manifiestos; reversión exacta a la revisión previa como prueba del delta. Preservar cuerpos DDL, ACL, contexto, locks, sending, inventarios y huella protegida.                                                                       |
| CV-FR04 / AC04 | Reproducir las nueve variantes en DB sintética y las cinco representaciones mediante observación simulada explícita; validar ambas definiciones de cada vista con el parser de la DB sintética. Rechazar cambios reales de fuentes/vistas/ACL/columnas y comprobar rollback/postflight. |
| CV-FR05 / AC05 | Mantener diagnóstico y evidencia recibidos vinculados a su revisión original. Adaptar únicamente los bindings de las pruebas históricas, sin borrar sus aserciones. Ejecutar regresión pertinente y TypeScript.                                                                         |
| CV-FR06 / AC06 | Conservar fuentes de producto, 47 migraciones, 048, 49 hashes operativos, 43 peticiones, Gmail directo activo y Composio deshabilitado. Cero APIs/SQL remoto/envíos/instalación/despliegue.                                                                                             |

## Diseño / CV-ADR01

El contrato añade `postInheritedSourceLineage`, amplía `postSourceVariants` en nueve claves y añade `postViewVariants` en cinco. Una rama exclusiva de modo post compara el resto del objeto de vista exactamente y verifica pertenencia a sus dos hashes. El fallback exacto permanece. Las nueve variantes proceden del contrato previo, no de cuerpos desconocidos ni de una normalización nueva.

Los cinco hashes nuevos se derivan de definiciones completas y luego se cotejan contra `md5(JSON.stringify(viewHash))` recibido; las huellas del diagnóstico son huellas del campo JSON, no el MD5 directo de pg_get_viewdef. Se comprueba el roundtrip de ambas definiciones al mismo deparser sintético y la identidad de columnas/dependencias expresadas en ellas. Las cinco vistas pertenecen al delta ya declarado; no se expande el alcance protegido ni se cambia su fórmula.

La revisión previa sigue reconstruible byte a byte. Los tests históricos EOL y del diagnóstico usan esa reconstrucción cuando prueban aquella revisión; la regresión de migración/preflight/ejecutor y los casos nuevos prueban la revisión vigente. El archivo diagnóstico usado remotamente no se regenera ni cambia de hash.

## Tareas / entrega / recuperación

- CV-T01: confirmar las 14 coincidencias y registrar evidencia.
- CV-T02: actualizar comparadores y bindings dentro del alcance.
- CV-T03: negativas, regresión, revisión y auditoría de preservación.
- CV-T04: nueva aplicación remota y postflight, pendientes de alcance/autorización propios; no reusar el diagnóstico consumido.

Rollback local: revertir solo los artefactos de esta revisión mediante el generador inverso verificado; sin reset/stash/clean ni rollback de producto. En producción, un fallo anterior a COMMIT conserva el aborto y exige limpiar la sesión; no se manda COMMIT para rescatarlo. La decisión del operador de prescindir de respaldo se registra, sin certificar recuperación o cerrar los demás controles de publicación. No se ejecuta nada remoto por esta corrección.
