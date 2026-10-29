# Pipeline OS: coordinación de dos chats

28/10/2026. SDD STRICT por aislamiento de trabajo existente, credenciales y límites externos. El usuario eligió S01 en un segundo chat/worktree y autorizó preparar una base común conservando los cambios actuales. No autoriza producción, nuevas llamadas a proveedores, push, merge o migraciones remotas durante esta preparación.

## Objetivo, alcance y aceptación

| FR     | Requisito                                                            | Aceptación                                                                                                                                                            |
| ------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-FR01 | Conservar la versión actual de archivos modificados/no versionados.  | Comparación de hashes con inventario previo; solo AGENTS y documentación de coordinación cambian intencionalmente. Base local WIP, sin reescribir commits existentes. |
| P-FR02 | Ambos frentes parten de una base reproducible y S01 trabaja aislado. | Commit común local, checkout S01 con el mismo contenido de base y directorio diferente; sus ediciones no aparecen en S00.                                             |
| P-FR03 | Excluir credenciales, registros privados y archivos generados.       | Git ignora .env reales/.local/node_modules/.next; comprobar ausencia en worktree y no copiar su contenido.                                                            |
| P-FR04 | Evitar propiedad simultánea de archivos, migraciones o contratos.    | Matriz de propiedad y AGENTS leídos por el segundo chat; docs raíz y aplicación compartida permanecen a cargo del coordinador.                                        |
| P-FR05 | No convertir esta preparación en operaciones externas o release.     | 0 APIs/envíos/cambios remotos, Instantly18 intacto, ningún push/merge/deploy.                                                                                         |
| P-FR06 | Entregar dos chats utilizables y evidencia de separación.            | Segundo chat creado en proyecto correcto/worktree, tarea inicial acotada y estado consultado; comunicar identidad/directorio/resultados sin inventar finalización.    |

Clarificación cerrada:1→A, abrir S01 con worktree aislado, preservar cambios y repartir tareas; planificación inicial del segundo chat centrada en T01-01, no implementación funcional o mutaciones externas. Datos/negocio posteriores se aclaran en S01 solo donde no resuelvan D01–D24 o el código.

## Base común y decisión P-ADR01

El checkout actual contiene9 archivos tracked modificados y trabajo sin versionar (S00, pruebas y cambios previos de señales de oportunidades). No se atribuye todo al incremento actual ni se descarta el trabajo previo. Inventario inicial:479 archivos versionables;453 archivos de texto revisados con patrones de claves privadas/tokens/JWT sin coincidencias; no hay archivos .env reales/claves privadas en la selección, ni cambios staged previos o hooks Git instalados. Esa revisión no constituye una auditoría completa de seguridad del producto.

Se crea un **commit local de base WIP** con el estado completo actual y estas instrucciones, sin push ni etiqueta de release. Permite que el worktree tenga una referencia común comprobable sin depender de archivos sin versionar o copiar secretos. El inventario de hashes/estado original queda privado e ignorado; no se registra contenido de env o registros de clientes. El commit que incorpora este documento es la base inicial de coordinación, identificada al crear el segundo chat. No certificar todo el producto como terminado por capturar la base.

No se comparten node_modules, .next, env privados o contadores mediante copia manual. Si faltan runtimes/dependencias en S01, el chat lo identifica y utiliza mecanismos locales del proyecto sin iniciar servicios o pruebas externas. Durante discovery/contratos no necesita credenciales.

## Propiedad y orden de tareas

| Frente                               | Tareas                                                                                                                                                                                               | Archivos propios                                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinador / S00, chat actual       | Diagnóstico Instantly autorizado pero aún no ejecutado; completar contratos/pruebas pendientes S00 y coordinar dependencias.                                                                         | `scripts/pipeline-os/**`, tests/fixtures S00 existentes, `docs/specs/pipeline-os/s00/**` y documentación raíz de Pipeline OS. Los registros privados permanecen solo aquí.                                    |
| S01, segundo chat                    | Empezar T01-01: fuentes de verdad lead/contacto/empresa/proceso/marca/etapa; distinguir etapas de vistas solapables y conservar estados actuales. Proponer contrato de identidad/elegibilidad/bajas. | Durante preparación: `docs/specs/pipeline-os/s01/**` con discovery, spec, design, tasks, acceptance y verification.                                                                                           |
| S01, incrementos posteriores         | T01-02 marcas/RLS; T01-03 correo opcional/elegibilidad por canal; T01-04 bajas de grupo. Respetar dependencias T00-02/T01-01 y confirmar cambios funcionales antes del código.                       | Reservados: nuevos `src/lib/pipeline-os/s01/**`, `tests/pipeline-os-s01*.test.ts`; SQL preliminar en `docs/specs/pipeline-os/s01/migrations/**`. La reserva no es permiso para implementar esas tareas ahora. |
| Compartidos, responsable coordinador | Transferencia de propiedad por paquete revisado y secuencial; no ediciones simultáneas.                                                                                                              | `src/lib/domain.ts`, imports/preparación, `src/lib/server/**`, `src/app/**`, `worker/**`, componentes, tests/helpers actuales, `supabase/migrations/**`, package/lockfile/configuración y AGENTS raíz.        |

La numeración y aplicación de migraciones finales tienen un único coordinador. S01 puede diseñar SQL aditivo y pruebas PGlite desechables, sin conectarse al Supabase real. Los contratos aprobados de S01 preparan S02/S03; no saltar esas dependencias ni cerrar un sprint por documentación. La viabilidad pendiente de Instantly/SMS no bloquea T01-01; tampoco se presume cerrado T00-02 para cambios dependientes.

## Protocolo de integración y rollback

1. Cada chat registra su avance en sus documentos propios. S01 trata esta base y los documentos raíz como lectura; el coordinador consolida después el estado general.
2. Si una tarea necesita un archivo compartido, describir el cambio y su dependencia en S01 antes de editar; el coordinador asigna propietario y ventana de integración. No ocultar conflictos mediante reset/stash/clean.
3. Revisar commits/diffs del frente S01 contra el commit común; distinguir sus cambios de la base WIP. Ejecutar checks locales pertinentes antes de integrar. Push/merge/deploy mantienen sus requisitos de autorización.
4. Ningún chat reinicia contadores o repite operaciones de proveedor. Los permisos de API de S00 no autorizan al nuevo chat a consumirlos.
5. Rollback de esta organización: conservar commits y evidencia, cerrar/archivar el worktree gestionado solo cuando ya no se necesite y mediante el mecanismo recuperable de la app. No borrar carpetas o cambios de usuario para recuperar la base.

## Tareas y evidencia de preparación

| T     | Dependencias              | Terminado cuando                                                                                   | Estado                       |
| ----- | ------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- |
| P-T01 | Solicitud y plan S00–S13. | Inventario, lectura de instrucciones, ausencia de secretos candidatos e índice previo comprobados. | Completado.                  |
| P-T02 | T01.                      | Matriz, AGENTS y encargo S01 coherentes y sin concesión de permisos externos.                      | Completado.                  |
| P-T03 | T02.                      | Checks locales relevantes y preservación de cambios anteriores comprobados.                        | Completado; evidencia abajo. |
| P-T04 | T03.                      | Commit base local, sin push, con fuentes esperadas y sin privados.                                 | Pendiente.                   |
| P-T05 | T04.                      | Segundo chat en proyecto CRM correcto y worktree aislado desde esa base.                           | Pendiente.                   |
| P-T06 | T05.                      | Comparación de base, exclusión de secretos, lectura de estado del nuevo chat y entrega.            | Pendiente.                   |

Este documento describe la preparación autorizada; el identificador del segundo chat y el resultado de sus contratos se comunicarán únicamente cuando existan. El diagnóstico Instantly real está autorizado por el usuario (máximo2 nuevas/20 acumuladas), pero esta preparación no lo ejecuta ni revoca ese permiso. Estado al iniciar: B failed18, diagnóstico no iniciado y sin locks/tmp.

QA local de base: TypeScript `tsc --noEmit --incremental false` correcto;8/8 tests relacionados con señales de oportunidades, compatibilidad de migración043 y paquetes documentales, con fetch global bloqueado y transportes ficticios/in-memory. La regresión S00 previa284/284 se conserva como evidencia previa, sin repetirla por documentación y snapshot. No build/Next typegen, producción o env reales. Formato aplicado únicamente a instrucciones/documentos nuevos, sin reformatear los cambios anteriores del usuario. Antes de registrar Git se cotejan los hashes originales y se permite solo la modificación intencional de AGENTS raíz más documentos nuevos.
