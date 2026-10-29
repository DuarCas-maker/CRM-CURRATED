# INS-OC: campos opcionales de campaña — SDD STRICT

29/10/2026. Implementación y pruebas exclusivamente offline autorizadas por el usuario. Base real: diagnóstico v4 completed19, campaña propia pausada y B v3 failed18 conservada. Ninguna credencial se carga y no se llama a APIs autenticadas, modifica la campaña o reanuda el ensayo. Se consultan únicamente páginas públicas de documentación del proveedor.

## Discovery, causa y contrato

El GET de BD omitió `ai_sdr_id`, `is_evergreen` y `stop_for_company`; el resto de comparaciones coincidió. `assertCampaign` exige null/false explícitos y rechaza esa forma de respuesta. El desacuerdo actual está demostrado; la respuesta initial histórica no se guardó, por lo que no se atribuye retrospectivamente el error a un campo concreto.

Fuentes primarias revisadas el29/10/2026: [Get campaign](https://developer.instantly.ai/api-reference/campaign/get-campaign), [Create campaign](https://developer.instantly.ai/api-reference/campaign/create-campaign), [Patch campaign](https://developer.instantly.ai/api-reference/campaign/patch-campaign). Los tres campos no figuran como required y permiten null; los dos flags son booleanos y el identificador acepta UUID. `ai_sdr_id` describe el agente creador, no un interruptor certificado de envío. Create permite enviarlo; el body documentado de PATCH no lo incluye. GET/PATCH no garantizan que omisión o null signifiquen desactivado. No usar ejemplos completos de respuesta como lista de propiedades obligatorias ni inferir defaults no publicados.

Hipótesis: incompatibilidad por presencia exigida confirmada para la respuesta actual; normalización de schedule/sequences descartada para BD actual; configuración histórica distinta sigue sin demostración. No hay requisito de negocio pendiente: el usuario autorizó corregir este contrato offline, manteniendo ensayo sin emisión e historia19. No pide recuperar/reiniciar B ni habilitar envío; las decisiones de rondas anteriores se conservan.

## Especificación y aceptación

| FR      | Requisito                                                                                                          | AC verificable                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OC-FR01 | Distinguir omitido, null, explícito, conflictivo e inválido en los tres campos; no mutar o completar la respuesta. | OC-AC01: dado cualquier conjunto de omisiones/null/false, la inspección conserva su estado y entrada; IDs/true/tipos incompatibles no se convierten a valores seguros.                                                                                       |
| OC-FR02 | Admitir opcionales desconocidos solo en el ensayo sin envío protegido por guardas independientes.                  | OC-AC02: forma BD sintética pasa en borrador0/pausa2 con listas vacías; estado activo/inesperado, remitentes/tags/CC/BCC/routing no vacíos/ausentes, stop_on_reply no true, identidad/schedule/sequences diferentes bloquean. No certifica defaults o envío. |
| OC-FR03 | Mantener intenciones explícitas en requests y respetar contrato diferente de create/PATCH.                         | OC-AC03: create conserva ai_sdr_id=null y flags=false; PATCH conserva flags explícitos y omite el campo de creador no documentado para ese body.                                                                                                             |
| OC-FR04 | Preservar exactamente historia y contador19, sin nuevas transiciones, resets o reapertura de terminales.           | OC-AC04: v4 completed19 validada sin env/fetch/save; intento B legacy rechazado por adaptador y ocho archivos privados idénticos antes/después. Diagnóstico sigue usando comparación histórica estricta.                                                     |
| OC-FR05 | Sin rutas/capacidades de red nuevas, secretos o dependencias.                                                      | OC-AC05: tests con transporte/reloj/store ficticios y global fetch bloqueado; CLI fixture-only, status real offline, salida sin valores privados; cero APIs reales/mutaciones.                                                                               |
| OC-FR06 | Probar corrección y regresión con trazabilidad.                                                                    | OC-AC06: caso de omisión falla antes del fix y pasa después, negativos pasan; regresión S00, TypeScript y diff/formato correctos.                                                                                                                            |

Fuera de alcance: recuperación de B19/v5, nueva campaña, cambio de horario/manifiesto, activación/envíos, receiver C, SMS/Bouncer, app/DB/worker/S01 o despliegue. NFR: Node22/TS/Zod actuales, sin dependencias; privacidad por enumeraciones fijas y ausencia de respuestas completas. No aplica cambio de roles, schema/RLS o infraestructura.

## Diseño y OC-ADR01/02

ADR01: cambiar únicamente interpretación del contrato del ensayo B. Una inspección pura devuelve estados de los tres campos sin defaults; valores propios null/omitidos se mantienen desconocidos, false explícito se distingue, true o UUID de agente se rechazan como incompatibles con el ensayo; tipos inválidos y propiedades heredadas no se aceptan. `assertCampaign` conserva identidad/workspace, listas estrictamente vacías, stop_on_reply=true y schedule/sequences exactos. Además exige estado0/2 independientemente del mapeo del manifiesto para que un mapeo erróneo no autorice activo con opcionales desconocidos. Las fases configuradas siguen exigiendo pausa. No se habilitan sends ni se acredita semántica de opciones desconocidas para una futura fase de envío.

ADR02: mantener comparación BD estricta y sus campos originalGuardPassesNow/historicalFailureCauseProven. El diagnóstico describe la guarda original, no debe reinterpretar el pasado al corregir B. Sin cambio de esquemas/journals/files/CLI de ejecución, sin migración a v5. `bCampaignPayload(configured=true)` sirve al PATCH, por lo que excluye ai_sdr_id de ese request; create mantiene null. Los flags false siguen explícitos, nunca se obtienen del GET omitido. No se introduce otro runner ni contador paralelo.

El informe B declara `sendingSafetyCertified=false` tanto antes como después del ensayo; completarlo solo acredita un recorrido sin emisión, nunca el significado operativo de campos desconocidos ni preparación para enviar.

Alternativas descartadas: normalizar con `?? false` o `?? null` atribuye significado no probado; exigir siempre presencia contradice optional/nullable y bloquea el ensayo aun sin capacidad de emisión; ampliar tolerancia a todos los campos perdería controles de envío/identidad. La compatibilidad elegida es local al ensayo no emisor y bloquea valores explícitos conflictivos, incluso si el API los admite en otros usos.

## Tareas

| T      | Objetivo / FR                                 | Dependencias                                       | Terminado y pruebas                                                                                                            |
| ------ | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| OC-T01 | Contrato/causa/AC/ADR, FR01–06.               | BD19, instrucción offline y documentación pública. | Este documento antes de código; contrato nullable/optional y límites declarados.                                               |
| OC-T02 | Reproducción y ajuste mínimo, FR01–03.        | T01.                                               | Test de respuesta sin tres opcionales falla antes; inspección y guardas aplicadas después sin default; create/PATCH cubiertos. |
| OC-T03 | Negativos y regresión, FR02/04–06.            | T02.                                               | Cobertura de fases/reconciliaciones, estados/tipos/listas/tenant, BD histórico y terminales; S00 y TS correctos.               |
| OC-T04 | Evidencia de preservación y entrega, FR04–06. | T03.                                               | Ocho archivos privados idénticos/calls19, preview sin env/HTTP/save, revisión final y docs actualizados.                       |

## Rollout, rollback y verificación

Solo rollout local de código/tests. No ejecutor real hoy; el terminal19 permanece cerrado. Una recuperación del mismo recurso requiere contrato de continuidad y presupuesto propios antes de cualquier nueva autorización remota. No pedir claves o respuestas ya resueltas. Rollback: retirar este ajuste de código conservando v4, fuentes y documentación histórica; jamás devolver saldo, degradar o recrear el ensayo para eludir terminales. G6 no aplica: no despliegue. Riesgo residual: las opciones desconocidas no certifican preparación de envío; las pruebas ficticias no demuestran comportamiento remoto posterior.

G0–G3 cerrados por evidencia BD, contrato oficial y alcance confirmado. G4/G5 completados con la evidencia siguiente. Esfuerzo acotado a scripts/pruebas/docs de S00, sin solapar S01.

## Evidencia final y trazabilidad

OC-T01–04 completadas. Reproducción OC-AC01/02: el test nuevo de tres omisiones falló antes del cambio (`failed` frente a `completed`) y pasó después. [Código](../../../../scripts/pipeline-os/s00-instantly-b.ts), [tests B](../../../../tests/pipeline-os-s00-instantly-b.test.ts) y [regresión BD](../../../../tests/pipeline-os-s00-instantly-b-diagnostic.test.ts). No se modificaron consumidores de producción, DB, Next, worker o ficheros S01.

| AC      | Evidencia de aceptación offline                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OC-AC01 | Inspección pura sobre entradas congeladas; null/omisión/explícito distinguibles, valores propios undefined/tipos inválidos e heredados rechazados; salida fija sin valores privados.                      |
| OC-AC02 | 18 combinaciones admitidas bajo guardas, conflictos en initial/configured/final bloqueados, listas/stop_on_reply/tenant/schedule/sequences/estado siguen protegidos; mapeo activo falso no evita gate0/2. |
| OC-AC03 | Requests create/PATCH con flags explícitos y ai_sdr_id solo en create; reconciliación de write incierto no repite POST/PATCH; CLI con respuestas de opcionales omitidos termina sin emisión.              |
| OC-AC04 | Test BD preserva la comparación original estricta y fuente histórica ante las tres omisiones; replay real offline completed19, legacy B rechazado y ocho archivos privados SHA256 idénticos.              |
| OC-AC05 | Transportes/relojes/stores ficticios, fetch global bloqueado; CLI con fixture y directorio temporal. Replay real con env/fetch/save que fallarían ante uso:0/0/0, cero lock/tmp.                          |
| OC-AC06 | Regresión final293/293 S00, nueve tests nuevos; TypeScript, revisión de diff, formato y enlaces correctos.                                                                                                |

Comandos: Node22.23.4 `--import tsx --test --test-reporter=tap` con todas las suites `tests/pipeline-os-s00*.test.ts` → **293/293**,0 fallos/omitidas/canceladas,30.389s. TS `node node_modules/typescript/bin/tsc --noEmit --incremental false` → exit0. Comprobación acotada previa65/65 antes del último test BD y extensión CLI. No se repiten suites tras completar QA porque desde entonces solo cambia documentación. Lint no tiene script; build/Next typegen no aplican al CLI y cargarían env. [Evidencia general](../verification.md).

Revisión propia safe-code-review: semántica de null/ausencia/tipos, independencia de guardas, create/PATCH, histórico/terminales/contadores, privacidad y compatibilidad de consumidores. No se detectaron hallazgos confirmados pendientes en el alcance offline revisado. Persiste el límite declarado: no se conoce la semántica operativa remota de null/ausencia ni se certifica envío, pausa por lead o recuperación B. No se usaron credenciales o APIs autenticadas. Contador real final19 y campaña sin modificar.
