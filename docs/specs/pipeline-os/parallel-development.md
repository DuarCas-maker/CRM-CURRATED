# Pipeline OS: coordinación de dos chats

Registro local R47-T04a autorizado al coordinador: [cierre del commit del puente](s00/instantly-047-local-commit.md), sobre0af77b7 y solo selección pública S00/compartida ya revisada. Respeta serialización LF, fuente43/12 privados y ownership; no abre/copia/edita S01 ni incorpora su worktree. Commit local no autoriza push, merge, despliegue, SQL remoto o ejecución C. Las constancias de preparación anteriores permanecen históricas.

Preparación CAPP-R47 por coordinador: [candidato](s00/instantly-047-release-candidate.md), manifiesto público de contenido y runbook de publicación apagada; solo documentación y validaciones locales descartables. Los20 archivos de código/SQL/tests del payload conservan los hashes de QA681; no se modifica S01, código probado, índices/HEAD, remoto, infra o permisos. CAPP-T06a preparada; SQL remoto/publicación/C real siguen pendientes,43/12 JSON preservados.

Incremento CAPP autorizado al coordinador: 047 reservada e implementada localmente en `supabase/migrations/047_instantly_webhook_control_leases.sql`, rutas/control/UI/CLI y tests propios. [Estado y QA](s00/instantly-c-app-validation.md). Las siete fuentes compartidas modificadas son el core C, ruta webhook, Integrations, endpoints/store de Instantly, helper Supabase y contador del inventario de migraciones. No se transfieren a S01; su checkout, documentos y permisos permanecen fuera de este incremento. Fuente real43 y12 JSON intactos; sin SQL remoto/API/push/deploy/activación.

Preparación CAPP posterior por coordinador: [contrato/ADR/manifiesto draft/presupuesto](s00/instantly-c-app-bridge.md),9→A, permiso temporal vía superadmin/MFA. Solo docs S00/raíz propias;047 propuesta como siguiente ordinal libre para leases/RPC, sin archivo SQL y a coordinar antes de implementar.43/12 JSON/423 fuentes protegidas, sin env/red/permisos/activación/push. S01 conserva directorio, propiedad y restricciones; no se transfiere acceso o trabajo compartido por este plan.

INS-APP posterior29/10 por coordinador: nuevo src/lib/server/instantly, dos rutas API, migración046, test app y extracción compatible wrapper S00; actualización local de continuidad y .env.example.19 nuevos/423 regresión/DB/TS, source43/12 privados/410 previos protegidos intactos. S01 no edita esas rutas/migración ni recibe acceso a privados; no cambia su checkout o permisos. Ningún despliegue/push/merge/Supabase remoto/API.046 reservada por coordinador; no transferencias implícitas de ownership.

Implementación C posterior29/10 por coordinador: core/handler/fixtures/tests y extensiones files/CLI/runner propios,28 C/400 S00/TS correctos.32 protegidos intactos (12 JSON operativos y20 archivos anteriores distintos de los tres compartidos), v7/completed43 sin migrar, sin credenciales/APIs/endpoint/envíos. T05/T06 pendientes; no se transfiere propiedad, permiso o acceso a S01. El frente S01 conserva su checkout/tareas y no recibe claves/contadores.

Preparación C29/10/2026 por coordinador: [protocolo/AC/presupuesto](s00/instantly-phase-c.md) preparado desde43,12–14 normales/máximo19 nuevas/62 acumuladas propuestos. Usuario confirma ausencia de receptor público, a preparar sin publicación actual. Solo documentos S00/raíz propios; contador43/privados/código/propiedad S01 intactos, cero APIs/envíos/infra. Implementación/QA C y permiso real pendientes; no se reutiliza remanente5 de B ni se reabre su terminal.

28/10/2026. SDD STRICT por aislamiento de trabajo existente, credenciales y límites externos. El usuario eligió S01 en un segundo chat/worktree y autorizó preparar una base común conservando los cambios actuales. No autoriza producción, nuevas llamadas a proveedores, push, merge o migraciones remotas durante esta preparación.

## Objetivo, alcance y aceptación

Actualización29/10/2026 del coordinador: diagnóstico BD completado, un GET propio/19 acumuladas, campaña pausada y cero escrituras/envíos. Próximo incremento pendiente de contrato de opcionales/compatibilidad/reconciliación offline. B no reanudada y reparto sin cambios; las cifras18 y permiso pendiente de la preparación siguiente son evidencia histórica del28/10.

Continuación29/10: corrección OC de opcionales completada offline (293/293 S00 y TS); contrato/reconciliación automática de recuperación B aún pendientes. Calls19 y ocho archivos privados intactos. No se transfieren archivos compartidos o permisos al frente S01.

Plan posterior29/10: protocolo BR preparado, implementación pendiente; misma campaña/v4/19, máximo22 nuevas/41 acumuladas propuesto. Solo documentos del coordinador, sin código/APIs/permiso remoto nuevo o cambios de propiedad S01.

Actualización posterior29/10: BR-T02/03 implementadas/probadas offline por solicitud explícita:23 BR/316 S00 y TS correctos; source real19 intacto, estado de recuperación not_started y cero llamadas/escrituras reales. Se modifican solo scripts/tests/docs S00 propios; sin transferencias o cambios en S01. BR-T04 real continúa pendiente de permiso22/41.

Resultado posterior29/10: BR-T04 autorizada22/41 y ejecutada una vez:8 nuevas/27 acumuladas,failed/stage5/B_UNSAFE_CAMPAIGN, emergencia verified_paused,0 leads/envíos. Source19 intacto,7 archivos privados restantes iguales, sin replay HTTP; diagnóstico de lectura configurada por preparar antes de más APIs. Mantener ownership S00 y no heredar permisos en S01.

Plan CFD posterior29/10: protocolo de lectura configurada preparado, hasta2 nuevas/29 acumuladas propuesto; todavía sin implementar/ejecutar.27 reales y campaña intactas. Solo documentos S00 del coordinador, sin cambios de propiedad o acceso S01.

Incremento CFD posterior29/10: implementación/QA offline autorizadas y completadas en núcleo nuevo CFD, files/CLI, fixture/test y documentación S00 del coordinador.23 CFD/339 S00 y TS correctos. Preview real not_started27/new0 sin env/red/save; ocho archivos privados conservados, sin v6 real o campaña modificada. CFD-T04 remoto pendiente de permiso propio2/29. No cambia ownership, worktree o tareas de S01.

Resultado CFD posterior29/10: permiso específico2/29 ejecutado con1 GET, completed28; identidad/pausa correctas, proyección configurada con extras en secuencia y guarda false. Snapshot27/7 archivos restantes intactos,0 mutaciones/envíos. Próximo bloque S00 propuesto: contrato de secuencia y corrección offline, sin permisos heredados o cambios de ownership S01. No reabrir CFD para gastar el segundo intento.

Incremento SC posterior29/10: corrección de defaults de secuencia autorizada e implementada offline por coordinador en B/CFD, fixture CFD/test SC y docs propias.10 nuevos/349 S00/TS correctos, contador28/10 archivos privados intactos, sin APIs/credenciales/campaña modificada. Comparación histórica CFD estable; propuesta de recuperación desde28 requiere protocolo propio. Sin transferencias de ownership, checkout compartido o tareas S01 modificadas.

Plan BR28 posterior29/10: protocolo desde28 preparado, v7/B_RECOVERY_FROM_28 propuesto con configuración conservada y sin PATCH campaña normal;14–15 nuevas normales, máximo N15/R3/H2=20 nuevas/48 acumuladas. Solo documentos S00 del coordinador, source28/diez archivos privados intactos y sin código/APIs/credenciales/campaña modificada. Implementación/QA y permiso real propios pendientes; sin cambios de propiedad o acceso S01.

Implementación BR28 posterior29/10: T02/03 autorizadas y completadas offline en núcleo nuevo, files/CLI, fixture/test y docs S00.23 BR28/372 S00 y TS correctos; origen real28/diez privados intactos,25 archivos anteriores de scripts/tests ajenos a files/CLI conservados, preview0/0/0 y ninguna v7 real. Nuevo cursor inconsistente se rechaza; sin helpers históricos/DB/worker/S01/dependencias o campaña modificados. T04 remoto pendiente de permiso propio20/48/cupo incluido; sin transferencia de ownership o acceso S01.

BR28-T04 real posterior29/10: permiso20/48 y acceso incluido acreditado, ejecución única completed43/stage13 con15 nuevas/N15/R0/H0. Dos leads propios/aislamiento A/B/cierre pausado, sin reconfigurar campaña/envíos/operaciones pagas. Snapshot28 y9 privados restantes iguales, replay offline0/0/0 sin más llamadas. B recuperada operativamente; C/D/S00 pendientes. No cambia ownership S00/S01 ni autoriza otras APIs, limpieza de leads o gasto del remanente5.

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
| P-T04 | T03.                      | Commit base local, sin push, con fuentes esperadas y sin privados.                                 | Completado.                  |
| P-T05 | T04.                      | Segundo chat en proyecto CRM correcto y worktree aislado desde esa base.                           | Completado.                  |
| P-T06 | T05.                      | Comparación de base, exclusión de secretos, lectura de estado del nuevo chat y entrega.            | Completado.                  |

Este documento describe la preparación autorizada; el identificador del segundo chat y el resultado de sus contratos se comunicarán únicamente cuando existan. El diagnóstico Instantly real está autorizado por el usuario (máximo2 nuevas/20 acumuladas), pero esta preparación no lo ejecuta ni revoca ese permiso. Estado al iniciar: B failed18, diagnóstico no iniciado y sin locks/tmp.

QA local de base: TypeScript `tsc --noEmit --incremental false` correcto;8/8 tests relacionados con señales de oportunidades, compatibilidad de migración043 y paquetes documentales, con fetch global bloqueado y transportes ficticios/in-memory. La regresión S00 previa284/284 se conserva como evidencia previa, sin repetirla por documentación y snapshot. No build/Next typegen, producción o env reales. Formato aplicado únicamente a instrucciones/documentos nuevos, sin reformatear los cambios anteriores del usuario. Antes de registrar Git se cotejan los hashes originales y se permite solo la modificación intencional de AGENTS raíz más documentos nuevos.

## Separación comprobada y puesta en marcha

Base común local: `ae0c42cdb36f24b2710cbe363df584f08f839f05`, commit WIP de 481 archivos. Se conservaron sin cambios los 478 archivos previos distintos de AGENTS; AGENTS recibió únicamente las reglas de coordinación y se añadieron los dos documentos de coordinación. Ninguna ruta privada entró en el índice. No se realizó push.

- Coordinador: `C:/Users/Usuario/Desktop/Projects/CRM Currated`, rama `codex/s00-auto-receive`.
- Segundo chat: **Pipeline OS — S01: identidad y estados**, ID `01a18602-a8f8-7141-9fc9-0fdf580a8224`, proyecto local `4ff4a957-7163-4795-81db-73c073907566`.
- Worktree S01: `C:/Users/Usuario/.codex/worktrees/9349/CRM Currated`, rama `codex/s01-foundations`, partiendo del mismo commit base.

Comparación previa a los cambios S01: 481 archivos comprobados, 480 idénticos byte a byte y uno con diferencia exclusiva de terminación de línea; cero diferencias de contenido. Se comprobó por existencia que no se copiaron `.env`, `.env.local`, `.env.production`, `.env.development` ni `.local/pipeline-os`. Los ocho archivos privados de Instantly permanecieron intactos en el coordinador: 18 peticiones consumidas y cero nuevas durante esta preparación.

El segundo chat está activo y empezó el discovery T01-01, leyendo las instrucciones y contratos existentes. La falta de node_modules en su checkout fue identificada, sin inventar pruebas ni iniciar servicios externos. Esto no da por finalizado T01-01 ni autoriza implementación funcional. La documentación del coordinador puede avanzar tras la bifurcación; el commit común conserva la referencia inmutable para revisar e integrar posteriormente.
