# RC: versión conjunta local para revisión

29/10/2026, America/Bogota. SDD STRICT, preparación/revisión local. Respuesta5→B: el usuario pide incluir también los cambios anteriores pendientes, revisándolos como una versión conjunta. Este alcance sustituye la selección aún pendiente de REL-T02 en [runbook046](instantly-046-release-runbook.md). Main/autodeploy están confirmados; no se autoriza push, merge, despliegue, SQL remoto o llamadas reales.

## Especificación y aceptación

| FR      | Requisito                                                                      | Aceptación                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-FR01 | Registrar una versión conjunta reproducible sin descartar cambios.             | RC-AC01: commit local sobre la rama S00, revisión del delta completo frente al main local; no reset/stash/clean, main/worktree S01/índice previo conservados.                                |
| RC-FR02 | Incluir aplicación, pruebas, herramientas y documentación públicas necesarias. | RC-AC02: catálogo de archivos/deltas y dependencias, sin .local/env reales/credenciales/adjuntos privados;001–045, Docker y lockfile no cambian.                                             |
| RC-FR03 | Revisar comportamiento y permisos de lo que se publicaría conjuntamente.       | RC-AC03: revisión de señales de oportunidades y webhook046, pruebas offline de producto/S00/DB, typecheck y limitaciones documentadas; no ocultar fallos.                                    |
| RC-FR04 | Validar build sin datos o red reales.                                          | RC-AC04: copia aislada con fuentes del candidato, entorno permitido ficticio y bloqueo de red; build registrado o bloqueo explícito, sin leer env reales ni generar servidores persistentes. |
| RC-FR05 | Preservar43 y separar revisión de autorización de release.                     | RC-AC05:12 JSON privados/sourcev7 idénticos y0 llamadas reales; commit local no implica G6, aplicación046 remota o cierre C/D/S00; destino/imagen previa siguen pendientes.                  |

## Diseño de la versión y alcance de revisión

Base local main2f1f0a7 y rama S00 en7b50498 al iniciar. Estas referencias son locales: no se hace fetch y no se afirma que el main remoto o la imagen desplegada sigan en esa revisión. La versión conjunta incluye el trabajo público de la base WIP ae0c42c y las extensiones posteriores de S00. Se revisa el delta total, no solo los archivos sin registrar.

Grupos: señales de oportunidades (últimos envíos cliente/lender, documentos y lenders distintos, consultas paginadas con cliente RLS, vistas de lista/detalle/control); webhook técnico (rutas, flagfalse, superadmin/MFA, receptor, RPC/CAS/RLS y046); herramientas Composio/Instantly/S00 y fixtures offline; documentación y evidencia pública del plan. Las herramientas no se inician al importar la app y no se copian credenciales al VPS. La imagen web standalone incluye su grafo runtime, no se convierte en un ejecutor de S00. Worker,001–045, Docker y dependencias conservan sus fuentes previas.

No hay cambio arquitectónico nuevo: se conserva IA-ADR01. La046 y la publicación apagada siguen el runbook REL. Copia local descartable del candidato, sin .env reales, con valores ficticios y red bloqueada, para comprobar build y pruebas sin contaminar .next/archivos del checkout de trabajo. Ningún resultado de esa copia acredita credenciales, Supabase remoto, TLS/Coolify o facturación.

Un commit local al terminar fija la versión revisable; no se usa un commit WIP como publicación automática ni se mueve main. Cualquier fallo confirmado se registra; la solicitud de revisar no autoriza refactors funcionales ajenos. Si requiere corrección de producto, se entrega el hallazgo y su impacto antes de ampliar el alcance.

## Tareas

| T      | Objetivo / requisitos                             | Dependencias  | Cierre y pruebas                                                                                                                       | Estado                                                                        |
| ------ | ------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| RC-T01 | Aclaración, inventario y baseline; FR01/02/05.    | Respuesta5→B. | Archivos/deltas, exclusión de privados, hashes y main/índice iniciales capturados.                                                     | Completada localmente.                                                        |
| RC-T02 | Revisión conjunta de código y contratos; FR02/03. | T01.          | Datos/permisos/concurrencia/UI/contratos revisados, hallazgos contrastados y límites declarados.                                       | Completada, límites abajo.                                                    |
| RC-T03 | QA offline del candidato; FR03/04/05.             | T01/T02.      | Pruebas, DB, typecheck/build aislados y preservación; fallos registrados.                                                              | Completada;656/656, DB/TS/build aislado.                                      |
| RC-T04 | Commit local y entrega; FR01/02/05.               | T03.          | Commit identificado, árbol coincide con fuentes verificadas, sin secretos o push; runbook actualizado y pendientes remotos explícitos. | Completada; código63686c6 y constancia documental posterior, sin publicación. |

## Verificación, riesgos y rollback

Al comenzar: typecheck directo del checkout correcto; prueba específica del webhook en curso. La evidencia423/423 anterior es antecedente y no acredita por sí sola esta versión conjunta. El build aislado es nuevo alcance de preparación autorizado por esta solicitud, sin ejecutar Docker/deploy ni cargar el .env del checkout.

Riesgos conocidos antes del cierre: main remoto no consultado; no se ha identificado el recurso web exacto, su dominio y su imagen previa;046 solo local; bridge/manifiesto/presupuesto C pendientes. No publicar por tener commit o build correcto. Rollback de la preparación: conservar commit y archivos, sin borrar fuentes/counters o tocar main/S01. Rollback remoto sigue siendo flagfalse y recuperación de imagen previa autorizada, conservando046/evidencia.

## Resultado de revisión y QA

Modo revisión: no se modificó lógica de producto o tests para obtener un resultado correcto. Se revisó el delta de aplicación frente al main local: señales de oportunidades/cliente RLS/paginación, componentes de lista/control/detalle, receptor/control autenticado, propagación MFA/origen, store/CAS y046. Se revisaron también los cambios de contratos/elegibilidad de campañas de las herramientas S00 y sus gates offline, compatibilidad y privacidad. El volumen de documentación/fixtures no equivale a una auditoría manual exhaustiva de cada línea de herramientas anteriores; se apoya además en su suite completa. **Sin defectos bloqueantes confirmados en el alcance revisado.**

Resultados sobre copia aislada de512 archivos públicos, código/configuración/pruebas idénticos al checkout; solo documentación se completa después:

- `node --import tsx --test tests/*.test.ts` (lista expandida por el ejecutor aislado): **656/656**,0 fallos/omitidas/canceladas,78.843s. Incluye S00, webhook, señales/UI SSR y resto de regresiones de producto.
- `node --import tsx tests/database.ts`: **Database acceptance tests passed**,001–046 en PGlite descartable y casos de roles/integridad/idempotencia.
- TypeScript directo `tsc --noEmit --incremental false`: correcto en checkout y copia aislada. La suite específica webhook también pasó19/19 antes de la regresión conjunta.
- Preparación de assets PDF local y `next build` normal con **Turbopack16.3.8**: correcto, compilación/typecheck/prerender/standalone; manifiesto de rutas contiene webhook y control Instantly. Variables ficticias permitidas, telemetría apagada y red Node bloqueada; no env reales copiados o cargados. No se inicia servidor de la app.
- Búsqueda de patrones de secretos en fuentes públicas sin coincidencias; no es una auditoría completa de seguridad. .local/credenciales/adjuntos privados excluidos; fixture PDF público ficticio previo conservado.

Diagnóstico del entorno de QA, conservando sus logs: el primer build falló por prohibición del sandbox Windows de crear junctions internos de Turbopack; el mismo build pasó al permitir esa operación local en la copia aislada. La primera regresión terminó635 correctas/21 fallos de CLI por ausencia de la ruta local node_modules/tsx/dist/loader.mjs en la copia. Se añadió solo un adaptador descartable que carga la librería ya instalada; su configuración inicial incompleta también se registró. Tras completar ese paquete auxiliar, la regresión pasó656/656. No se cambió/omitió/relajó ningún test ni se corrigió producto para ocultar estos errores. La skill systematic-debugging se utilizó para confirmar las causas ambientales.

El bloqueo de sockets registra intentos IPC de tsx que fueron rechazados; no confundirlos con peticiones HTTP a proveedores o consumo del journal. Ninguna ejecución usa claves reales o llama a Instantly/Supabase remoto. La red nativa de Turbopack no se certifica como auditoría de tráfico del sistema: se utilizaron recursos/dependencias locales y destinos ficticios, sin credenciales o operaciones de proveedor.

**Límites:** Docker no está disponible en este host; no se construyó/probó imagen Linux. La copia anidada resuelve dependencias del directorio padre y su standalone tiene una ruta anidada; ese artefacto Windows no se entrega ni copia a Coolify. El despliegue deberá construir desde la raíz del repositorio con dependencias propias según el Dockerfile existente y comprobar su server.js/health. No cambiar Next/Docker por esa particularidad de la copia de QA. Sin E2E visual, pruebas de proxy/TLS/Coolify, RPC PostgREST remota o costos globales verificados. La imagen/versión saludable actual y el recurso web exacto siguen sin identificar.

El candidato es **apto para revisión local y preparación de release**, con los límites anteriores; no se declara listo para publicar sin los gates restantes de REL. El commit local que incorpora este informe identifica su versión; confirmar árbol/contenido/hash al cerrar, manteniendo main y los privados intactos. REL-T02 avanza en selección/revisión local, pero su ficha remota e imagen/build Linux continúan pendientes.

## Constancia del candidato registrado

Código registrado en **63686c623398973f548d4c09ce04812184c4c2c1**, árbol4385f80b0c1a2cd107b099a7970202147a6b9e9c, rama codex/s00-auto-receive.512 archivos públicos y124 archivos de delta frente al main local2f1f0a7; el commit añade50 archivos nuevos/modificados sobre la base S00 previa, conservando el resto de la versión conjunta. Árbol de trabajo limpio al comprobar ese commit, main sin cambios, todos los archivos fuente/configuración/tests coinciden con la copia verificada; diferencias posteriores solo de constancia documental.12 JSON privados/sourcev7/calls43 intactos. Formato/diff y207 enlaces locales de los seis documentos correctos. Ningún push/merge/deploy/SQL remoto o proveedor real. La constancia documental posterior acompaña el código sin cambiarlo; usar la punta de esta rama revisada, nunca afirmar que main remoto o Coolify ya contienen63686c6.
