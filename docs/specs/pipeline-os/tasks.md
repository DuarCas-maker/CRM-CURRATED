# Plan de sprints y tareas de Pipeline OS

## R47-T04a: registro local del candidato autorizado

Solicitud posterior autoriza el commit definitivo, con43 y prohibiciones remotas conservadas. [Cierre R47-C-T01–04](s00/instantly-047-local-commit.md): revisar contenido/QA/privados, documentar serialización LF del repo, preparar selección explícita y comprobar blobs/commit. El SHA resultante se identifica en Git y en la entrega, sin autorreferencia documental. No cambia el payload de20 archivos, ni aplica SQL, toca S01 o autoriza publicación. R47-T04 publicación/R47-T05 smoke y C siguen pendientes, aunque el incremento quede registrado localmente.

## R47-T03 completada:047 aplicada por operador y catálogo aceptado

Tras autorización específica, el usuario reportó Success y entregó postflight conforme: tabla/17 columnas/16 constraints/RLS/grants y cuatro funciones047 con permisos previstos, sin sobrecargas;046 conserva estructuras/permisos y tres huellas idénticas al preflight. [Resultado y límites](verification.md). No se ejecutó SQL remoto desde el agente. Siguiente: commit/revisión/publicación apagada de R47-T04, aún sin autorización; R47-T05/smoke y C/D/S00 pendientes.43 intactas, sin deploy/activación/envíos. Las secciones siguientes conservan la cronología anterior.

## R47-T03: preflight remoto revisado, aplicación pendiente

El operador ejecutó la consulta de solo lectura autorizada y compartió catálogo conforme:046 completa con permisos previstos,047 ausente, sin sobrecargas, rol/owner supabase_admin con acceso a perfiles. Baseline046 registrado para postflight. Flag ausente e imagen/mecanismo de recuperación observados en capturas previas; no se probó rollback ni se cambió retención. R47-T03 solo completa su preflight; faltan autorización/aplicación047 y postflight. R47-T04/05 y C no ejecutadas,43 intactas. [Evidencia y límites](verification.md).

## CAPP-T06a / R47: preparación de publicación — 29/10/2026

[Candidato](s00/instantly-047-release-candidate.md), [huellas](s00/instantly-047-release-manifest.json) y [runbook047](s00/instantly-047-release-runbook.md) preparados localmente. R47-T01 contenido/preservación y T02 identificación por huella completados para preparación; commit y ficha operativa final pendientes. Nueve escenarios de catálogo local conformes; el payload coincide con la QA681 previa, sin repetirla por documentos. R47-T03 SQL remoto, T04 publicación y T05 smoke/recuperación en vivo no ejecutados. CAPP-T06 completa exige además esas comprobaciones, configuración y manifiesto final; T07/C real/D/S00 siguen pendientes. Sin permisos heredados o consumo de43.

## CAPP-T02–05: implementación local — 29/10/2026

Solicitud explícita de puente/047 y QA offline. [Tareas, AC y verificación](s00/instantly-c-app-validation.md): T02 migración/RPC/admisión, T03 UI/API/credencial y T04 adaptador/CLI/v9 completados localmente; T05 cerrada para QA offline con 681/681, aceptación DB001–047, TS/build aislado y revisión. T06 release/047 remota/configuración/manifiesto final y T07 ejecución real siguen pendientes y requieren sus permisos. No consumir remanentes ni crear v9 real por completar código; fuente 43 y 12 archivos operativos preservados. S01 no se modifica.

## CAPP: preparación de puente/manifiesto/presupuesto — 29/10/2026

[CAPP-T01](s00/instantly-c-app-bridge.md) preparada tras9→A: contrato/ADR/8FR/12AC, borrador privado no ejecutable y cuentas19/62 proveedor +25 control (44 nuevas cliente como máximo); callback/HTTP DB se contabilizan aparte. T02 leases/RPC/047 local, T03 UI/API/ticket, T04 adaptador/ledgerv9, T05 QA/revisión, T06 release/config/costos/manifiesto final y T07 ejecución única permanecen pendientes y sujetos a solicitud/permiso de su alcance.43/12 JSON/fuentes preservados,0 env/red/código/SQL/activación; no otro push o despliegue.

## REL: publicación apagada y disponibilidad básica — 29/10/2026

[Informe posterior de app](s00/app-deployment-validation.md): REL-T04 acreditada mediante push normal autorizado0af77b7/main verificado y Success reportado por operador, flag ausente y smoke correcto.046 aplicada por usuario/postcatálogo correcto con owner supabase_admin (simulación local conforme); no se observó catálogo remoto previo/historial o igualdad completa de definiciones. REL-T05:4/4 comprobaciones HTTP y aceptación manual básica8→A (MFA/Oportunidades/lista/detalle/Conversaciones/Campañas) correctas; logs/imagen y aceptación funcional más amplia pendientes.43/12 JSON preservados,0 Instantly/envíos/configuración/Supabase directo por agente; sin nuevas peticiones al registrar8. C integrada/D/S00 pendientes. No nuevo push/deploy por esta documentación local.

## RC: versión conjunta local — 29/10/2026

Respuesta5→B amplía REL-T02 a todos los cambios públicos pendientes, incluidas señales de oportunidades y herramientas S00. [RC-T01–04](s00/release-candidate.md): inventario/preservación, revisión conjunta, QA/build aislado y commit local. Sin push/merge/despliegue/Supabase remoto/APIs o transferencia S01; contador43 intacto. La publicación apagada y ficha de destino/imagen previa siguen siendo gates posteriores del runbook REL.

## INS-REL: guía de046 y despliegue existente — 29/10/2026

[REL-T01](s00/instantly-046-release-runbook.md) preparada: aclaración main/autodeploy cerrada, protocolo/catalogación/rollback/presupuesto y validación local. REL-T02 candidato/ficha/build, T03 aplicación SQL, T04 publicación apagada y T05 smoke permanecen pendientes de sus verificaciones/autorizaciones. No reabrir C/B o consumir remanentes;43/12 privados intactos, sin Git mutante/SQL remoto/deploy/API. No cambia ownership S01.

## INS-APP: integración offline completada — 29/10/2026

[IA-T01–04](s00/instantly-app-integration.md) completadas: contrato/ADR, extracción C/rutas/puerto, migración046/RPC/CAS/RLS, QA19 nuevos/423 regresión más aceptación general DB/TS. Recibos técnicos en la app actual con featurefalse, sin UI/negocio/worker nuevo. Source43/12 privados y410 archivos previos protegidos intactos; no despliegue, aplicación046 remota, APIs reales o credenciales cargadas. Pendientes posteriores: manifiesto/control/puente del ensayo y presupuesto actualizado, publicación/aplicación remota solo autorizadas explícitamente, C real/D/S00. S01 conserva propiedad y contratos.

## INS-C: preparación desde43 — 29/10/2026

**Actualización de implementación:** INS-C-T02 núcleo/v8/files/CLI, T03 handler/store/fixtures y T04 QA/revisión completadas offline:28 C/400 S00 y TS correctos.43 reales,12 JSON privados y20 archivos anteriores ajenos a los tres compartidos conservados; preview not_started43/new0 sin credenciales/APIs/locks. T05 endpoint HTTPS/manifiesto/control/costos y T06 ejecución real siguen pendientes, sin publicar/activar/envíos. La lista de tareas original siguiente queda como cronología de planificación.

[Paquete C](s00/instantly-phase-c.md), dentro de INS-T02/03/05 y T00-04: INS-C-T01 protocolo/ADR/12AC/presupuesto preparada; T02 core/files/CLI, T03 handler offline, T04 QA/revisión, T05 receptor HTTPS/manifiesto/control/costos y T06 ejecución/limpieza pendientes. Usuario1→A confirma ausencia de receptor público; prepararlo no autoriza publicarlo.12–14 normales, N14/R3/H2 hasta19 nuevas/62 acumuladas propuestos; las43 permanecen intactas. Solo documentación, sin código/credenciales/APIs/envíos o transferencia S01; no cerrar C/D/S00 por preparar contratos.

## INS-BR28: ejecutor desde28 implementado offline — 29/10/2026

**BR28-T04 completada:** usuario autoriza20/48 y credenciales guardadas, API incluida confirmada documentalmente y plan/capacidad reales válidos. Ejecución única **completed43**,15 nuevas/N15/R0/H0, dos leads exactos, aislamiento A/B y cierre pausado; sin envíos/verificaciones/operaciones pagas/reconfiguración de campaña. Snapshot28 y9 privados restantes preservados; auditoría/replay offline0/0/0, sin otra llamada. [Aceptación operativa B](s00/instantly-b-recovery-from-28.md). No gastar remanente5 ni limpiar leads/reiniciar automáticamente; C/D/S00 siguen abiertos. Lo siguiente conserva cierre offline anterior.

[BR28-T01/02/03](s00/instantly-b-recovery-from-28.md) completadas: contrato STRICT8 FR/AC, núcleo/estado/builder v7, files/CLI/preview,23 casos nuevos/regresión372/372/TS y preservación real28. Camino14–15, extremo N15/R3/H2=20/48 probados con mocks; cero v7 real/env/red/escrituras en preview y diez privados idénticos. T04 real pendiente de cupo incluido/confirmaciones y autorización propia20/48. No reutilizar permisos41/29 o transformar fuente para ejecutar BR antiguo; B/C/D/S00 abiertos.

## INS-SC: corrección del contrato de secuencia — 29/10/2026

[SC-T01–04](s00/instantly-sequence-contract-correction.md) completadas: revisión de esquema público/repro fallando, corrección acotada B/BR y política histórica CFD,10 casos nuevos/regresión349/349/TS, auditoría de10 archivos privados sin cambios/replay0/0/0/calls28. SC-AC01–05 cubiertos offline. No recuperación real, nuevas peticiones o cambios de campaña. Protocolo posterior de recuperación desde28 pendiente de solicitud/alcance propios; B/BR/C/D/S00 abiertos y terminal CFD no se reabre.

## INS-CFD: diagnóstico configurado implementado offline — 29/10/2026

**CFD-T04 completada:** autorización2 nuevas/29, evidencia de acceso API incluido confirmada,1 GET propio y **28 acumuladas**. Snapshot27/7 archivos privados restantes intactos; identidad/pausa válidas, proyección completada con guarda configurada false por extras en secuencia, sin reparar. Sin retry o nuevas operaciones. [Aceptación y evidencia](s00/instantly-config-diagnostic.md). Próximo bloque propuesto: revisar contrato de secuencias y probar corrección offline; B/BR/C/D/S00 siguen abiertos. La nota siguiente conserva el cierre offline anterior.

[CFD-T01/02/03](s00/instantly-config-diagnostic.md) completadas: protocolo STRICT7 FR/AC, núcleo/proyección/estado v6, files/CLI/preview y QA23 CFD/339 S00/TS. Fuente real BR failed27, ocho archivos privados y campaña intactos;0 nuevas/credenciales/APIs. CFD-T04 real pendiente de cupo incluido vigente y permiso específico de1 lectura+1 retry máximo2 nuevas/29 acumuladas. No reusar BD antiguo o saldo BR, reiniciar o migrar el ledger real por implementar offline. B/BR/C/D y S00 abiertos.

## INS-BR: recuperación B planificada — 29/10/2026

**BR-T04 ejecutada, aceptación pendiente:** permiso22/41 con fuente19, una ejecución real y8 nuevas/**27 acumuladas**,N6/R0/H2. Preflight identidad/plan/cupo/pausa/audiencia vacía correcto; PATCH propio OK, GET configured rechazado por B_UNSAFE_CAMPAIGN en stage5. Emergencia verified_paused,0 leads/envíos/verificaciones pagas. Fuente19 reconstruida idéntica,7 archivos privados restantes intactos y replay sin env/HTTP/save. [Incidente](s00/instantly-b-recovery-incident.md). Próximo incremento propuesto: diagnóstico acotado de lectura configurada con fuente27, sin ejecutar más peticiones o reabrir BR. B/C/D/S00 continúan abiertos.

**BR-T02/03 completadas offline:** usuario autorizó implementar y probar, sin APIs/cambio de campaña y preservando19. Núcleo/estado v5, helpers B compartidos, files/CLI y23 casos BR; regresión316/316 S00 y TS correctos. Preview real not_started/calls19/newCalls0, bindings válidos, env/fetch/save0/0/0 y ocho archivos operativos idénticos. BR-T04 real pendiente de permiso específico hasta22 nuevas/41 acumuladas; no reusar permisos previos ni degradar v4 para reiniciar. [Evidencia](s00/instantly-b-recovery.md). El párrafo siguiente conserva el estado anterior de planificación.

[BR-T01: protocolo/AC/ADR/presupuesto](s00/instantly-b-recovery.md) completado en planificación documental, BR-FR01–08/AC01–08. Fuente exacta19, misma campaña, preflight pausa/audiencia vacía, normal16–17 y máximo N17/R3/H2=22 nuevas/41 acumuladas propuesto. BR-T02 núcleo/estado y BR-T03 files/CLI/QA requieren solicitud posterior de implementación offline; BR-T04 real exige QA previo y permiso propio22/41. Sin llamadas/credenciales/cambio de campaña/código o migración de ledger durante planificación. No se declaran B/C/D o S00 cerrados ni se afecta S01.

## INS-OC: corrección de opcionales completada offline — 29/10/2026

[OC-T01–04](s00/instantly-optional-fields-correction.md) completadas para OC-FR01–06/AC01–06: contrato oficial, reproducción fallo→pasa, inspección sin defaults, guardas del ensayo, create/PATCH y negativos/regresión.293/293 S00 (nueve pruebas nuevas), TypeScript correcto; ocho archivos privados intactos, calls19, env/fetch/save=0 en replay real offline. El ajuste no reanuda B ni modifica la campaña. Próximo bloque: protocolo de recuperación del mismo recurso desde v4/19 y presupuesto propio, sin reutilizar techo o permisos antiguos. B/C/D y S00 continúan abiertos. Evidencia cronológica siguiente conservada.

## INS-BD: preparación, implementación y QA offline completadas — 28/10/2026

**Actualización29/10/2026 — BD-T04 completado:** autorización2/20 conservando18, un GET propio exitoso, **19 acumuladas**, sin retry/escrituras/envíos/operaciones pagas. Identidad/pausa verificadas; `ai_sdr_id`, `is_evergreen`, `stop_for_company` ausentes; resto coincide. Ledger v4 preserva failed18 e historia11/4, B sin reanudar y causa histórica no demostrada.28/28 tests BD correctos. [Resultado](s00/instantly-b-diagnostic.md). B-T04/C/D y S00 abiertos; próximo bloque propuesto: contrato de opcionales y compatibilidad/reconciliación offline, sin permiso implícito de nuevas APIs/mutaciones. El párrafo siguiente es antecedente del28/10.

[BD-T01–03](s00/instantly-b-diagnostic.md) completadas con BD-FR01–07/AC01–07: contrato/ADR, core de lectura, files/CLI/proyección y28 pruebas nuevas dentro de284/284 S00; TypeScript correcto. Preview real offline sin env/save/HTTP conserva8 archivos idénticos, fuente v3 failed18,0 nuevas y sin migración o reinicio. **BD-T04 real pendiente** de autorización específica hasta2 nuevas/20 acumuladas; B-T04/S00 siguen incompletos y causa original no demostrada. No reutilizar permiso anterior B25 o convertir una observación actual en prueba histórica.

## INS-B: ensayo real ejecutado y detenido — 28/10/2026

Autorización B25/total36 recibida y ejercida una vez. B-T04/INS-T05-B no aceptados: **failed/B_UNSAFE_CAMPAIGN,7 nuevas/18 acumuladas=N5/R0/H2**, campaña propia pausada y verificada por emergencia,0 leads/envíos/operaciones pagas. Historial11 y4 originales preservados en v3; replay offline sin HTTP/env/save y sin locks/tmp. [Incidente/diagnóstico pendiente](s00/instantly-phase-b-incident.md). No reiniciar o gastar el remanente mediante scripts paralelos. Próxima tarea: preparar y probar offline diagnóstico acotado de lectura propia conservando18; causa por campo no demostrada. C/D y S00 siguen abiertos.

## INS-B: cupo incluido acreditado; pendiente solo autorización real — 27/10/2026

Captura de Outbound/Current Plan Hyper Growth:83 posiciones libres de25.000, requiere2; renovación06/11/2026. Revisión privada y [evidencia](s00/instantly-phase-b.md) actualizadas: preparación/manifiesto y cupo documental completos, autorización/ejecución false. Consumo11 intacto y0 nuevas, sin credenciales/API/envíos. **B-T04 real pendiente de autorización específica hasta25 nuevas/36 acumuladas**, manteniendo guardas sin emisión; workspace/plan se refrescarán dentro de esa autorización. No volver a pedir confirmaciones ya registradas si nada cambia. S00 sigue abierto.

## INS-B: manifiesto privado preparado y revisado — 27/10/2026

Destinatarios controlados y exclusividad confirmados por el operador, mensaje ficticio aceptado, mapeo0/2 revisado con evidencia documental/panel; tres flags true. Último horario confirmado: **miércoles28/10/2026,21:40–21:45,America/Bogota**. Relectura/schema/binding/replay offline correctos,11 acumuladas y0 nuevas; ledger/constancia intactos, sin credenciales/API/envíos. Reporte privado vinculado al manifiesto actualizado. La preparación de datos de B-T04 está completa; B-T04 real sigue pendiente de cupo incluido vigente y autorización propia B25/total36. No repetir preguntas resueltas salvo cambios de datos. [Evidencia y límites](s00/instantly-phase-b.md).

## Incremento INS-T02-B — completado offline, 27/10/2026

[Tareas B y aceptación](s00/instantly-phase-b.md): B-T01 contrato/AC/ADR/presupuesto, B-T02 núcleo/transporte/estado y B-T03 files/CLI/fixture/QA **completados** para B-FR01–08/B-AC01–08. Evidencia:29 tests B,256/256 S00, TypeScript correcto, verificación de hashes reales fuente11/constancia sin cambios. Dependencias A/R y confirmación manual de scopes conservadas. Sin API real o envíos.

B-T04/INS-T05-B sigue **pendiente**: preparar dos emails controlados, schedule/contenido ficticio y evidencia de statusMapping, revisar manifiesto/cupo incluido y obtener autorización específica hasta25 nuevas/36 acumuladas. El intento A sobrante no habilita B. INS-T02-C/INS-T03 receiver, C/D, pendientes Supabase/TextTorrent y T00-04/S00 siguen abiertos; esta entrega no los marca terminados.

Versión 1.2 · 25 de octubre de 2026 · Estado: plan base consolidado; S00 con baseline local e inventario de proveedores; S01–S13 no iniciados.

Este plan desarrolla [spec.md](spec.md) y [design.md](design.md). Incorpora las decisiones D01–D24 de las dos rondas, sin preguntas funcionales pendientes. El usuario autorizó comenzar S00 con validaciones locales y preparación de APIs, sin producción; ver [estado de ejecución S00](s00/README.md). Los contratos externos siguen pendientes de identificar el ambiente actual autorizado y disponer de accesos seguros. El usuario decidió utilizar ese ambiente todavía sin uso, sin crear otro entorno; ver [procedimiento](s00/environment.md). El primer hito funcional de la aplicación continúa siendo D14: importar, verificar, enviar correo por Composio, recibir respuesta y revisar documentos.

Los sprints se organizan por entregables verificables, dependencias y esfuerzo relativo, conforme a D24. No se fijan fechas ni se convierten en semanas sin conocer la capacidad de desarrollo. Esfuerzo relativo: M = medio, G = grande, MG = muy grande dentro de este proyecto. Una tarea MG debe dividirse durante preparación del sprint para que cada unidad sea verificable.

## Reglas de ejecución

1. Cerrar las decisiones que afecten al sprint, sus criterios y los contratos externos antes de desarrollar el comportamiento correspondiente. Registrar cambios de requisitos antes del código.
2. Revisar AGENTS.md, guías Next instaladas y estado de Git. Conservar los cambios locales previos; no revertirlos ni incorporarlos a una entrega sin revisión.
3. Preparar y probar migraciones aditivas en base aislada/staging. Numerarlas según el último estado real del repositorio, sin asumir que 045 sigue siendo la última al implementar.
4. Cada PR entrega una parte utilizable detrás de bandera cuando corresponda, pruebas relevantes, instrucciones de activación y rollback. Push, migraciones de producción y despliegues requieren autorización explícita.
5. Pruebas simuladas no acreditan entrega real, permisos de planes ni recepción rápida. Registrar por separado evidencia local y de proveedor.
6. Las pruebas externas usarán cuentas y destinatarios controlados. Antes de mensajes, verificaciones pagas o cambios de servicios, preparar la operación concreta para autorización; este plan no la concede.
7. Un sprint se cierra por sus criterios y demostración, no por terminar una lista de archivos. Un resultado incierto de API no se resuelve repitiendo a ciegas.

## Mapa de sprints

| Sprint | Entregable principal                                                                | Dependencias de producto                                            | Esfuerzo |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| S00    | Contratos de configuración y viabilidad de integraciones documentada por capacidad. | D01–D24 confirmadas; accesos y operaciones de prueba por autorizar. | M        |
| S01    | Marcas, identidad compartida, elegibilidad independiente y modelo de estados.       | S00 para políticas de identidad/bajas.                              | G        |
| S02    | Composio integrado y migración segura por cuenta.                                   | S01 y viabilidad rápida Composio de S00.                            | G        |
| S03    | Primer piloto Excel → Bouncer → correo → conversación → documentos.                 | S01, S02.                                                           | G        |
| S04    | Navegación y vistas operativas minimalistas.                                        | S03 y mapa de estados de S01.                                       | G        |
| S05    | Campañas Instantly administradas desde CRM.                                         | S03 y contrato Instantly validado de S00.                           | G        |
| S06    | SMS TextTorrent y seguimiento alternado por lead.                                   | S01, S03, S05 para alternancia con Instantly; contrato SMS de S00.  | MG       |
| S07    | Asistente central con aprobación humana y control de conversaciones.                | S04, S06.                                                           | G        |
| S08    | Aprendizaje revisado, autonomía gradual y evaluación posterior de entrenamiento.    | S07 y D19 confirmada.                                               | G        |
| S09    | Riesgo preliminar, aplicación firmada y validación final.                           | S03, S04; reutiliza análisis existente.                             | G        |
| S10    | Aprobación humana de lenders, envío automático y seguimiento comercial.             | S02, S09.                                                           | G        |
| S11    | Estadísticas por cuenta, marca y campaña con atribución reconciliada.               | S05, S06, S10 y política D20.                                       | G        |
| S12    | Cartera fondeada, tareas de fidelización y renovación manual con evidencia.         | S10, S11 y D22 confirmada.                                          | M        |
| S13    | Aceptación integral, carga, recuperación y preparación del despliegue gradual.      | Todos los módulos del alcance acordado.                             | G        |

La viabilidad de TextTorrent o Instantly pendiente no impide entregar el piloto S03. Solo bloquea su propio sprint o las capacidades que dependen de ella. La tabla representa orden de entrega sugerido; S09 puede avanzar tras S04 sin esperar S07/S08 si se decide priorizar el circuito documental, sin asumir recursos adicionales.

## S00 Cerrar contratos y criterios de aceptación

Objetivo: convertir las decisiones confirmadas en contratos técnicos verificables y demostrar las capacidades de proveedores que condicionan la implementación. Afecta documentos SDD y el ambiente actual aún sin uso autorizado por el usuario; no exige crear otro entorno. No se modifica producción.

| Tarea  | Objetivo y requisitos                                                                                                                         | Dependencias                                                | Terminada cuando                                                                                                                                                                 | Verificación necesaria                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| T00-01 | Definir contrato de configuración y criterios verificables desde D01–D24. RF04, RF11–RF13, RF16, RF26, RF28–RF29.                             | Decisiones funcionales ya incorporadas.                     | Se especifican campos obligatorios, reglas de porcentajes/máximos/horarios, eventos significativos y matriz de piloto; los valores por campaña se configuran antes de activarla. | Revisión documental de escenarios D15–D24, defaults ausentes y límites del piloto.                                        |
| T00-02 | Inventariar el ambiente actual autorizado, migraciones, cuentas y límites de prueba. RNF01, RNF03, RNF07.                                     | Lecturas de entorno autorizadas.                            | Existe mapa de versión/migraciones y postvalidación; se registra la omisión de respaldo decidida por el usuario para este entorno de pruebas.                                    | Comparación de esquema y postvalidación; aplicación 030 autorizada, sin respaldo por decisión del usuario.                |
| T00-03 | Probar Composio con varias cuentas y recepción cercana a un minuto. RF06–RF08, RF27.                                                          | Cuenta/scope y mensajes de prueba expresamente autorizados. | Cuenta exacta seleccionada, lectura/envío/respuesta/adjunto conciliados; latencia p50/p95/máximo y costo medidos; estrategia rápida aceptada o limitación documentada.           | Contratos reales limitados; revocación/reconexión; medir recepción en buzón → CRM por separado de generación de borrador. |
| T00-04 | Verificar contrato Instantly: creación, audiencia, respuestas, programación, autenticación de eventos y detención por lead. RF09, RF12, RF13. | Plan/API y operaciones de prueba autorizadas.               | Matriz de capacidades real, IDs y mecanismo seguro de coordinación; alternativa de pasos únicos si no hay pausa individual demostrable.                                          | Timeout de creación, consulta de resultado y suspensión de un lead sin alterar toda la campaña.                           |
| T00-05 | Verificar TextTorrent: subcuenta, líneas, envío, estados, lectura paginada y límites. RF10, RF29, RF30.                                       | Plan/API y prueba SMS autorizados.                          | Contratos y cuotas comprobados; modo polling definido sin inventar webhook; costos y estados distinguen enviado/entregado.                                                       | Dos lecturas de la misma respuesta, paginación, 429/saldo/baja con simulación donde no se provoque fallo real.            |

Avance T00-02: aceptación local, compatibilidad histórica y carga persistida de 50.000 filas completadas; inventario remoto y recuperación pendientes de acceso. Evidencia en [verification.md](verification.md). Ajuste del diagnóstico offline: exigir destino identificado/acceso/autorización, sin exigir nuevas cuentas separadas ni habilitar red.

Demostración: tres fichas de viabilidad con evidencia y una política de campaña completa. Riesgo principal: contratos/planes incompatibles; la decisión de cambio se registra antes de desarrollar. Reversión: retirar recursos de prueba de forma autorizada, conservar evidencia y ninguna activación productiva.

## S01 Identidad, marcas, elegibilidad y estados

Objetivo: soportar el expediente compartido sin mezclar marca operadora con empresa cliente, y permitir leads utilizables solo por SMS.

| Tarea  | Objetivo y requisitos                                                                               | Dependencias            | Terminada cuando                                                                                                                                          | Verificación necesaria                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| T01-01 | Definir fuentes de verdad y mapa lead/contacto/empresa/proceso/marca/etapa. RF01, RF02, RF18, RF23. | T00-01.                 | Mapa aprobado distingue etapas de vistas solapables y evita avanzar oportunidad/proceso con reglas contradictorias.                                       | Casos de dos contactos/una empresa, dos procesos, oferta rechazada y cliente renovado.                                        |
| T01-02 | Añadir marcas y asociaciones de cuentas/campañas con RLS compatible. RF02, RNF01.                   | T01-01, T00-02.         | Migración aditiva y backfill auditado; rol y remitente siguen siendo permisos independientes.                                                             | PGlite con cinco roles, AAL1, acceso directo y marca no autorizada; rollback aislado.                                         |
| T01-03 | Adaptar identidad para correo opcional y elegibilidad independiente por canal. RF01, RF03, RF05.    | T01-01, T01-02.         | Lead con teléfono sin email persiste sin dirección ficticia; ambigüedad no fusiona empresas; promoción transaccional por canal válido.                    | Importación/normalización, correo inválido con SMS elegible, teléfono compartido, reimportación y contadores/RLS.             |
| T01-04 | Unificar bajas globales del grupo y guardas de despacho preservando bajas antiguas. RF29, RNF02.    | D18 confirmada, T01-03. | Ninguna marca/canal/proveedor despacha prospección tras una baja; se cancelan pendientes y borradores y se alerta si no se sincroniza un bloqueo externo. | Baja por email o SMS, dos marcas, borrador aprobado, antes de reserva/envío, reimportación y compatibilidad con suppressions. |

Componentes: migraciones nuevas, `domain.ts`, preparación/importación y funciones de campañas. Demostración: un lead solo email, uno solo SMS y otro bloqueado, con visibilidad correcta para cada rol. Riesgo/rollback: contactos sin email no son compatibles automáticamente con binarios antiguos; usar lectura compatible y preservar restricciones anteriores hasta tener sustitución probada.

## S02 Transporte Composio y continuidad del correo

Objetivo: centralizar conexión y autorización de buzones manteniendo el CRM y sus mensajes existentes.

| Tarea  | Objetivo y requisitos                                                                 | Dependencias                         | Terminada cuando                                                                                                                                         | Verificación necesaria                                                                                                 |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T02-01 | Separar transporte Gmail de reglas de correo y añadir adaptador Composio. RF07, RF27. | T00-03, T01-02.                      | Mismos comandos usan adaptador seleccionado explícitamente; permisos/cuotas siguen fuera del transporte y no se extraen tokens del proveedor al cliente. | Contratos con servicios simulados: envío, lectura, MIME, adjuntos, firma y Message-ID; regresiones actuales de mail.   |
| T02-02 | Implementar conexión, mapeo, estado y permisos por cuenta. RF02, RF06.                | T02-01.                              | Conectar/reconectar verifica el buzón exacto, conserva ID interno y permite pausar; reconectar no reactiva envíos.                                       | Callback incorrecto/repetido, cuenta equivocada, revocación, usuario sin permiso y scopes insuficientes.               |
| T02-03 | Implementar recepción rápida y reconciliación durable. RF08, RF13, RF27, RF30.        | T02-02 y estrategia validada T00-03. | Eventos persisten antes de procesar, checkpoint avanza sin perder páginas; historial expirado recuperable; demoras visibles.                             | Evento repetido/desordenado/perdido, recuperación de cursor, worker reiniciado y medición real de latencia controlada. |
| T02-04 | Implementar corte gradual por cuenta y único escritor. RF27, RNF07.                   | T02-03.                              | Historial/IDs/documentos se preservan; cuenta migra y puede volver a conector compatible sin duplicar intentos inciertos.                                | Antes/después de conteos y hashes, lectura dual, deduplicación por identidad y simulación de rollback.                 |

Componentes: `server/google.ts`, servicios mail, rutas Gmail/integraciones, worker Gmail/histórico y Configuración. Demostración: dos cuentas de marcas distintas, respuesta y adjunto conservados tras cambio de conector. Riesgo: selector erróneo o doble despacho; rollback pausa primero y transfiere explícitamente el rol de escritor.

## S03 Primer piloto completo de correo

Objetivo: entregar el recorrido D14 usando confirmaciones separadas, sin depender de SMS o Instantly.

| Tarea  | Objetivo y requisitos                                                                                       | Dependencias                                | Terminada cuando                                                                                                                                                                               | Verificación necesaria                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T03-01 | Ajustar asistente de importación y revisión de leads. RF03–RF05.                                            | S01.                                        | Mapeo, vista previa, informe y estados por canal funcionan; importar no verifica ni envía.                                                                                                     | CSV/XLSX, hojas, duplicados, filas solo teléfono y error técnico de Bouncer; reinicio en bloque.                                                                |
| T03-02 | Conectar confirmación de verificación y revisión de audiencia. RF04, RF05, RF29.                            | T03-01.                                     | Selección revisada se conserva por versión y una confirmación repetida no cobra ni inscribe dos veces.                                                                                         | Resultados valid/invalid/uncertain/technical_error; selección/filtros y clave repetida.                                                                         |
| T03-03 | Entregar correo humano y modo explícito de secuencia personal Composio con guardas. RF04, RF07, RF11, RF13. | S02, T03-02; hallazgo S00 de migración 043. | Primer contacto conserva su default actual; una secuencia personal requiere selección explícita y confirmación, permite pasos sin que el comando los descarte y respeta cuotas/respuesta/baja. | Crear primer contacto y secuencia opt-in por APIs autorizadas, preservar campaña histórica, revisar fixture desactualizado y conciliar timeout sin doble envío. |
| T03-04 | Recorrer respuesta y documento de extremo a extremo. RF08, RF14, RF17.                                      | T03-03.                                     | AC01, AC03–AC05 y AC18 tienen evidencia; mensaje en expediente correcto y adjunto incorporado una vez con revisión exacta.                                                                     | E2E local simulado y piloto autorizado con destinatario de prueba; permisos y latencia reales por separado.                                                     |

Demostración de cierre: cargar muestra ficticia, confirmar cada paso, enviar correo autorizado, responder, detener seguimiento e incorporar documento. Riesgo: confundir prueba simulada con integración real; conservar ambas evidencias. Rollback: bandera por cuenta/campaña, pausando pendientes y preservando histórico.

## S04 Navegación y operación minimalista

Objetivo: aplicar el lenguaje de interacción del mockup final a funciones reales y conservar Conversaciones.

| Tarea  | Objetivo y requisitos                                                      | Dependencias | Terminada cuando                                                                                                                                          | Verificación necesaria                                                                                                      |
| ------ | -------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| T04-01 | Definir navegación, tokens, jerarquía y campos por vista. RF23, RF24.      | T01-01, S03. | Inicio/tareas/campañas/conversaciones/expedientes/clientes/indicadores accesibles; lenders/configuración según rol; sin datos ficticios en vistas reales. | Revisión de correspondencia mockup → función existente; foco, contraste, ES/EN y estados de carga/error.                    |
| T04-02 | Entregar panel de expediente y vistas por próxima acción. RF01, RF21–RF24. | T04-01.      | Lista conserva filtros al abrir/cerrar; falta oferta y ofertas pueden coexistir; documentos, riesgo y lenders abren el contexto correcto.                 | Casos de solapamiento, paginación real, navegación atrás, móvil y teclado.                                                  |
| T04-03 | Mantener Conversaciones y adaptar puntos de entrada. RF14, RF24.           | T04-02.      | Historial, adjuntos, respuesta, borradores y selección de cuenta continúan funcionando desde las nuevas vistas.                                           | Suites actuales de conversaciones/mail, rol seller/closer, borrador sin guardar y revisión visual escritorio/tableta/móvil. |

Componentes: `crm.tsx`, `opportunity-detail.tsx`, dashboards/tablas y CSS; extraer piezas solo donde reduzca acoplamiento. Demostración: encontrar una tarea, abrir expediente, volver y responder sin perder filtros. Riesgo: regresión de navegación/borradores; rollback mediante bandera de experiencia manteniendo las mismas APIs y datos.

## S05 Campañas Instantly desde el CRM

Objetivo: publicar y controlar campañas manteniendo identidad, audiencia y registro internos.

| Tarea  | Objetivo y requisitos                                                                 | Dependencias    | Terminada cuando                                                                                                                            | Verificación necesaria                                                                                 |
| ------ | ------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| T05-01 | Integrar workspace/cuentas y publicar borradores/versiones de campaña. RF06, RF09.    | T00-04, T03-02. | CRM crea campaña y audiencia con IDs estables, revisión previa y conciliación de creación incierta.                                         | Contrato de creación/paginación, timeout antes/después de creación y permisos del plan.                |
| T05-02 | Añadir programación, activación, pausa y control del lead. RF09, RF11–RF13, RF29.     | T05-01.         | Ningún paso futuro compite con la coordinación CRM; detención individual probada o estrategia de pasos únicos documentada.                  | Activación repetida, parada por respuesta/baja, cambio externo y cuota compartida con correo personal. |
| T05-03 | Ingerir respuestas/eventos y reconciliar observaciones Gmail. RF13, RF14, RF25, RF27. | T05-02, T02-03. | Una respuesta genera un hecho canónico aunque llegue por dos fuentes; eventos sin autenticidad suficiente no ordenan mutaciones confiables. | Replay, orden inverso, mismo email observado por Instantly/Composio y asociación ambigua.              |
| T05-04 | Entregar panel de campaña con resultados y discrepancias. RF09, RF25, RF30.           | T05-03.         | Se ven audiencia, progreso, fallos, última sincronización y enlace externo; ninguna cifra local se presenta como dato remoto no obtenido.   | Denominadores y páginas, actividad externa, fallos parciales y estados sin sincronización.             |

Demostración: crear, revisar, programar, pausar y consultar una campaña controlada desde CRM. Riesgo/rollback: pausar ejecución externa además de la bandera local; deshabilitar la UI no detiene una campaña que ya corre en el proveedor.

## S06 SMS y alternancia de canales por lead

Objetivo: guardar la distribución del Excel y coordinar seguimientos entre canales, cuentas y marcas.

| Tarea  | Objetivo y requisitos                                                                                                 | Dependencias                                             | Terminada cuando                                                                                                                                                       | Verificación necesaria                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| T06-01 | Implementar líneas/subcuentas, permisos y adaptador TextTorrent. RF02, RF05, RF10.                                    | T00-05, S01.                                             | Cada envío identifica línea y marca; saldo/capacidad/elegibilidad se comprueban y errores permanentes se distinguen de temporales.                                     | Contratos simulados/reales autorizados, número inválido, saldo, cuota, línea inactiva y permisos.                              |
| T06-02 | Incorporar recepción y conversaciones SMS idempotentes. RF10, RF13, RF14.                                             | T06-01.                                                  | Relectura/paginación conserva una respuesta y estado con timestamps del proveedor; no inventa IDs Gmail.                                                               | Polling repetido, estado tardío, mensajes fuera de orden, adjuntos/MMS si quedan en alcance y recuperación tras caída.         |
| T06-03 | Persistir distribución por porcentajes/filtros revisados y coordinador de intentos. RF11, RF12, RF29.                 | D15–D18 confirmadas, T06-02, T03-03; S05 para Instantly. | Una asignación inicial por lead, redondeo determinista, conflictos visibles y lease/fencing; frecuencia/máximo coordinados entre marcas sin reiniciarse al reimportar. | 100 leads al 60/40, conflictos de filtros, dos workers/marcas, replay, cambio de elegibilidad y lead sin segundo canal.        |
| T06-04 | Entregar alternancia de 48 h sin respuesta y seguimiento documental de 24 h con límites/derivación. RF12, RF13, RF23. | T06-03, D16 y D17 confirmadas.                           | Vencimiento en próxima ventana permitida, pausa al máximo y derivación humana documental; responder o esperar al equipo suspende recordatorios.                        | Reloj controlado de 48/24 h, ventanas/fines de semana, máximo incluyendo primer contacto, auto reply, baja y mensaje en vuelo. |

Demostración: lote con ambas asignaciones, vencimiento simulado, cambio de canal y una respuesta que cancela el siguiente paso. Riesgo: contactos duplicados o secuencias externas autónomas; la coordinación central debe estar activa antes de sustituir el índice de secuencia única. Rollback: pausa de journeys y proveedor externo, no reinicio de campañas.

## S07 Asistente central supervisado

Objetivo: atender preguntas habituales y solicitar documentos desde correo/SMS, con aprobación humana inicial.

| Tarea  | Objetivo y requisitos                                                                                  | Dependencias    | Terminada cuando                                                                                                              | Verificación necesaria                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| T07-01 | Definir categorías, conocimiento permitido y contexto por marca/proceso/rol. RF13, RF15, RNF01, RNF08. | S06.            | Fuentes autorizadas y datos faltantes explícitos; negociación/condiciones vinculantes derivadas a personas.                   | Casos de marca equivocada, datos de otro cliente, fase closer, instrucciones maliciosas y preguntas fuera del conocimiento. |
| T07-02 | Implementar borradores, revisión y control humano. RF15, RF30.                                         | T07-01.         | Aprobar/editar/rechazar guarda actor y hash; takeover detiene el asistente; nuevo contexto invalida aprobación.               | Dos revisores, respuesta nueva después de aprobación, baja, cambio de identidad y borrador vencido.                         |
| T07-03 | Despachar aprobados mediante coordinador y mostrar consumo. RF11, RF15, RF30.                          | T07-02, T06-03. | Asistente no puede enviar fuera del coordinador; presupuesto separado y fallos visibles sin perder borrador.                  | Doble clic, timeout incierto, presupuesto agotado, reintento y reserva de cuota compartida.                                 |
| T07-04 | Probar conversación documental multicanal supervisada. RF14, RF15, RF17.                               | T07-03.         | Pregunta → borrador → aprobación → respuesta y solicitud documental, sin declarar recibido/aprobado un documento inexistente. | E2E simulado y muestra controlada autorizada con trazabilidad a la fuente.                                                  |

Demostración: mismo cliente en correo/SMS, identidad correcta, respuesta aprobada y solicitud de documento faltante. Riesgo/rollback: bandera de asistente por ámbito y control humano; no afecta la capacidad de responder manualmente.

## S08 Aprendizaje revisado y autonomía gradual

Objetivo: reducir aprobaciones con evidencia, manteniendo autorización explícita y retorno a supervisión.

| Tarea  | Objetivo y requisitos                                                               | Dependencias                            | Terminada cuando                                                                                                                                                                                                        | Verificación necesaria                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T08-01 | Registrar ejemplos aprobados/corregidos y motivos con minimización. RF16, RNF08.    | D19, S07.                               | Banco revisable con fuente, permisos, versión y retención; mensajes rechazados no se usan como respuesta correcta.                                                                                                      | Aislamiento por marca/rol, corrección humana prevalente, ejemplo retirado y datos innecesarios excluidos.                                                             |
| T08-02 | Crear evaluación separada por categoría y versión. RF16.                            | T08-01.                                 | Casos reservados y métricas de calidad/edición/derivación; conjunto de seguridad bloquea liberación ante permisos/bajas o filtraciones fallidas.                                                                        | Repetición de evaluación, revisión humana y casos de frontera; no usar autoevaluación del modelo como única evidencia.                                                |
| T08-03 | Añadir autorización gradual y reversión por administrador. RF16, RF29, RF30.        | T08-02.                                 | Administrador habilita categorías concretas tras evaluación; una versión nueva no hereda autonomía incompatible; kill switch ensayado.                                                                                  | Cambio de política, incidente, permiso revocado, regresión y vuelta inmediata a revisión.                                                                             |
| T08-04 | Evaluar posteriormente entrenamiento específico con conjunto revisado. RF16, RNF08. | T08-01, T08-02, T08-03, D19 confirmada. | Documento de viabilidad compara enfoque actual y alternativa de entrenamiento: datos aptos, calidad esperada/medida, privacidad, costo, evaluación reservada y recomendación de entrenar o no. No inicia entrenamiento. | Auditoría de partición/datos, diseño de benchmark y comparación real solo si existe candidato autorizado; señalar mediciones no disponibles y no inventar resultados. |

Demostración: una categoría validada pasa de borrador a autonomía acotada; otra sigue supervisada; un cambio revoca el permiso. Riesgo: optimizar aprobación en vez de calidad; conservar evaluación humana y muestras separadas. D19 incluye T08-04 como evaluación posterior. Entrenar realmente requiere una decisión posterior con conjunto apto, permisos y presupuesto; no es requisito para entregar el asistente inicial.

## S09 Riesgo preliminar y aplicación final

Objetivo: permitir el orden D11 sin debilitar el control documental y la revisión antes de lenders.

| Tarea  | Objetivo y requisitos                                                                | Dependencias      | Terminada cuando                                                                                                            | Verificación necesaria                                                                        |
| ------ | ------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| T09-01 | Añadir propósito preliminar y suficiencia de fuentes al análisis actual. RF17, RF18. | S03, mapa T01-01. | Puede analizar fuentes aprobadas sin aplicación firmada; muestra faltantes y nunca satisface por sí mismo el handoff/envío. | Aplicación ausente, fuentes incompletas, PDF ilegible, resultado incierto y cambio de hash.   |
| T09-02 | Ajustar aplicación, firma y revisión final por proceso. RF18, RF19.                  | T09-01.           | Datos extraídos editables, firma y declaraciones existentes validadas; ejecutar/revisar final exige paquete vigente.        | Borrador sin firma, doble presentación, corrección posterior y dos procesos de un cliente.    |
| T09-03 | Integrar recomendaciones y congelación de paquete revisado. RF19, RF20.              | T09-02.           | Snapshot conserva fuentes, aplicación, análisis final y guidelines; cambios invalidan solo aprobaciones futuras afectadas.  | Guidelines nuevas, documento sustituido, análisis desactualizado y revisión humana requerida. |

Demostración: documentos → preliminar → completar/firmar → final aprobado → paquete disponible, con bloqueos visibles antes de completar. Riesgo/rollback: conservar rutas actuales de análisis final y no reclasificar informes antiguos como preliminares por inferencia.

## S10 Lenders, ofertas, contratos y fondeo

Objetivo: convertir la aprobación humana de análisis/destinatarios en envíos y tareas automáticos con resultados independientes.

| Tarea  | Objetivo y requisitos                                                                              | Dependencias                 | Terminada cuando                                                                                                                        | Verificación necesaria                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| T10-01 | Implementar aprobación de lote y envío por lender. RF19, RF20.                                     | S02, S09.                    | Aprobador ve destinatarios/documentos exactos; cada solicitud tiene clave y snapshot; portal sin API queda como tarea/evidencia manual. | Dos lenders, repetición de aprobación, permiso insuficiente, cambio de paquete y canal portal.                |
| T10-02 | Recuperar respuestas y programar seguimiento por solicitud. RF20, RF21, RF23.                      | T10-01.                      | Pendientes, declinaciones, requisitos y ofertas tienen evidencia; fallos parciales no duplican envíos correctos.                        | Un éxito/un fallo/un incierto, respuesta en hilo nuevo, dos contactos del mismo lender y seguimiento vencido. |
| T10-03 | Comparar ofertas por ajuste de monto/plazo, costo y requisitos con confirmación humana. RF21–RF23. | D21 confirmada, T10-02, S04. | Recomendación explica sus razones y faltantes; el closer confirma; rechazo permite buscar otra oferta sin borrar las existentes.        | Mayor monto con peor ajuste/costo, datos no comparables, oferta vencida, requisitos distintos y dos procesos. |
| T10-04 | Integrar contratos y fondeo con evidencia y control humano. RF22, RF28.                            | T10-03.                      | Solicitud/envío/firma/aceptación/fondeo siguen diferenciados; monto efectivo y fecha no se inventan.                                    | Contrato firmado sin desembolso, declinación tardía, fondeo repetido y permisos seller/closer.                |

Demostración: aprobar paquete y dos lenders, ver respuestas distintas, comparar oferta, registrar contratos y confirmar fondeo ficticio. Riesgo/rollback: no deshacer un correo enviado ni perder su paquete; pausar siguientes solicitudes y revisar resultados inciertos.

## S11 Estadísticas y atribución verificable

Objetivo: controlar resultados por cuenta/línea, marca, campaña, plantilla y responsable sin duplicar conversiones.

| Tarea  | Objetivo y requisitos                                                                          | Dependencias                   | Terminada cuando                                                                                                                                     | Verificación necesaria                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| T11-01 | Cerrar diccionario de métricas y atribución por última interacción significativa. RF25, RF26.  | D20 confirmada, S05, S06, S10. | Cada cifra tiene unidad/fuente/denominador; catálogo significativo versionado, snapshot de ganador, participaciones completas y fondeo global único. | Dos marcas/canales, última respuesta válida, apertura/auto reply excluidos, evento tardío/posterior y desempate estable. |
| T11-02 | Implementar agregación autorizada y reconciliación de fuentes. RF25–RF27.                      | T11-01.                        | Totales se calculan antes de paginar; datos incompletos se señalan; observaciones múltiples no duplican mensajes/resultados.                         | Más de una página, distintas ventanas de fecha, RLS y evento tardío; conciliación de datos históricos ambiguos.          |
| T11-03 | Entregar paneles de cuentas/campañas, consumo y recomendaciones explicables. RF25, RF26, RF30. | T11-02.                        | Se ven actividad, sincronización, cuota/costo disponible, aplicaciones/ofertas/deals y cobertura; recomendaciones señalan muestra y fuentes.         | Sin datos, proveedor caído, presupuesto agotado, ES/EN, filtros y tasa con denominador cero.                             |

Demostración: un cliente tocado por dos marcas/canales, una aplicación y un fondeo global, con participaciones visibles. Riesgo/rollback: cifras infladas o fuentes incompletas; conservar eventos y volver a métricas anteriores sin borrar evidencia nueva.

## S12 Fidelización y renovaciones

Objetivo: mantener relación con clientes fondeados y preparar otra financiación sin sobrescribir la anterior.

| Tarea  | Objetivo y requisitos                                                           | Dependencias         | Terminada cuando                                                                                                                      | Verificación necesaria                                                                                                |
| ------ | ------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| T12-01 | Entregar cartera y tareas internas de fidelización. RF23, RF28, RF29.           | D22 confirmada, S10. | Cliente conserva fondeo/histórico y próxima tarea interna; baja visible sin que crear tarea envíe mensajes.                           | Recordatorio repetido, cliente sin fecha verificable, baja global, zona horaria y permiso insuficiente.               |
| T12-02 | Registrar manualmente porcentaje pagado y renovación con evidencia. RF28, RF30. | T12-01.              | Datos guardan fuente/fecha/autor y correcciones; no se estiman pagos ni se añade integración o mensajería automática de fidelización. | Dato ausente, valor fuera de rango, fuente faltante, corrección auditada y cero despachos generados por recordatorio. |
| T12-03 | Crear renovación como nuevo proceso y medir continuidad. RF01, RF26, RF28.      | T12-02, S11.         | Nuevo proceso separado, documentos revisados para vigencia y fondeo anterior inalterado.                                              | Renovación repetida, porcentaje no confirmado y dos procesos activos.                                                 |

Demostración: cliente fondeado recibe una tarea interna, se registra manualmente evidencia de pagos y se abre una nueva solicitud. No se envían mensajes automáticos de fidelización. Riesgo: porcentaje pagado inferido sin fuente; mantener dato desconocido y revisión. Rollback: pausar automatizaciones, conservar cartera y evidencia.

## S13 Aceptación integral y preparación de producción

Objetivo: comprobar el sistema completo y preparar un despliegue gradual revisable; producción permanece sujeta a autorización.

| Tarea  | Objetivo y requisitos                                                                                  | Dependencias                  | Terminada cuando                                                                                                                                                      | Verificación necesaria                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| T13-01 | Ejecutar regresión de módulos modificados y permisos completos. AC01–AC28, RNF01/RNF05.                | S01–S12 del alcance definido. | Evidencia de cada criterio y fallos abiertos; ningún criterio crítico se marca aprobado sin prueba.                                                                   | Suites dominio/SQL, cinco roles/MFA, acceso directo API/Storage y E2E del recorrido completo.                                     |
| T13-02 | Probar piloto limitado, carga sintética, concurrencia, costo y recuperación. RNF02–RNF04, RNF06/RNF08. | D23 confirmada, T13-01.       | Piloto 1 marca/2 buzones/1 línea/500 leads; importación sintética de 50.000 filas aislada de envíos/verificaciones pagas; workers sin doble intento y costos medidos. | Reinicio en bloque/envío, 429, pérdida de respuesta, revocación, backlog, checkpoint expirado y eventos repetidos/desordenados.   |
| T13-03 | Ensayar migración, backup/restauración y rollback por cohorte. RF27, RNF07.                            | T13-02.                       | Restauración comprobada en staging; conectores migran con un escritor y contactos sin email siguen legibles.                                                          | Cambio de bandera, transferencia de escritor, relectura histórica, suspensión de campañas externas y reconciliación de inciertos. |
| T13-04 | Preparar paquete de liberación y secuencia de activación. RNF01–RNF08.                                 | T13-03.                       | Migraciones pendientes identificadas, runbook, observabilidad, responsables y rollback revisables; aprobación productiva solicitada solo con evidencia concreta.      | Checklist de configuración sin secretos, validación staging, ventanas/umbrales acordados y prueba de smoke prevista.              |

Demostración: recorrido completo con datos ficticios y recuperación de una interrupción; dossier de aceptación y activación por cohortes. La ejecución de despliegue, migraciones remotas, cambios de infraestructura y mensajes de producción queda fuera de esta fase de planificación y requiere autorización explícita.

## Matriz de trazabilidad resumida

| Requisitos                                  | Sprints de implementación y verificación |
| ------------------------------------------- | ---------------------------------------- |
| RF01–RF02 Identidad, marcas y permisos      | S01, S02, S04, S12, S13                  |
| RF03–RF05 Importación y elegibilidad        | S01, S03, S06, S13                       |
| RF06–RF08 Cuentas y Composio rápido         | S00, S02, S03, S13                       |
| RF09 Instantly                              | S00, S05, S06, S11, S13                  |
| RF10 TextTorrent                            | S00, S06, S07, S13                       |
| RF11–RF13 Intentos, alternancia y respuesta | S03, S05, S06, S07, S13                  |
| RF14 Conversaciones                         | S02–S07, S13                             |
| RF15–RF16 Asistente y aprendizaje           | S07, S08, S13                            |
| RF17–RF18 Documentos, riesgo y aplicación   | S03, S09, S13                            |
| RF19–RF22 Lenders, ofertas y fondeo         | S09, S10, S13                            |
| RF23–RF24 Tareas y experiencia              | S04, S06, S10, S12, S13                  |
| RF25–RF27 Métricas y continuidad            | S02, S05, S06, S11, S13                  |
| RF28 Fidelización                           | S10, S12, S13                            |
| RF29–RF30 Bajas y observabilidad            | S00–S03, S05–S08, S11–S13                |

## Verificaciones de cada entrega

Ejecutar las comprobaciones proporcionales a los cambios y los controles requeridos por el repositorio:

- `pnpm test`: suites unitarias e integración simulada pertinentes; ejecución completa antes de hitos que afecten flujos compartidos.
- `pnpm test:db`: políticas, constraints, funciones, migraciones, idempotencia y rollback en Postgres embebido; no equivale a probar Supabase Auth/Storage real.
- `pnpm test:load`: importación sintética y recuperación cuando cambie importación/modelo o se dimensione la liberación.
- `pnpm typecheck` y `pnpm build`: contratos TypeScript, rutas y compilación con Node/pnpm fijados.
- No existe script de lint en el manifiesto actual. Utilizar formato/checks disponibles sin afirmar haber ejecutado lint inexistente.
- Validación navegador con datos ficticios: ES/EN, escritorio/tableta/móvil, teclado/foco, estados de error/vacío y conservación de borradores.
- Contratos externos y piloto real por separado, registrando autorización, muestra, destinatarios de prueba y qué capacidades quedaron sin comprobar. Nunca registrar secretos ni datos de clientes como evidencia de prueba.

Cada entrega informa archivos modificados, requisitos cubiertos, pruebas realmente ejecutadas, fallos, limitaciones y siguiente acción. Build verde por sí solo no satisface recepción, envío real ni coordinación de proveedores.

## Estado actual

Los tres documentos SDD incorporan las 24 decisiones confirmadas. El plan conserva 14 sprints y 53 tareas por entregables, sin fechas comprometidas. S00 cuenta con contrato e inventario offline, pruebas locales y un informe de hallazgos; su estado por T00-01–T00-05 se mantiene en [S00](s00/README.md). Las configuraciones reales se completarán antes de activar campañas. Las pruebas de proveedores, staging y latencia no se consideran realizadas por disponer de una herramienta local. S00 no está cerrado y S01–S13 no se han iniciado.

## Subtareas de comprobación S00 de conexiones

El [paquete de conexiones](s00/connections.md) desglosa S00-C-T01–S00-C-T04 dentro de T00-03–T00-05: contrato, comprobador, pruebas negativas y ejecución real. Contrato/comprobador/tests locales terminados; consulta real realizada tras la excepción autorizada: Composio 401 por asignación incorrecta del campo de API key; Instantly/TextTorrent pendientes de campos guardados con contenido. Ver [resultado](verification.md). Las 53 tareas principales del plan conservan sus IDs.

## Actualización de avance S00: 25 de octubre, inventario

Las descripciones históricas de falta de accesos se sustituyen por este estado: autenticación positiva de las tres integraciones; [inventario real](s00/inventory.md) de metadatos y [ensayo Composio preparado](s00/composio-test-plan.md), sin ejecutar.

| Tarea  | Avance vigente                                                                                                            | Falta para cerrar                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00-02 | 45 migraciones locales continuas, catálogo probado en PGlite; inventario de cuentas/límites completado.                   | Ausencia de objetos de 030 confirmada y aplicación tardía ensayada localmente. 030 aplicada por el usuario y catálogo puntual posterior correcto. Quedan límites de comparación de definiciones/grants y smoke funcional remoto; respaldo omitido por decisión del usuario, ledger no disponible. |
| T00-03 | Dos buzones: PDF, recepción automática25.078/21.757ms y reconexión M1 original mediante C11/92; M2 e histórico correctos. | Integración/recepción CRM en S02/S03; N=2 no certifica SLA/p95 poblacional. Uso Instant0 es indicador limitado, sin auditoría global de costos.                                                                                                                                                   |
| T00-04 | Workspace, plan outreach 25.000 y 32 cuentas inventariados.                                                               | Scopes exactos de clave actual y operaciones de campaña ficticia, eventos y detención por lead.                                                                                                                                                                                                   |
| T00-05 | Seis subcuentas más administradora y 12 líneas contadas por propietario.                                                  | Ocho capacidades desconocidas, permisos efectivos/saldo/precios; prueba SMS autorizada y gasto acotado.                                                                                                                                                                                           |

Subtareas S00-I-T01: parte local completa/remoto pendiente; S00-I-T02: inventario ejecutado con desconocidos explícitos; S00-I-T03: plan y PDF preparados; S00-I-T04: evidencia actualizada. Ver requisitos y aceptación en [inventory.md](s00/inventory.md). S00 continúa abierto; no se marca ninguna capacidad operativa como comprobada por lectura de metadatos.

## Ejecutor API Composio: avance S00-R

| Tarea     | Requisitos | Implementación y evidencia                                                           | Pendiente                                                                              |
| --------- | ---------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| S00-R-T01 | FR01, FR04 | Metadatos, perfiles efectivos y permiso proxy de dos buzones comprobados.            | Cuota Hobby revisada mediante capturas; límites de precisión del uso API documentados. |
| S00-R-T02 | FR02       | MIME y reserva persistente contra duplicados implementados; replay/timeout probados. | Cuatro mensajes API aceptados; no duplicados en replay del estado real.                |
| S00-R-T03 | FR03, FR04 | Hilos exactos, ACK/token/PDF/hash y confirmación probados con fixtures.              | Dos respuestas y cuatro PDF reales verificados por bytes; sin comparar hash de origen. |
| S00-R-T04 | FR05       | CLI offline, lock/journal; ejecutor 22/22, S00 60/60 y TypeScript correctos.         | Circuito Gmail completado; recepción automática/latencia y reconexión pendientes.      |

No se carga .env.local ni se inicia un worker. La autorización de correo ya existe y no se vuelve a pedir por rutina.

### Estado posterior a las capturas: S00-R-FR06

Cuota del plan Hobby y uso de siete días revisados. La primera operación Gmail se detuvo con 403 de permiso proxy; no hubo correos enviados. La revalidación con otra clave del mismo proyecto queda protegida sin cambiar destino/token/contador ni permitir reset de intentos. Dos nuevas pruebas; S00 54/54 y TypeScript correcto. S00-R-T01 requiere clave con Proxy execute Write only; S00-R-T02/03 siguen sin aceptación real. No está pendiente otra aprobación genérica de envíos ni un upgrade del plan.

### Composio: revalidación y envíos iniciales reales correctos

S00-R-T01: nueva clave, metadatos y dos perfiles efectivos comprobados con destino original. S00-R-T02: un correo inicial aceptado por Gmail en cada buzón; se conserva el run (15/32 llamadas), sin duplicados. S00-R-T03: pendiente de dos respuestas humanas con ACK/PDF, lectura y hash, y confirmación del hilo. El envío aceptado no acredita entrega, recepción por CRM o latencia. No se repite otra autorización genérica de correo y no se modifica la app.

### Composio: dos respuestas observadas, discrepancia de fixture

S00-R-T03: una respuesta del destinatario en cada hilo tiene evidencia real. Falta el texto ACK y cada respuesta lleva dos PDF diferentes del fixture; se solicita decidir alcance antes de descargarlos. Confirmaciones no enviadas, contador 20/32 preservado. Suite del ejecutor 17/17 y TypeScript correctos tras añadir caso negativo de PDFs distintos/texto citado. No se acredita aún integridad del adjunto, latencia o cierre de T00-03.

### Composio: circuito funcional completado, S00-R-T05

S00-R-FR07/AC07 y S00-R-T05 completados en el alcance autorizado: política de PDF propios implementada, 60/60 tests y TypeScript correctos; ejecución real de cuatro PDF sin analizar contenido y dos confirmaciones verificadas. El mismo run termina en 37/40 peticiones acumuladas: 33 del ejecutor y cuatro diagnósticos anteriores. S00-R-T02 y T03 tienen evidencia funcional real del transporte por dos cuentas; no certifican latencia automática o CRM. T00-03 sigue parcial por recepción automática/latencia y revocación/reconexión; no se cierra S00 general ni se activan otros proveedores.

### S00-A: siguiente bloque de T00-03, preparado el 26 de octubre

[Protocolo y matriz de tareas](s00/composio-auto-receive.md): S00-A-T01 (plan) preparado; S00-A-T02 implementación opt-in, T03 pruebas offline, T04 observación real y T05 consolidación, pendientes. Cada tarea referencia FR/AC, dependencias, definición de terminado y pruebas. La entrega actual solo cubre T01. Antes de T04, validar T02/T03 y presupuesto/cuota/ejecución: 13–35 nuevas, reserva cinco, máximo 40 nuevas y 77 acumuladas propuestas; no autorizadas por este documento. Sin envíos API ni lectura de adjuntos. No declara completados recepción CRM, revocación/reconexión o cierre S00.

### S00-A: T02 y T03 completados offline, 26 de octubre

Implementados observador, CLI/persistencia y helpers comunes. S00-A-T02/T03 terminados con **35/35 pruebas nuevas y 95/95 S00**, fetch ambiental bloqueado, sin credenciales reales; A-AC01–10 tienen evidencia local trazada en [verification](verification.md). La ejecución con servicios reales S00-A-T04 y consolidación operativa T05 siguen pendientes; no consumir las tres consultas restantes como un ensayo parcial. [Uso offline y archivos](s00/composio-observer.md).

### S00-A-T04/T05: ensayo real y consolidación completados

Usuario autorizó40 adicionales/77 acumuladas. M1=25.078ms, M2=21.757ms, dos eventos y dos relecturas sin duplicados. 23 nuevas/60 acumuladas, cero retries, proceso terminado y17 consultas autorizadas sin usar. T04/T05 completados; [evidencia operativa](verification.md). T00-03 parcial por revocación/reconexión; no se afirma integración CRM. Pruebas negativas permanecen offline y no se cierra S00.

### S00-B: protocolo de revocación/reconexión preparado

[Plan S00-B](s00/composio-reconnect.md): T01 preparado (contrato, presupuesto, gates y diez AC); T02 implementación acotada, T03 tests offline, T04 ejecución real y T05 consolidación pendientes. Objetivo propuesto M1, M2 control; sin llamadas actuales. 18–21 nuevas normalmente, máximo28 con R3/H4 protegidas, base60/techo propuesto88. El saldo17 de S00-A no se reutiliza como permiso de mutación. La prueba requiere consentimiento OAuth humano y comprobar previamente permisos de gestión de conexiones; la lectura/proxy anteriores no lo acreditan. T00-03 sigue parcial, no se cierra S00.

### S00-B-T02/T03: implementados y probados sin conexión

Core/CLI/persistencia de reconexión M1 terminados offline: **45/45 tests nuevos, 140/140 S00 y TypeScript correctos**. Se verifica máximo28/88, M2 con propietario compartido, fuente60 inmutable, no duplicación de POST ante crash/timeout, TTL/identidad/histórico y H4 protegida. [Uso](s00/composio-reconnect-runner.md) y [evidencia](verification.md). T04 real y T05 operativo siguen pendientes; no se revocó ninguna cuenta, no se cargó env real ni se amplió el presupuesto real.

### S00-B-T04: intento real detenido por identidad, 26 de octubre

Autorización real28 nuevas/88 acumuladas. Clave nueva y link201 comprobaron gestión antes de una única revocación M1; GET REVOKED, rechazo de conexión antigua y control M2 acreditados. Manejo específico de HTTP422 de cuenta revocada corregido con regresiones. Primer enlace vencido por problema de entrega local; segundo enlace autorizado por el operador. Candidate ACTIVE pero perfil diferente de M1: binding rechazado y fase recovery_required. **20 nuevas/80 acumuladas, N14/R2/H4**; sin envíos, tercer enlace, borrado o modificación de M2/env/fuentes. T04 pendiente de recuperar identidad correcta, T05 con evidencia del intento incompleto; T00-03 y S00 permanecen abiertos. Ocho slots globales restantes no reponen la reserva de recuperación. [Detalle y siguiente decisión](verification.md). QA offline actualizado142/142 y TypeScript correctos.

Aclaración posterior: el error anterior también podía representar un campo emailAddress incompleto, no demuestra por sí mismo otro Gmail. D-T01–03 preparados en [contrato de diagnóstico](s00/composio-identity-diagnostic.md),146/146 tests y TypeScript correctos; validación de perfil corregida e inspect_identity de una lectura implementado offline, con autorización propia pendiente. D-T04 no ejecutado, contadores20/80 intactos; recuperación T04 sigue pendiente.

D-T04 autorizado y completado posteriormente: una lectura, resultado **M2**, dirección válida; **21 nuevas/81 acumuladas, N15/R2/H4**. Diagnóstico cerrado, no recuperación: M1 sigue sin binding/restauración. Pendiente preparar y autorizar consentimiento del Gmail M1 original, sin consumir más API, generar tercer enlace o tocar M2 bajo la excepción diagnóstica. [Evidencia actual](verification.md).

### S00-C: recuperación del Gmail M1 correcto planificada

[Protocolo y cinco tareas](s00/composio-m1-correction.md), C-FR01–07/C-AC01–12. C-T01 preparado: base81 validada offline, precheck de dirección esperada, extensión auditada del mismo ledger, un nuevo enlace con aviso al operador y verificación sin envíos. Presupuesto incluye Auth Config actual: normal11–13 +R3, máximo16 nuevas/97 acumuladas propuestos; autorización vigente no ampliada. C-T02 implementación y C-T03 QA offline pendientes; C-T04 ejecución requiere gate posterior explícito de esta corrección, C-T05 consolida resultado/replay. No usar flags de B para saltar H4/dos enlaces ni ejecutar el protocolo no implementado.

### S00-C-T02/C-T03 completados offline

Usuario autorizó implementación y fixtures sin API real/enlaces. Extensión v2 en el mismo journal/CLI, predecessor81 inmutable, precheck de dirección M1, gates97, entrega privada y verificación/cierre implementados.27 casos C nuevos, **173/173 S00** y TypeScript correctos con fetch ambiental bloqueado. C-AC01–12 con evidencia offline en [verification](verification.md), [guía](s00/composio-correction-runner.md). Status real local conserva versión/counters y hashes de tres journals, total81; plantilla target creada vacía. No se cargaron credenciales, migró ledger real o creó enlace. C-T04/C-T05 operativos y autorización97 pendientes; S00 permanece abierto.

### S00-C-T04/C-T05 completados con servicios reales

Usuario autorizó16 nuevas/97 acumuladas y completó consentimiento M1 correcto. Preflight5 y verify6: **11 nuevas/92 acumuladas, N11/R0**, candidato ACTIVE/perfil M1 original, baseline/histórico/relectura y M2 original al inicio/cierre correctos. Binding pausado y cierre de uso completo; Instant0 antes/después con sus límites de precisión. Sin envíos, adjuntos, nuevo revoke, cambios de env, otros proveedores o CRM. Replay offline real HTTP0/escrituras0, journals/fuentes preservados y cero locks. Recuperación de transporte M1 completada mediante C; se conserva el intento B fallido por M2, sin reescribirlo. [Evidencia final](verification.md). S00 general abierto por T00-02/T00-04/T00-05 y aceptación CRM fuera de este ensayo.

### S00-INS-T01 preparado: contrato de Instantly, sin API

[Protocolo/AC/presupuesto](s00/instantly-validation.md) STRICT, INS-FR01–08/AC01–14/T01–06 dentro de T00-04. Configuración presente/forma válida comprobada internamente sin mostrar valores; scopes actuales no confirmados. Contrato revisado: status Lead read-only y test webhook sintético, con header personalizado documentado; no confundirlos con pausa individual o respuesta real.

Próximas tareas: INS-T02 ejecutor/CLI/fixtures offline, INS-T03 receiver/dedup y QA; INS-T04 lectura A hasta12, INS-T05 B hasta25/C hasta15 por permisos independientes, INS-T06 contrato/prueba INS-D de respuesta/detención o alternativa aceptada. Solo T01 preparado, sin implementar o ejecutar hoy. Máximo nuevo conjunto52 propuesto; no aumenta techo Composio97 ni consume92 existentes. T00-04/S00 siguen abiertos.

### INS-T02-A completado offline; B/C pendientes

Se divide INS-T02 siguiendo el alcance posterior del usuario: [INS-T02-A1/A2/A3](s00/instantly-phase-a.md) completados para fase A (núcleo, CLI/files y QA). A-AC01–10 con 30 pruebas nuevas; regresión S00 **203/203**, TypeScript correcto y revisión de seguridad/contadores/privacidad. Sin credenciales, HTTP real o envíos. INS-T02 de B/C e INS-T03 siguen pendientes; no se marca toda la tarea original como terminada. Próximo bloque operativo: INS-T04, exclusivamente lectura A, tras autorización hasta12 nuevas y cupo incluido confirmado. No requiere preparar el receiver C. T00-04 y S00 abiertos.

INS-T04 recibió después autorización humana A12, con condición de detenerse sin confirmación del cupo incluido. Gate de plan actual pendiente: se solicitó nombre/estado de Email Outreach. CLI offline mantiene not_started/calls0; no se cargaron credenciales o habilitó execute. La autorización A12 se conserva para continuar al confirmar el gate, sin pedir el mismo permiso otra vez. [Evidencia](verification.md).

La captura posterior confirmó Hyper Growth actual/renovación6nov2026 y permitió el ensayo A autorizado. **INS-T04 iniciado, no completado:4/12=N4/R0**, workspace/plan correctos,83 posiciones de contacto en lectura; DUPLICATE_RECORD al procesar página2 de claves. Permisos desconocidos, accounts/events/campaigns no ejecutados. Journal failed conservado, replay offline HTTP0/save0 y sin locks/temporales. Pendiente diagnóstico/recuperación del paginado probado offline, sin reset ni eludir el journal; ocho intentos del techo aún disponibles, sin nuevas peticiones ahora. [Resultado real y límites](verification.md).

### INS-R-T01/02/03 completados offline

Usuario solicitó preparar/implementar recuperación preservando4, sin API o reset. [Protocolo, tareas y aceptación R](s00/instantly-pagination-recovery.md): núcleo v2, snapshot/predecessor inmutable, gate explícito new8/total12, una muestra de claves y continuación solo de lecturas.24 tests R nuevos y **227/227 S00**, TypeScript correcto; R-AC01–06 acreditados offline. Preview del journal real no usa env/save/fetch y conserva hash/base v1 failed4, sin migración o locks. INS-R-T04 de servicios reales sigue pendiente; no se consume la autorización anterior mientras la instrucción vigente prohíbe APIs. No se marcan completos INS-T04, B/C/D o S00.

### INS-R-T04 completado con bloqueo explícito de scopes

Autorización posterior new8/total12 recibida y ejecutada: **7 nuevas/11 acumuladas=N10/R1**, con las4 previas preservadas en predecessor v2 y hash original validado. Workspace/plan83 slots,32 cuentas completas (segunda página en R,0 retries), tres tipos de evento requeridos y búsqueda de nonce sin coincidencias confirmados. Muestra keys2 sin match exacto y cursor abierto → **CURRENT_KEY_SCOPES_UNKNOWN**, sin autorización de B/C. Replay real offline HTTP0/save0, journal intacto y cero locks/temporales. INS-R-T04 terminado como recuperación de lecturas; INS-T04 sigue pendiente para acreditar scopes de la clave en panel y preparar capacidades posteriores. Un intento sobrante no reactiva automáticamente v2. [Evidencia final](verification.md).

### INS-T04 aceptado con evidencia de panel/operador; cero peticiones nuevas

Captura muestra CRM-curated/all:all y el usuario confirma que corresponde a INSTANTLY_API_KEY guardada. Constancia privada separada, ligada a última huella probada/captura/ledger, exige match de huella actual antes de uso; no contiene claves o permiso de ejecución. INS-T04 se completa en alcance de descubrimiento y scopes declarados. El journal remoto histórico conserva scopes desconocidos y bytes/contador11 sin cambios; no se afirma prueba efectiva de escritura. Próximo trabajo: INS-T02-B (implementar y QA offline del ensayo B), después INS-T05-B con autorización propia y datos/guardas preparados; INS-T03/C y D siguen pendientes. Sin API, envíos, cambios de código o fase B ejecutada. [Constancia y límites](verification.md).
