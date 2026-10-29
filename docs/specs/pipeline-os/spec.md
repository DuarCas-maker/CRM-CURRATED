# Especificación de la reestructuración Pipeline OS

## RC: preparación de versión conjunta — 29/10/2026

[Requisitos/aceptación/diseño/tareas RC](s00/release-candidate.md), STRICT. Respuesta5→B: revisar e incluir todos los cambios públicos pendientes frente al main local, manteniendo S01 y43/privados; preparar build aislado/commit local sin publicación o migración remota. No cambia el diseño IA-ADR01 ni autoriza C real. Ficha/imagen previa/versión remota/build Linux y G6 requieren su comprobación posterior.

## INS-REL: preparación046/Coolify — 29/10/2026

[Runbook, aceptación y tareas](s00/instantly-046-release-runbook.md), planificación STRICT REL-FR01–05/AC01–05. Confirmación humana: rama main y autodeploy activo; no publicar un push preparatorio. Migración expansiva046 primero, código revisado después con flagfalse, smoke y C por permisos separados.43 reales/12 JSON intactos; ningún cambio remoto, API, build, push/merge/deploy o secreto cargado por preparar esta guía. Ficha de destino/candidato/imagen anterior y ejecución siguen pendientes.

## INS-APP: webhook en la app existente — 29/10/2026

[Contrato/ADR/aceptación y runbook](s00/instantly-app-integration.md), IA-FR01–08/AC01–08/T01–04 implementados y comprobados offline. Ruta Next bajo APP_ORIGIN actual, flagfalse, autenticación externa dedicada y controles superadmin/MFA/origen; recibos técnicos en Supabase por RPC/CAS, sin negocio/worker/envíos.19 nuevos/423 regresión, aceptación DB y TS correctos.046 solo aplicada en PGlite; source43 y12 JSON operativos intactos. No nuevos servicios/DNS/despliegues/Supabase remoto/APIs reales. Activación/manifiesto final/puente del ensayo y presupuesto integrado siguen pendientes; C real/D/S00 abiertos.

## INS-C: protocolo preparado desde43 — 29/10/2026

**Implementación posterior autorizada:** INS-C-T02/T03/T04 completadas offline, FR01–08/AC01–12 cubiertos con28 pruebas C y regresión400/400 S00, TS correcto. Núcleo v8/files/CLI y handler autenticado con store privado, test único/conciliación/limpieza y resultados parcial/completo diferenciados. Fuente real v7/completed43 y12 JSON operativos intactos,0 APIs/carga de credenciales/publicación/envíos. T05 receptor público/manifiesto/control/costos y T06 real permanecen pendientes; la planificación inicial sigue como antecedente.

[Fase C](s00/instantly-phase-c.md), planificación STRICT: entrega técnica de un único webhook sintético limitado a la campaña de B, receptor propio autenticado/persistente y limpieza exclusiva de ese hook. Clarificación1→A: no hay receptor público; su preparación es requisito previo, sin publicación autorizada. INS-C-FR01–08/AC01–12/T01–06; solo T01 preparada, ejecutor/receptor/QA/manifiesto/real pendientes. Presupuesto actualizado12–14 normales, N14/R3/H2 hasta19 nuevas/62 acumuladas desde43, sin reutilizar remanente B. Contador/journal/privados/código preservados, cero APIs/envíos; no implementa producto ni cierra D/T00-04/S00.

## INS-BR28: recuperación desde28 implementada offline — 29/10/2026

**Actualización real T04:** permiso propio20/48 y evidencia API incluida válida; una ejecución completed43/stage13,15 nuevas/N15/R0/H0. Plan/capacidad actuales/configuración compatible/pausa/audiencia vacía válidos antes de altas; dos leads propios, aislamiento A/B y cierre pausado acreditados. Sin reconfigurar campaña/envíos/verificaciones/operaciones pagas. Snapshot28 y9 archivos anteriores restantes intactos, replay0/0/0 sin más HTTP. [Evidencia de recuperación B](s00/instantly-b-recovery-from-28.md). B recuperada operativamente, C/D/S00 pendientes; lo siguiente conserva implementación previa.

[Contrato/evidencia BR28](s00/instantly-b-recovery-from-28.md), BR28-FR01–08/AC01–08 cubiertos offline, T01/02/03 completadas. Núcleo v7, files/CLI/status/preview y23 casos BR28/372 S00/TypeScript correctos. Misma campaña ya configurada, preflight SC/pausa/audiencia vacía antes de altas A/B e aislamiento/cierre; sin PATCH normal de campaña o reparación por conflicto. Camino14–15 nuevas/42–43 acumuladas; N15/R3/H2, máximo20/48 futuro. Fuente real v6 completed28 y diez privados intactos,0 nuevas/env/HTTP/save en preview y sin v7 real. T04 requiere cupo/permiso propio; B/C/D/S00 abiertos.

## INS-SC: unidades de secuencia corregidas offline — 29/10/2026

[Contrato/bug/ADR/aceptación SC](s00/instantly-sequence-contract-correction.md), SC-FR01–05/AC01–05/T01–04 completados. Defaults documentados days solo para dos claves adicionales propias en un paso email/delay0, sin cambiar payload o aceptar unidades/tipos/conflictos/campos ajenos. CFD preserva request_exact y proyección histórica false.10 pruebas nuevas/349 S00/TypeScript correctos, fuente real28 y10 archivos privados intactos, sin credenciales/HTTP de ensayo/cambio de campaña. Valores reales de unidades no conservados: no afirmar que una futura recuperación pase o causa histórica probada. Próximo bloque propuesto es protocolo de recuperación desde28; B/BR/C/D/S00 abiertos.

## INS-CFD: diagnóstico configurado implementado offline — 29/10/2026

**Actualización real CFD-T04:** permiso propio2/29, acceso API incluido acreditado documentalmente, credenciales internas y1 GET: completed/**28 acumuladas**, source27 intacto. Identidad/pausa verificadas,38/45 rutas match. Secuencia devuelve delay_unit/pre_delay_unit adicionales y guarda configurada false; ai_sdr_id omitido compatible con OC. No mutaciones/envíos/verificaciones pagas o retry. Causa histórica no demostrada; siguiente bloque propuesto es corrección de contrato offline. [Evidencia real](s00/instantly-config-diagnostic.md). Lo siguiente conserva la implementación previa.

[Contrato y evidencia CFD](s00/instantly-config-diagnostic.md), CFD-FR01–07/AC01–07, SDD STRICT. Núcleo v6, files/CLI y preview implementados;45 rutas fijas de guardas/schedule/secuencias/pasos/variantes, sin valores privados y con compatibilidad OC separada de igualdad.23 pruebas CFD/339 S00 y TypeScript correctos. Fuente exacta real BR failed27/stage5 intacta; preview not_started27/new0, sin credenciales/HTTP/escrituras. No afirma causa histórica, repara o reanuda BR. Ejecución real CFD-T04 pendiente de permiso propio, una lectura y hasta un retry transitorio, máximo2 nuevas/29 acumuladas; B/BR/C/D y S00 abiertos.

## INS-BR: protocolo de recuperación B preparado — 29/10/2026

Estado operativo posterior: recuperación real autorizada22/41 ejecutada una vez, failed/stage5/B_UNSAFE_CAMPAIGN tras configurar y releer,8 nuevas/27 acumuladas,N6/R0/H2. Campaña propia pausada por emergencia y verificada,0 leads/envíos/verificaciones pagas. Fuente19 preservada y7 archivos privados restantes intactos; no reabrir terminal. [Incidente BR](s00/instantly-b-recovery-incident.md). Aceptación B/S00 pendiente y próximo diagnóstico de lectura configurada por preparar. Las notas siguientes de implementación/planificación son antecedentes.

Actualización: usuario autorizó implementación/QA offline BR-T02/03, completadas con23 pruebas BR y316/316 S00, TypeScript correcto. Continuidad v5, builder acotado, CLI/files y guardas de presupuesto/reconciliación/terminales implementados sin cambiar fuente real v4/19. Estado de recuperación real not_started, cero credenciales/HTTP/save en preview y ocho archivos privados intactos. [Evidencia BR](s00/instantly-b-recovery.md). BR-T04 y aceptación operativa B/S00 pendientes; el párrafo siguiente conserva la preparación del protocolo.

Planificación STRICT en [protocolo BR](s00/instantly-b-recovery.md), BR-FR01–08/AC01–08: misma campaña pausada/vacía, configuración y dos destinatarios originales, audiencia/aislamiento/cierre sin emisión, continuidad exacta v4/19 y futura v5 con snapshot. Camino normal16–17, reserva3/emergencia2, máximo22 nuevas/41 acumuladas propuesto. Cero APIs/credenciales/cambios remotos o implementación autorizados por esta planificación; BR-T02/03 offline y BR-T04 real pendientes. No reciclar permiso20/36 ni crear otra campaña.

## INS-OC: compatibilidad de opcionales implementada offline — 29/10/2026

[Contrato STRICT OC](s00/instantly-optional-fields-correction.md), OC-FR01–06/AC01–06: distinguir omitido/null/explícito sin defaults; permitir la respuesta opcional únicamente bajo guardas independientes de ensayo no emisor, rechazar conflictos/tipos incorrectos y separar create/PATCH para ai_sdr_id. Historial BD v4 completed19 intacto, B sin reanudar.293/293 S00 y TypeScript correctos; cero credenciales/API autenticada/cambios remotos. Recuperación del mismo recurso requiere incremento posterior; no habilita envíos o cierre de S00. Lo siguiente conserva evidencia histórica.

## INS-BD: diagnóstico de campaña implementado offline — 28/10/2026

Alcance autorizado: preparar/implementar lectura diagnóstica de la campaña propia del B fallido18, sin APIs reales, credenciales o reinicio. [Contrato STRICT](s00/instantly-b-diagnostic.md), BD-FR01–07/BD-AC01–07: snapshot B18 inmutable, futura v4 en mismo ledger con máximo2 lecturas/20 acumuladas, GET propio único con retry transitorio acotado, proyección fija sin valores privados e informe de diferencias actuales sin afirmar causa histórica. BD-T01–03 terminados,28 casos nuevos y284/284 S00, TypeScript correcto.8 archivos reales intactos, v3/18 sin migración; BD-T04 real/B/S00 pendientes. No reparar guardas B o modificar campaña/CRM/DB.

## Incremento vigente INS-B — 27/10/2026

Solicitud autorizada: preparar/implementar B y probar offline preservando11 consumidas, sin API/envíos. [Contrato específico STRICT](s00/instantly-phase-b.md), B-FR01–08/B-AC01–08, amplía el ejecutor independiente para crear campaña propia sin remitentes, acreditar pausa antes de audiencia, añadir dos contactos controlados sin verificación paga, comprobar paginado/aislamiento y reservar recuperación/emergencia. Se implementaron B-T01–03 con 29 tests B y regresión S00 256/256; aceptación remota B-T04 sigue pendiente. No modifica CRM/DB, no implementa C/D ni promete pausa individual. Presupuesto futuro25 nuevas/36 acumuladas desde11, sujeto a manifiesto, cupo y autorización propios; fuentes reales intactas y cero HTTP. [Verificación](verification.md).

Versión 1.1 · 24 de octubre de 2026 · Estado: requisitos consolidados; S00 en ejecución local, S01–S13 no iniciados.

Este documento define la evolución del CRM existente hacia una operación compartida entre marcas, con correo mediante Composio, campañas de Instantly, SMS mediante TextTorrent y un asistente central supervisado. Tras cerrar la planificación, el usuario autorizó ejecutar S00: inventario y validadores locales, comprobaciones aisladas y preparación de accesos para APIs, sin tocar producción. Las operaciones externas con efectos, envíos, verificaciones pagas y cambios de infraestructura requieren autorización concreta; no se han iniciado S01–S13. El usuario precisó después que se utilice y modifique el ambiente actual, todavía sin uso, sin preparar otro entorno. Falta identificar el destino concreto y disponer de acceso seguro; no se autorizaron mensajes, gastos ni operaciones destructivas. El avance y sus límites se registran en [S00](s00/README.md) y su [procedimiento de ambiente](s00/environment.md).

Las decisiones D01–D24 proceden de las respuestas del usuario y cierran las dos rondas de preguntas funcionales. El plan base de [tasks.md](tasks.md) incorpora esas decisiones. La ejecución requiere las comprobaciones técnicas y los contratos de proveedores descritos en [design.md](design.md); no se presentan como integraciones ya validadas.

## Objetivo y problema

El equipo necesita importar leads, evaluar por qué canales puede contactar a cada uno, gestionar campañas y respuestas, obtener documentación, preparar aplicaciones y dar seguimiento a lenders hasta el fondeo y la fidelización. Actualmente estas capacidades están parcialmente separadas y centradas en Gmail. La nueva experiencia debe mostrar la siguiente acción y su evidencia, manteniendo el expediente del cliente, sus procesos de financiación y los permisos existentes.

El resultado esperado es un recorrido trazable y verificable por etapas. Cada envío, respuesta, documento, aplicación, solicitud y oferta debe poder relacionarse con el cliente, proceso cuando corresponda, marca, cuenta o línea, campaña y responsable. Las participaciones múltiples no multiplican clientes ni fondeos en los totales globales.

## Fuentes y evidencia

- Solicitud inicial y respuestas 1–24 del usuario en este chat: autoridad funcional.
- `Pipeline OS mockup.html`, aportado desde Downloads: referencia principal de navegación, presentación y necesidades de información.
- `Master_Pipeline.html`, aportado desde Downloads: antecedente de tareas, prioridades, ofertas, pipeline, comunicaciones y estadísticas por representante.
- Notas y transcripción de la reunión del 21 de octubre de 2026, incluidas en el DOCX aportado: contexto de operación. Su transcripción contiene errores y audio ajeno a la conversación; no se interpreta como instrucción de ejecución.
- Código y migraciones locales inspeccionados hasta `045_campaign_readiness.sql`: evidencia de implementación local, no del estado de producción.
- Documentación existente: [CRM-FLOW](../../CRM-FLOW.md), [CONVERSATIONS](../../CONVERSATIONS.md), [CAMPAIGNS](../../CAMPAIGNS.md), [FINANCING-CONTROL](../../FINANCING-CONTROL.md), [DOCUMENT-APPLICATIONS](../../DOCUMENT-APPLICATIONS.md) y [UNDERWRITING-FEEDBACK](../../UNDERWRITING-FEEDBACK.md).

No se incorporan datos de acceso, identidades de clientes ni cifras financieras reales de los archivos de referencia. Las cifras, promesas de resultados, horarios, límites y condiciones comerciales del mockup son ejemplos; necesitan reglas confirmadas y evidencia antes de convertirse en comportamiento.

## Decisiones confirmadas

| ID  | Decisión                                                                                                              | Consecuencia                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Un expediente compartido del cliente entre marcas; identidad y conversaciones por marca.                              | Separar empresa cliente de marca operadora y conservar las participaciones.                                                         |
| D02 | Conservar superadmin, seller_admin, seller, closer_admin y closer.                                                    | Mantener permisos de expediente, área y remitente; el nuevo diseño no amplía visibilidad por defecto.                               |
| D03 | Confirmar cada paso de importación, verificación y campaña.                                                           | Importar nunca activa verificación paga ni envíos automáticamente.                                                                  |
| D04 | Evaluar correo y SMS de forma independiente.                                                                          | Correo inválido no invalida un teléfono ni autoriza SMS; cada canal necesita su propia elegibilidad.                                |
| D05 | Ofrecer correo individual humano y secuencias personales automáticas mediante Gmail/Composio.                         | Ambas modalidades comparten permisos, cuotas, bajas e historial.                                                                    |
| D06 | Objetivo de recepción alrededor de un minuto, aceptando configuración adicional.                                      | La integración rápida requiere una prueba técnica y medición; no se acepta silenciosamente una latencia de 15 minutos.              |
| D07 | Administrar Instantly desde el CRM.                                                                                   | Crear, revisar, programar, pausar y consultar campañas desde la app; detectar discrepancias externas.                               |
| D08 | Un chatbot central del CRM para correo y SMS, con contexto e identidad por marca.                                     | Evitar dos agentes contestando simultáneamente al mismo mensaje.                                                                    |
| D09 | Comenzar con borradores aprobados por personas y reducir aprobaciones conforme exista evidencia.                      | Registrar correcciones y evaluar versiones; la habilitación de autonomía será explícita, reversible y acotada.                      |
| D10 | Repartir el primer contacto entre correo y SMS y alternar canales si no hay respuesta.                                | Persistir la asignación y todos los intentos por lead; no reenviar por desconocer lo que hizo el otro canal.                        |
| D11 | Documentos → análisis preliminar → completar y firmar aplicación → validación final.                                  | Separar análisis preliminar de paquete apto para presentación.                                                                      |
| D12 | Una persona aprueba análisis y conjunto de lenders; el sistema envía y programa seguimiento.                          | Congelar aprobación, destinatarios y versiones documentales antes de enviar.                                                        |
| D13 | Conservar el histórico y migrar cuentas gradualmente a Composio.                                                      | Evitar doble envío y doble conteo durante la convivencia de conectores.                                                             |
| D14 | Primer piloto: Excel → verificación → correo Composio → respuesta → conversación y documentos.                        | La primera entrega verificable no depende de terminar Instantly, SMS ni chatbot.                                                    |
| D15 | Distribución inicial por porcentajes o filtros de campaña, revisada antes de confirmar.                               | Persistir la asignación; presentar solapamientos, excluidos y contactos sin canal asignable.                                        |
| D16 | Sin respuesta: seguimiento cada 2 días, con máximo configurable y pausa al agotarlo.                                  | Alternar canales elegibles; no prolongar la secuencia indefinidamente ni reiniciar contadores al reanudar.                          |
| D17 | Interesados sin documentos: recordatorio cada 24 horas, con horarios, máximo configurable y derivación humana.        | Separar esta secuencia de la prospección y detenerla si el equipo debe responder o ya se cumplió el requisito.                      |
| D18 | Una baja detiene toda prospección del grupo para ese contacto, por correo y SMS.                                      | Cancelación global entre marcas/proveedores, borradores y seguimientos comerciales; preservar la evidencia.                         |
| D19 | Aprender con ejemplos/correcciones aprobados y evaluar posteriormente entrenamiento específico con datos revisados.   | Evaluación posterior explícita, sin entrenamiento implícito ni requisito de entrenar para entregar el asistente inicial.            |
| D20 | Mostrar todas las participaciones y atribuir la fuente principal a la última interacción significativa.               | Conservar evidencia y fecha; contar cada fondeo una sola vez en el total global.                                                    |
| D21 | Recomendar oferta según ajuste de monto/plazo, costo y requisitos; confirma una persona.                              | Comparación explicable y selección humana, sin equiparar automáticamente mayor monto con mejor oferta.                              |
| D22 | Fidelización inicial con recordatorios/tareas y renovaciones/porcentaje pagado registrados manualmente con evidencia. | No incluye campañas automáticas de fidelización ni integración de pagos en esta versión.                                            |
| D23 | Piloto de 1 marca, 2 cuentas de correo, 1 línea SMS y hasta 500 leads.                                                | Activar correo primero conforme a D14 y SMS cuando esté validado; conservar pruebas sintéticas del límite de importación existente. |
| D24 | Sprints por entregables verificables, dependencias y esfuerzo relativo, sin prometer fechas.                          | No convertir el número de sprints en semanas ni fijar calendario sin conocer capacidad.                                             |

Se conserva además la prioridad visual del mockup final y el módulo de conversaciones existente. La operación posterior incluye ofertas, requisitos adicionales, contratos enviados y firmados, fondeo confirmado y fidelización.

## Conceptos y estados

Una empresa cliente puede tener varios contactos y procesos de financiación. La marca operadora identifica desde qué empresa del grupo se comunica el equipo. Un buzón o línea pertenece a una identidad autorizada. La campaña organiza una audiencia y contenido; la secuencia por lead decide el próximo intento y canal.

Se distinguen cinco dimensiones:

1. Preparación del lead: importado, pendiente de evaluación de canales, elegible en uno o más canales, sin canal elegible o pendiente de revisión.
2. Estado de comunicación: sin contacto confirmado, en contacto, sin respuesta, respuesta por revisar, interesado, documentos solicitados o seguimiento detenido. Una respuesta automática no equivale a interés.
3. Proceso comercial: documentación, riesgo preliminar, aplicación, paquete validado, presentación a lenders, ofertas/negociación, contratos, fondeo y cierre sin fondeo cuando corresponda.
4. Solicitud por lender: preparada, en cola, envío incierto, envío confirmado, pendiente, requisitos adicionales, declinada, oferta y siguientes hitos documentados.
5. Tareas y vistas operativas: falta aplicación, falta oferta, ofertas disponibles, contratos enviados y contratos firmados pendientes de fondeo. Pueden solaparse.

Estas etiquetas son conceptos de producto. Su correspondencia con los estados SQL existentes se define antes de modificar enumeraciones. Un documento recibido no se considera aprobado, una oferta no equivale a fondeo y un correo aceptado por una API no equivale a entrega al destinatario.

## Requisitos funcionales

| ID   | Requisito verificable                                                                                                                                                                                                                               | Decisiones    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| RF01 | Mantener un expediente del cliente, contactos, procesos e historial; detectar coincidencias y enviar las ambiguas a revisión sin fusionarlas por nombre aproximado.                                                                                 | D01, D13      |
| RF02 | Registrar marca operadora, remitentes, líneas y permisos, preservando la separación seller/closer y el traspaso actual.                                                                                                                             | D01, D02      |
| RF03 | Importar CSV/XLSX con vista previa, mapeo, hoja, progreso, duplicados e informe; conservar límites actuales salvo decisión justificada. Admitir filas con teléfono sin correo utilizable.                                                           | D03, D04      |
| RF04 | Exigir confirmación separada para importar, verificar, inscribir audiencia y activar campaña. Mostrar elegibles, excluidos, canal inicial y motivo de exclusión antes de confirmar.                                                                 | D03, D10      |
| RF05 | Mantener resultados Bouncer y errores técnicos separados. Evaluar SMS con teléfono normalizado, línea disponible y evidencia de habilitación del canal; no usar Bouncer como prueba de aptitud SMS.                                                 | D04           |
| RF06 | Conectar, listar, desactivar y reconectar múltiples cuentas Composio desde Configuración; asociarlas expresamente a un buzón y marca autorizados.                                                                                                   | D01, D06, D13 |
| RF07 | Enviar y recibir correo individual y secuencias Gmail mediante Composio, preservando hilos, adjuntos, firmas compatibles y restricciones de acceso.                                                                                                 | D05, D06      |
| RF08 | Medir recepción, visibilidad y preparación de borrador por separado. Validar la solución de recepción rápida antes de migrar volumen.                                                                                                               | D06, D14      |
| RF09 | Crear, configurar, activar, programar y pausar campañas Instantly desde el CRM; sincronizar IDs, audiencia, secuencias, respuestas, errores y métricas disponibles.                                                                                 | D07           |
| RF10 | Enviar campañas y mensajes SMS con TextTorrent; recuperar respuestas y estados, respetando subcuenta, línea y límites verificados.                                                                                                                  | D04, D08, D10 |
| RF11 | Guardar asignación inicial por porcentajes/filtros revisados, intentos por canal, marca, remitente/línea, fechas, estado, ID externo, motivo y próximo paso.                                                                                        | D10, D15      |
| RF12 | Alternar canales elegibles cada 48 horas sin respuesta, con ventanas, máximo total configurable y pausa al agotarlo; coordinar marcas y proveedores del mismo contacto.                                                                             | D10, D15, D16 |
| RF13 | Al recibir respuesta, detener la secuencia de no respuesta y clasificar interés, rechazo, baja, mensaje automático o ambigüedad. Interesados sin documentos: recordatorios cada 24 horas, con horario, máximo y derivación humana.                  | D08, D10, D17 |
| RF14 | Mostrar correo y SMS en Conversaciones, manteniendo identidad del canal/marca y referencias originales, cliente, proceso y lender cuando sean conocidos.                                                                                            | D01, D08      |
| RF15 | Generar borradores del asistente con contexto autorizado; permitir aprobar, editar, rechazar, asignar y tomar control humano. Invalidar el borrador si cambia el contexto relevante.                                                                | D08, D09      |
| RF16 | Registrar ejemplos aprobados, correcciones y motivos; evaluar versiones con casos separados y habilitar autonomía explícita, acotada y reversible. Incluir evaluación posterior de entrenamiento específico con datos revisados.                    | D09, D19      |
| RF17 | Recibir documentos desde adjuntos o enlaces autorizados, conservar procedencia, versiones y revisión; mostrar faltantes. Un adjunto por sí solo no completa un requisito.                                                                           | D11, D14      |
| RF18 | Analizar documentación suficiente de forma preliminar sin exigir aplicación firmada; marcar datos ausentes y evidencias. Completar aplicación, firma y revisión final antes de habilitar presentación.                                              | D11           |
| RF19 | Recomendar lenders a partir de guidelines versionadas y evidencia del expediente; una persona aprueba análisis, destinatarios y paquete exacto antes del envío.                                                                                     | D12           |
| RF20 | Enviar una solicitud independiente a cada lender aprobado, conservar documentos enviados y programar seguimiento; conciliar resultados inciertos sin duplicar presentaciones.                                                                       | D12           |
| RF21 | Mostrar por proceso lenders contactados, envíos confirmados, pendientes, declinaciones con motivo, requisitos adicionales y ofertas. Distinguir respuesta informativa de decisión comercial.                                                        | D12           |
| RF22 | Comparar ofertas por ajuste al monto/plazo solicitado, costo y requisitos, con confirmación humana. Conservar rechazadas/vencidas y búsqueda de otra oferta; diferenciar contratos y fondeo con evidencia.                                          | D01, D12, D21 |
| RF23 | Mostrar tareas por próxima acción, prioridad, responsable, espera y evidencia; abrir el expediente sin perder filtros ni contexto de lista.                                                                                                         | D02           |
| RF24 | Usar el mockup final para una navegación mínima: inicio, tareas, campañas, conversaciones, expedientes, clientes e indicadores; mantener lenders y configuración accesibles según rol.                                                              | D01, D02      |
| RF25 | Mostrar cuentas activas, salud de conexión, última sincronización, envíos, respuestas, campañas, aplicaciones, ofertas y deals relacionados; distinguir actividad propia de datos externos reconciliados.                                           | D06, D07      |
| RF26 | Calcular indicadores por marca, cuenta/línea, campaña, plantilla, canal, responsable y período; conservar participaciones y atribuir fuente principal a última interacción significativa verificable, sin duplicar fondeos.                         | D01, D10, D20 |
| RF27 | Conservar historial Gmail y documentos al migrar conexiones; reconciliar observaciones de Instantly y Composio del mismo correo sin perder evidencia ni multiplicar respuestas.                                                                     | D13           |
| RF28 | Mantener cliente fondeado con historial y tareas internas de fidelización. Registrar manualmente porcentaje pagado y renovaciones con evidencia; cada renovación crea otro proceso. Esta versión no envía fidelización automática ni integra pagos. | D01, D22      |
| RF29 | Aplicar baja global de prospección a todo el grupo en correo y SMS; cancelar secuencias/borradores comerciales y sincronizar bloqueos antes de nuevos envíos, preservando evidencia y alertando de fallos externos.                                 | D04, D10, D18 |
| RF30 | Registrar actividad auditable y costos/consumo disponibles por integración y agente, alertando sobre desconexión, cuota, saldo, eventos pendientes y discrepancias.                                                                                 | D06, D09      |

## Reglas de negocio

- RB01: Elegibilidad comercial, validez del correo y elegibilidad SMS son hechos distintos. No se rechaza un cliente por una falla técnica de verificación ni se deduce aptitud crediticia de los datos de contacto.
- RB02: Cada confirmación del usuario se aplica a la selección y versión revisadas. Cambiar audiencia, mensaje, remitente o paquete exige una nueva revisión de lo cambiado.
- RB03: Los permisos de buzón o línea no conceden acceso al expediente. El asistente tiene como máximo el acceso del flujo y rol que lo invoca.
- RB04: La asignación de canal se persiste; reanudar un lote o repetir una confirmación no redistribuye los leads.
- RB05: Un intento programado, uno reservado, uno confirmado y uno de resultado incierto son estados diferentes. Solo el confirmado alimenta métricas de envío confirmado; SMS entregado y correo aceptado se etiquetan por separado.
- RB06: Cada contacto tiene una coordinación común de próximas acciones, aunque participe en varias marcas/campañas. Una baja bloquea toda prospección del grupo en correo y SMS, invalida borradores comerciales y cancela recordatorios comerciales pendientes, incluso de otras marcas. Se sincroniza el bloqueo a los proveedores; un fallo de sincronización genera alerta y mantiene bloqueados los despachos CRM. No se reactiva por reimportación o cambio de identidad/canal.
- RB07: La respuesta de un cliente invalida el seguimiento de no respuesta pendiente. Si un proveedor ya tenía una petición en vuelo, se conserva evidencia y se reconcilia la posible carrera; no se promete retirar mensajes ya aceptados.
- RB08: El asistente empieza en modo supervisado. Aprender de ejemplos no equivale a entrenar automáticamente un modelo ni a autorizarse a sí mismo. Negociación, condiciones vinculantes, aprobación financiera y fondeo conservan intervención humana.
- RB09: Una corrección del usuario prevalece sobre la extracción del asistente; debe conservarse la fuente y el historial de cambios.
- RB10: El análisis preliminar no certifica que el expediente pueda enviarse. La validación final exige aplicación firmada, requisitos aprobados, fuentes vigentes y aprobación humana del paquete y destinatarios.
- RB11: Un cambio de documento, aplicación, guideline relevante o destinatario invalida las aprobaciones afectadas para futuros envíos. No altera lo que ya se envió históricamente.
- RB12: Una nueva financiación no sobrescribe el proceso anterior. Recibir de nuevo una aplicación tampoco demuestra un nuevo negocio cerrado.
- RB13: El ranking de ofertas considera ajuste al monto/plazo solicitado, costo y requisitos, explica sus criterios y muestra datos desconocidos. Una persona confirma la recomendación; mayor monto por sí solo no determina la mejor oferta.
- RB14: No reconstruir fechas históricas de conversión usando la fecha de importación o `updated_at`; mostrar fecha no verificable cuando falte evidencia.
- RB15: Los horarios y bajas se evalúan con la zona horaria y evidencia disponibles; el país o zona faltante necesita resolución, no se infiere con certeza por un prefijo ambiguo. Calendario y fines de semana se configuran antes de activar cada campaña.
- RB16: Sin respuesta, el próximo paso vence a las 48 horas del último envío confirmado y se ejecuta en la siguiente ventana permitida; nunca antes. El máximo total de intentos incluye el contacto inicial y debe configurarse con esa etiqueta antes de activar. Agotarlo pausa la secuencia. Un resultado incierto bloquea el avance hasta conciliación.
- RB17: Para interesados, los recordatorios documentales vencen a las 24 horas de la última solicitud/recordatorio confirmado, sujetos a ventana, límite propio y revisión humana mientras corresponda. Una pregunta pendiente de respuesta del equipo impide pedir de nuevo documentos automáticamente. Agotar el máximo genera tarea humana sin reiniciar el ciclo de no respuesta.
- RB18: Los porcentajes se aplican sobre la audiencia elegible revisada y producen una asignación inicial única por lead/campaña. El reparto entero, conflictos de filtros y exclusiones se muestran antes de confirmar. Cambiar elegibilidad después no redistribuye silenciosamente una asignación aprobada.
- RB19: La atribución principal usa la última interacción significativa verificable anterior o vinculada a la conversión; todas las participaciones se conservan. Aperturas, eventos automáticos y recordatorios salientes sin participación del cliente no desplazan por sí solos la atribución. La definición técnica y desempates quedan versionados; nuevos eventos posteriores no reescriben conversiones pasadas silenciosamente.
- RB20: El porcentaje pagado y la renovación se registran manualmente con fuente, fecha y autor. No se estiman pagos por tiempo transcurrido. La fidelización inicial produce tareas internas; no envía mensajes automáticos. Una tarea no autoriza contactar a quien tenga baja.

## Flujos de usuario

### Piloto de correo

Administrador carga un Excel ficticio y revisa el mapeo. Confirma importación, recibe informe y selecciona leads para verificar. Confirma verificación y revisa elegibilidad. Conecta una cuenta de prueba autorizada, prepara un correo o secuencia personal y revisa audiencia, identidad, horario y cuota. Confirma activación. Una respuesta de prueba queda en la conversación correcta y cancela el seguimiento pendiente. El equipo incorpora un adjunto al requisito correcto y revisa su versión. Esta prueba utiliza destinatarios controlados y autorización de envío específica durante implementación.

### Campaña con canales alternados

Administrador elige marca, proveedores, mensajes, audiencia y política de distribución. Revisa la asignación antes de activar. Cada lead conserva su canal inicial y sus intentos. Si no hay respuesta cuando vence el paso, el coordinador vuelve a comprobar permisos, bajas, presupuesto, versión y canal alternativo. Si hay respuesta, bloquea los pasos de prospección y abre el seguimiento interesado. Una persona o el asistente supervisado continúa desde la identidad apropiada.

### Documentación y presentación

El equipo recibe y revisa documentos; el asistente solicita faltantes. Se genera un análisis preliminar, se completa y firma la aplicación y se revisa el análisis final. El sistema recomienda lenders y muestra el paquete. Una persona aprueba análisis y destinatarios; el worker envía solicitudes independientes y programa tareas. Respuestas, requisitos, ofertas y contratos se registran con evidencia. Una persona confirma el fondeo y se inicia fidelización.

## Casos especiales y errores

| Caso                                                             | Comportamiento esperado                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Teléfono sin correo o correo inválido                            | Conservar el lead; evaluar SMS sin inventar dirección de correo. Si ninguno es elegible, explicar bloqueo. |
| Teléfono compartido o empresa coincidente por nombre             | Revisión de identidad; no fusionar clientes ni conversaciones por aproximación.                            |
| Verificación técnica fallida o resultado incierto                | Pendiente/revisión; no consumir de nuevo una operación posiblemente facturada a ciegas.                    |
| Webhook repetido, consulta SMS repetida o eventos fuera de orden | Procesamiento repetible, sin doble mensaje, respuesta, tarea ni conversión.                                |
| Respuesta durante envío o cambio de canal                        | Invalidar pasos futuros; conciliar la petición ya iniciada y mostrar la carrera si ocurrió.                |
| Borrador aprobado pero llega otro mensaje                        | Caduca aprobación del borrador; preparar contexto nuevo antes de enviar.                                   |
| Cuenta revocada, saldo insuficiente o cuota agotada              | Pausar trabajo afectado, mantener progreso e informar; reconectar no reactiva automáticamente envíos.      |
| Fallo parcial en varios lenders                                  | Conservar resultado por lender, reintentar solo fallos seguros y conciliar inciertos.                      |
| Mensaje comercial ambiguo o sin asociación segura                | Bandeja de revisión; no crear aprobación/oferta/fondeo basándose solo en una inferencia.                   |
| Documento sustituido o requisito adicional                       | Conservar versiones, invalidar revisión vigente donde corresponda y generar la próxima acción.             |
| Edición de campaña directamente en proveedor                     | Detectar discrepancia y revisar antes de sobrescribir o continuar automáticamente.                         |

## Requisitos no funcionales

- RNF01 Seguridad: MFA, invitación, RLS, permisos de expediente/área/remitente y buckets privados conservados; credenciales exclusivamente en servidor/worker. Probar también acceso directo a APIs y Storage.
- RNF02 Fiabilidad: colas actuales con reservas, fencing, idempotencia, reintentos con espera y reconciliación. No prometer ejecución exactamente una vez en APIs externas.
- RNF03 Rendimiento: preservar CSV/XLSX hasta 50 MB y 50.000 filas, procesamiento en bloques y paginación antes de agregar/presentar. El piloto operativo usa 1 marca, 2 buzones, 1 línea SMS y hasta 500 leads. Las 50.000 filas se prueban con datos sintéticos como compatibilidad/carga, sin enviar campañas a ese volumen.
- RNF04 Recepción: objetivo aproximado de 60 segundos en condiciones normales para correo nuevo de piloto. S00 define muestra, percentiles y tolerancia; se mide desde recepción en buzón hasta disponibilidad en CRM, separando demora externa e interna. Ningún resultado está validado aún.
- RNF05 Experiencia: ES/EN, escritorio/tableta/móvil, teclado, foco, contraste, estados de carga/vacío/error, filtros conservados y conversaciones existentes compatibles.
- RNF06 Observabilidad: correlación entre intento, job, evento y proveedor, alarmas con contenido mínimo y tiempos de sincronización visibles. No registrar cuerpos, documentos, credenciales ni información financiera en logs operativos.
- RNF07 Compatibilidad: cambios aditivos y por bandera; coexistencia temporal por cuenta, sin alterar mensajes/documentos históricos. Rollback operativo antes que eliminar registros nuevos.
- RNF08 Costos y privacidad: presupuestos y límites de IA/envío verificables, contexto mínimo y retención de ejemplos definida antes de activar aprendizaje. Evaluaciones con datos ficticios o revisados; ningún entrenamiento externo implícito.

## Criterios de aceptación de producto

| ID   | Escenario y resultado exigido                                                                                                                                                                                                                                                                        | Requisitos             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| AC01 | Repetir una importación/confirmación con la misma clave conserva un solo resultado; mapeo e informe coinciden con filas procesadas.                                                                                                                                                                  | RF01–RF04              |
| AC02 | Un lead con correo inválido y teléfono elegible puede continuar por SMS; otro con correo válido y SMS bloqueado continúa solo por correo.                                                                                                                                                            | RF03–RF05, RF29        |
| AC03 | Importar o verificar no activa campañas; activar utiliza exactamente la selección revisada.                                                                                                                                                                                                          | RF04                   |
| AC04 | Dos cuentas conectadas de marcas distintas usan el remitente seleccionado y un usuario sin permiso no puede consultar/enviar mediante ellas.                                                                                                                                                         | RF02, RF06, RF07       |
| AC05 | Piloto D14 completo: respuesta en hilo correcto, recepción medida, seguimiento detenido y adjunto incorporado una sola vez.                                                                                                                                                                          | RF07, RF08, RF13, RF17 |
| AC06 | Al repetir/reanudar distribución e intentos, el canal inicial permanece y el siguiente paso alterna solo donde está permitido.                                                                                                                                                                       | RF11, RF12             |
| AC07 | Respuesta o baja antes del despacho cancela los siguientes intentos; evento repetido o desordenado no reactiva la secuencia.                                                                                                                                                                         | RF13, RF29             |
| AC08 | Crear/activar/pausar campaña desde CRM se refleja en Instantly y se reconcilian fallos parciales; no se duplican campañas por un timeout incierto.                                                                                                                                                   | RF09                   |
| AC09 | Enviar SMS y recuperar dos veces la misma respuesta produce una sola conversación y una sola respuesta contada; se conserva línea/subcuenta.                                                                                                                                                         | RF10, RF14             |
| AC10 | El asistente en modo supervisado no envía sin aprobación vigente; edición humana y toma de control quedan auditadas.                                                                                                                                                                                 | RF15                   |
| AC11 | Una versión nueva no adquiere autonomía por volumen de ejemplos; administrador habilita una acción tras evaluación y puede revocarla.                                                                                                                                                                | RF16                   |
| AC12 | Aplicación ausente permite únicamente el análisis preliminar si hay fuentes suficientes; el envío a lenders sigue bloqueado hasta validar el paquete final.                                                                                                                                          | RF18, RF19             |
| AC13 | Dos lenders aprobados generan solicitudes separadas con los hashes aprobados; sustituir un documento invalida envíos futuros pendientes y preserva lo enviado.                                                                                                                                       | RF19, RF20             |
| AC14 | Estados y conteos diferencian cola, incierto, confirmado, pendiente, declinado y oferta; un auto reply no se presenta como aprobación.                                                                                                                                                               | RF21, RF22             |
| AC15 | Un expediente con oferta rechazada por cliente aparece donde falta oferta y conserva sus ofertas; firmar contrato no registra fondeo automáticamente.                                                                                                                                                | RF22, RF23             |
| AC16 | La navegación nueva permite abrir/cerrar expediente, volver a conversaciones y conservar filtros; ES/EN y móvil funcionan con teclado donde corresponda.                                                                                                                                             | RF14, RF23, RF24       |
| AC17 | Un correo observado por Composio e Instantly no duplica respuesta/conversión; dos campañas pueden tener participación y el fondeo global se cuenta una vez.                                                                                                                                          | RF25–RF27              |
| AC18 | Migrar una cuenta conserva IDs de expediente e histórico y habilita un único escritor; volver al conector anterior no repite envíos inciertos.                                                                                                                                                       | RF27                   |
| AC19 | Cliente fondeado conserva sus procesos; una renovación crea otro proceso sin reescribir el fondeo anterior.                                                                                                                                                                                          | RF28                   |
| AC20 | AAL1, remitente no autorizado y acceso de seller a negociación/documentos posteriores al traspaso se deniegan en API y base de datos.                                                                                                                                                                | RF02, RNF01            |
| AC21 | Una distribución de 100 leads elegibles al 60/40 produce 60 asignaciones email y 40 SMS, una por lead, sin cambiar tras replay. Filtros solapados o canales no elegibles se resuelven en la revisión, sin envío silencioso.                                                                          | RF04, RF11, RF12       |
| AC22 | Con reloj controlado, no hay seguimiento de no respuesta antes de 48 horas ni recordatorio documental antes de 24; se respeta la siguiente ventana permitida. Al agotar máximos, se pausa y se deriva al humano donde corresponda.                                                                   | RF12, RF13             |
| AC23 | Una baja recibida por cualquier canal bloquea prospección de todas las marcas/canales, invalida borradores y cancela pendientes; reimportar/reconectar no la levanta. Un bloqueo externo fallido alerta y no habilita despachos CRM.                                                                 | RF13, RF15, RF29       |
| AC24 | Una conversión con varias participaciones conserva todas y atribuye la fuente principal a la última interacción significativa verificable. Auto replies, aperturas o un evento posterior no sustituyen la fuente; el fondeo se cuenta una vez.                                                       | RF25, RF26, RF27       |
| AC25 | La recomendación compara monto/plazo, costo y requisitos y muestra faltantes; una persona confirma. Una oferta de mayor monto con peor ajuste no gana automáticamente.                                                                                                                               | RF22                   |
| AC26 | El cliente fondeado tiene tareas internas y datos de pago/renovación ingresados con evidencia. Crear un recordatorio no envía correo/SMS ni estima pagos; una renovación mantiene intacto el proceso anterior.                                                                                       | RF28, RF29             |
| AC27 | El piloto queda limitado a 1 marca, 2 buzones, 1 línea SMS y hasta 500 leads. La carga sintética de 50.000 filas no activa campañas ni consume verificaciones pagas reales.                                                                                                                          | RF03, RF04, RNF03      |
| AC28 | La evaluación posterior de entrenamiento documenta viabilidad, calidad, costo, permisos, datos revisados y evaluación reservada frente al enfoque inicial. Solo registra resultados comparativos reales si existe un candidato autorizado; no inicia entrenamiento ni concede autonomía por sí sola. | RF16, RNF08            |

Cada sprint debe completar sus criterios locales y distinguirlos de las pruebas externas. No se declara un proveedor funcional por pasar pruebas simuladas.

## Estado de decisiones y configuración de campaña

Las dos rondas funcionales están resueltas: D01–D14 corresponden a las respuestas iniciales y D15–D24 incorporan 15A, 16A, 17A, 18A, 19B, 20A, 21A, 22A, 23A y 24A. No quedan preguntas funcionales abiertas de estas rondas.

Antes de activar cada campaña se deben configurar y revisar porcentajes/filtros, máximos de intentos por secuencia, calendario/fines de semana, horas/zonas de envío y presupuestos. Son parámetros operativos obligatorios, no decisiones de arquitectura pendientes. El sistema bloqueará activación si faltan; este plan no inventa sus valores ni autoriza un envío.

Las validaciones técnicas aún pendientes son la recepción cercana a un minuto, permisos/planes API, detención segura por lead en Instantly y contratos de lectura/estados/subcuentas TextTorrent. Se resuelven en S00 antes de habilitar cada capacidad. La evaluación de entrenamiento específico es posterior al asistente supervisado y puede concluir que no conviene entrenar.

## Fuera de alcance y control de cambios

No se incluye reemplazar Next.js/Supabase, crear un CRM paralelo, incorporar otra cola por defecto, lanzar Meta Ads, operar llamadas automáticas, mover dinero, decidir automáticamente elegibilidad crediticia ni publicar cambios en producción. La expansión geográfica y nuevos productos financieros requieren su propia especificación.

La autenticación Google y sus autorizaciones siguen siendo necesarias aunque Composio centralice el acceso. La recepción rápida, permisos API/planes y capacidades exactas de Instantly/TextTorrent son dependencias de validación, no resultados confirmados.

Cada cambio posterior debe enlazar decisión, requisito, tarea y criterio. Una nueva regla significativa actualiza primero esta especificación y el diseño. S00 está autorizado en el alcance local descrito al inicio; la implementación S01–S13 y las operaciones externas con efectos requieren su autorización correspondiente.

## Continuación S00: conexiones de lectura (25 de octubre de 2026)

El usuario autorizó comprobar las tres integraciones nuevas sin enviar mensajes ni generar costos. El alcance concreto, cinco requisitos locales, aceptación y límites están en [connections.md](s00/connections.md). Se preserva la configuración Supabase/Bouncer existente; no se solicitan sus claves otra vez ni se usan destinatarios de prueba. La ejecución autenticada requiere acceso compatible con la regla global sobre archivos `.env`; no se presupone una excepción.

## Continuación S00: inventario y preparación del ensayo

El usuario amplió el diagnóstico a migraciones, permisos, límites, subcuentas y líneas, y pidió preparar Composio manteniendo la prohibición de mensajes y operaciones pagas. Requisitos/criterios/tareas S00-I-FR01–05 en [inventory.md](s00/inventory.md), con inventario real separado de capacidades desconocidas. Se reutiliza exclusivamente la excepción ya autorizada de carga interna de s00.env; no se lee .env.local. [Protocolo Composio](s00/composio-test-plan.md) y PDF ficticio preparados, ejecución deshabilitada. No cambia alcance funcional ni autoriza S01–S13.

## Ajuste de alcance: respaldo omitido para 030 en el ambiente de pruebas

El usuario indicó expresamente continuar sin respaldo y sin quitar información existente, por tratarse mayoritariamente de datos de prueba. Esta decisión sustituye el paso de backup/restauración de T00-02/R030-02 para esta aplicación puntual. Se conserva autorización para 030 original, sin cambios destructivos, envíos ni costos de proveedores; se exige postvalidar. No altera requisitos de futuros despliegues de producción. No se recrea la base ni se borra información para reestructurar la app.

## Ejecutor S00 de ensayo Composio por API

El usuario pidió preparar el ejecutor, consultar cuota y avanzar con los dos buzones usando credenciales guardadas. Requisitos S00-R-FR01–05 y criterios/tareas en [composio-runner.md](s00/composio-runner.md). Se reutiliza solo la carga interna autorizada de s00.env. El envío controlado está autorizado; la disponibilidad de llamadas incluidas es información pendiente, no otra aprobación general. No se autorizaron compras, upgrades, Instant o clientes reales. Un rate limit o cargo Instant cero no acredita cuota mensual.

## S00-R-FR06: revalidación tras permiso proxy insuficiente

La primera lectura de perfil real falló 403 antes de cualquier envío. Se añade recuperación local estrictamente limitada a rotar la clave del mismo proyecto, con destino inmutable, metadatos revalidados y contador/token conservados. No permite resetear un envío posible/real ni ampliar permisos remotamente por cuenta del agente. Diseño y aceptación negativos en [composio-runner.md](s00/composio-runner.md).

## S00-R-FR07: variante de PDF propios autorizada

El usuario autorizó leer los PDF ya enviados, sin analizar su contenido, hasta 10 MB por archivo y 40 peticiones acumuladas. Es un cambio explícito del ensayo de fixture/ACK, no del producto: reconocer respuesta por cuenta/hilo/asunto/remitente; tamaños/firma/hash de los PDF en memoria, sin parser/OCR/IA o persistencia de documentos. Requisitos y aceptación en [composio-runner.md](s00/composio-runner.md). No se afirma coincidencia contra hash del original no disponible ni se amplía autorización a otros correos.

## S00-A: planificación de recepción automática, 26 de octubre de 2026

La solicitud actual autoriza preparar protocolo y criterios, sin implementar o ejecutar. Nivel STRICT por autenticación/metadatos/consumo. [Protocolo S00-A](s00/composio-auto-receive.md) define FR01–05 y A-AC01–10: dos respuestas nuevas en hilos existentes, detección programada y asociación exacta, persistencia única, presupuesto acumulado y reporte sanitizado. Intervalo propuesto 30 s, ventana seis minutos, umbral exploratorio 60 s por muestra; valores de planificación, no SLA acreditado. Sin adjuntos/cuerpos/envíos API. Prever 13–35 peticiones nuevas sin errores, reserva hasta cinco, máximo nuevo 40 y techo acumulado propuesto 77 desde 37; el techo autorizado sigue en 40. No renumerar requisitos previos ni extender el permiso anterior implícitamente.

### S00-A: implementación offline autorizada

La solicitud posterior autoriza implementar y probar S00-A-FR01–05 sin API real. [Protocolo actualizado](s00/composio-auto-receive.md) conserva sus diez AC y el techo real40; pruebas locales inyectan fuente histórica y autorización77 exclusivamente sintéticas. Se cubren detección programada, asociación, persistencia/replay y límites en simulación, sin cuerpos/adjuntos/envíos. La aceptación operativa sigue pendiente.

### S00-A: aceptación real del alcance autorizado

El usuario amplió explícitamente a40 peticiones nuevas/77 acumuladas, sin costo adicional. S00-A-FR01–05 comprobados en positivos reales: dos respuestas nuevas detectadas, asociadas y persistidas automáticamente en menos de60s, relectura sin duplicados, 23 nuevas/60 acumuladas, reporte sanitizado. Los negativos de falla/recuperación mantienen evidencia offline. No se extiende a CRM, otros hilos, envíos o adjuntos. [Resultado operativo](s00/composio-auto-receive.md).

## S00-B: planificación de desconexión y reconexión de un buzón

La solicitud actual autoriza preparar pasos, aceptación y presupuesto, no revocar o crear conexiones. [Protocolo S00-B](s00/composio-reconnect.md), STRICT: FR01–05 y B-AC01–10 proponen M1 como objetivo y M2 como control, revocación real seguida de consentimiento OAuth del mismo Gmail, acceso histórico conservado y sin reactivar campañas. Se distingue pausa de grant revocado. Base60; normal18–21 nuevas; máximo28 con reservas, techo acumulado propuesto88. Autorización de la observación anterior no se extiende a estas mutaciones. Sin nuevos envíos, adjuntos, lectura de env o API autenticada en planificación.

### S00-B: implementación offline autorizada y verificada

La solicitud posterior autoriza T02/T03, sin API real. S00-B-FR01–05 implementados en un ejecutor por fases con gates, selección M1 exacta, M2 control, historial por metadata y binding pausado. Cuarenta y cinco tests nuevos, 140/140 S00, cubren B-AC01–10 offline. Normal18–21, máximo28 nuevas/88 acumuladas comprobados en fixtures, sin modificar el límite real60/77. [Contrato actualizado](s00/composio-reconnect.md). Aceptación operativa y permisos reales siguen pendientes.

## S00-C: preparar recuperación del Gmail M1 correcto

La solicitud actual autoriza planificación SDD STRICT, sin nuevas API o enlaces. Estado comprobado offline:81 acumuladas, diagnóstico M2, M1 pendiente y sin binding. [CR-S00-C01/protocolo](s00/composio-m1-correction.md) define siete FR y doce AC: confirmación offline del correo esperado contra huella M1, un único enlace adicional, selección humana en Google, perfil/histórico/M2/cierre y binding pausado. Normal11–13, reserva3 de lectura, máximo16 nuevas/97 acumuladas propuestos. El techo vigente88 y límite histórico de dos links no se amplían por planificar; la implementación offline y luego la ejecución requieren sus alcances correspondientes. Sin otro revoke, modificaciones de M2/env o CRM.

### S00-C: implementación offline autorizada y verificada

La solicitud posterior autoriza implementar la extensión y probarla offline, sin llamadas reales o enlaces. C-FR01–07 implementados con v2 del mismo journal, precheck M1 local, gates C97 y operación única.27 pruebas C nuevas,173/173 S00 y TypeScript correctos; C-AC01–12 cubiertos con fixtures, aceptación real pendiente. [Guía del ejecutor](s00/composio-correction-runner.md). La consulta offline del status real conservó tres journals y total81; solo se creó plantilla vacía de correo esperado. Ninguna autorización C97 o recuperación real se infiere de esta entrega.

### S00-C: aceptación operativa real autorizada

Usuario autorizó hasta16 nuevas/97 acumuladas y completó consentimiento del Gmail M1 validado offline. El ensayo C terminó **completed con11 nuevas/92 acumuladas**, candidato/perfil M1 original, histórico/relectura y M2 antes/después correctos, uso final registrado y binding pausado. C-T04/C-T05 completados en alcance; C-FR01–07 acreditados por positivos reales y negativos offline. Sin otro revoke, envíos, PDFs, cambio de env o integración CRM. El diagnóstico B=M2 y sus counters se conservan como antecedente; C no reescribe ese intento. [Evidencia final](verification.md). S00 general permanece abierto.

## S00-INS: preparar contrato y prueba de Instantly

Solicitud actual: protocolo/aceptación/presupuesto y revisar configuración, sin llamadas reales o activar envíos. Planificación STRICT dentro de T00-04, RF09/RF12/RF13/RF27/RF29. [Contrato S00-INS](s00/instantly-validation.md) define INS-FR01–08, INS-AC01–14 y seis tareas: faseA de lectura6–10/máximo12; faseB campaña/audiencia sin emisión19–20/máximo25; faseC webhook sintético9–10/máximo15 condicionado a receiver propio. Hasta52 nuevas del conjunto propuestas, sin permiso actual. Las92 de Composio se conservan y no se reutiliza su autorización.

Scopes actuales y pausa individual siguen sin acreditarse. El status operacional de Lead es read-only en el contrato revisado; cambiar interés/variable o pausar campaña no demuestra detener un lead. Diseño provisional de pasos únicos coordinados por CRM mantiene el requisito original; respuesta/detención real y aceptación de alternativa requieren INS-D posterior, no incluido en52. Este plan no cierra T00-04/S00 ni implementa S05.

### Incremento autorizado INS-A: implementación y QA offline

Usuario autorizó únicamente ejecutar el desarrollo local de fase A y sus pruebas. [Especificación/aceptación del incremento](s00/instantly-phase-a.md), A-AC01–10, implementa INS-FR01/02/07/08 en el alcance de lectura. INS-FR03–06 y las pruebas de B/C/D siguen pendientes. Default offline, gates A12, workspace/clave actuales fijados, transporte GET restringido, N10/R2, persistencia previa a cada intento, privacidad y replay sin HTTP. No se cargaron credenciales ni se ejecutaron APIs reales o envíos. La aceptación remota INS-T04 y el cierre T00-04/S00 permanecen pendientes.

### INS-R: continuación explícita tras el fallo de paginación

El ensayo A real posterior consumió4 y falló en keys. Usuario autorizó [recuperación offline](s00/instantly-pagination-recovery.md), R-FR01–06/R-AC01–06: snapshot v1 completo preservado en un futuro v2 del mismo ledger, continuidad4→máximo12, diagnóstico único de claves sin perseguir cursor, scopes desconocidos ante ambigüedad y lecturas restantes con reservas compartidas. R-T01/02/03 completados offline,24 casos nuevos y227/227 S00. Ninguna API/credencial/migración de journal real en esta entrega; fuente real idéntica y sigue en4. R-T04 real pendiente, B/C/D/S00 abiertos.
