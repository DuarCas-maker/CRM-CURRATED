# Centro de Control de Financiamiento y Seguimiento

Alcance confirmado el 19 de octubre de 2026: renovar únicamente Resumen, conservar el expediente y las conversaciones existentes, seis KPI principales, totales secundarios siempre visibles e iconos de explicación accionables por teclado, clic y toque. ES/EN; negro, crema y champagne. No dispara correo, IA ni comandos comerciales al consultar.

## Contrato y unidades

`financing_control_dashboard(...)` (migración 042) es independiente de `operational_dashboard(...)`. La migración 034 ya modifica v1: no se reemplaza su contrato. La web conserva v1 cuando la función nueva no está instalada y muestra que faltan las métricas nuevas. Otros errores no se convierten en ceros.

Una fila representa un **proceso activo**, o un **expediente sin proceso asociado**. También se conserva una fila separada para comunicaciones/solicitudes antiguas sin proceso, aunque el expediente tenga procesos activos. Las tareas, documentos, aplicación y análisis siguen siendo información compartida del expediente: no certifican vigencia para cada renovación. Identificador ordinal y etapa del proceso no se confunden con etapa de oportunidad.

| Indicador                     | Unidad y fórmula                                                                                                                                                                                                                                                        | Acceso                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Procesos activos              | `classification=active`, `ended_at IS NULL`, estado distinto de desembolsado, retiro o financiación declinada. No incluye archivo de correo sin clasificar.                                                                                                             | `can_case`; etapas closer ocultas para seller |
| Total de procesos             | Procesos registrados del universo de oportunidades filtrado, excluyendo el contenedor de archivo sin clasificar. Se informa por separado clasificación desconocida.                                                                                                     | `can_case`                                    |
| Oportunidades activas         | Oportunidades distintas de las filas seleccionadas; un expediente con dos procesos cuenta una vez. Incluye expediente con proceso activo aunque la etapa de oportunidad esté cerrada.                                                                                   | `can_case`                                    |
| Total de oportunidades        | Oportunidades no archivadas del universo general filtrado.                                                                                                                                                                                                              | `can_case`                                    |
| Pipeline solicitado USD       | Suma de `opportunities.amount` una vez por oportunidad seleccionada cuya propia etapa no sea funded/lost/paused. Total secundario: importe solicitado de todas las oportunidades del universo general filtrado. No es aprobación ni desembolso.                         | `can_case`                                    |
| Documentación completa        | Expedientes distintos con aplicación completa/firmada y todos los requisitos aprobados, con archivo/hash/revisor/fecha. Requisitos: aplicación + cuatro hashes bancarios distintos + adicionales obligatorios. Los extractos opcionales vacíos no inflan denominadores. | `can_case`                                    |
| Recibidos / aprobados         | Requisitos cubiertos, máximo cuatro extractos para el mínimo obligatorio; recibidos exigen archivo/hash. Aprobados añaden estado approved y revisión humana. Por revisar y por corregir se informan aparte.                                                             | `can_case`                                    |
| Aplicación                    | Pendiente, borrador (existencia de aplicación cifrada por empresa), recibida, firmada o aprobada según evidencia del archivo y metadatos del expediente. No se descifra ni entrega información sensible.                                                                | `can_case`                                    |
| Riesgo por resolver           | Borradores + desactualizados + fallidos + inciertos + descartados, una vez por expediente. Última ejecución y análisis humano vigente se consultan por separado. 100% no significa aprobación. Bloqueados y no iniciados tienen desglose propio.                        | `can_case`                                    |
| Procesos con envío confirmado | Procesos distintos con submission no borrador y outbox sent con fecha/ID de Gmail, reconciliado con mensaje saliente sent de la misma submission y expediente. Varios correos no duplican la submission.                                                                | Área closer                                   |
| Aplicación en paquete enviado | Existencia de versión en `submission_documents` correspondiente al envío confirmado. No exige que el archivo actual siga siendo idéntico al enviado: se conserva el hecho histórico de la versión enviada.                                                              | Área closer                                   |
| Respuestas                    | Submissions distintas con mensaje entrante received posterior al primer envío confirmado. No implica respuesta comercial favorable ni aprobación.                                                                                                                       | Área closer                                   |
| Ofertas                       | `received` sin vencimiento o con vencimiento futuro: activas. Próximas: vencimiento futuro dentro del plazo configurado. Vencidas se muestran aparte y no ocupan la prioridad de una oferta vigente en riesgo.                                                          | Área closer                                   |
| Desembolsos USD               | Suma de `opportunities.funded_amount` con fecha real `funded_at`, no futura, en la ventana. Conteo secundario de operaciones. No suma `actual_funded_amount` de procesos históricos: registros históricos pendientes de conciliación se informan aparte.                | Área closer; seller recibe null               |

## Filtros y períodos

La búsqueda, responsable (seller o closer asignado), campaña, etapa de oportunidad y fecha de creación delimitan el universo actual de expedientes. Los filtros operativos, etapa de proceso y permanencia se aplican antes de los conteos seleccionados, barras, alertas y paginación de 50 filas. Los denominadores de procesos y oportunidades registrados y el importe total solicitado mantienen el universo general para comparar el subconjunto operativo con el registro completo. Las etiquetas y las explicaciones indican esta diferencia.

Desembolsos aplica búsqueda, responsable y campaña sobre expedientes autorizados, pero filtra **fecha de desembolso**, sin exigir creación del caso en la ventana. No cambia por pestañas operativas, etapa de oportunidad ni permanencia. No se mezclan estos eventos con el pipeline actual. No hay tendencias o conversiones históricas inventadas.

## Temporizadores y evidencia

`process_state_history` registra inserciones y cambios reales del estado de proceso posteriores a instalar 042, con estado anterior/nuevo, fecha y actor disponible. No se hace backfill. Cambiar notas o repetir el mismo estado no reinicia el reloj. Si falta la fila actual correspondiente al estado, la pantalla muestra **Sin fecha verificable**. El reloj mide la transición registrada en el sistema; no retrofecha el momento a un correo histórico.

Ya existía `stage_history` para oportunidades, con una carga inicial basada en created_at. No se reutiliza esa carga como evidencia de entrada a una etapa de proceso.

SLAs desde `operational_settings`, horas calendario: equipo 24, seguimiento cliente/lender 120 y oferta 48 inicialmente. Se conserva `mail_waits` y el último mensaje confirmado de conversaciones antiguas con atención registrada. No se usa unread de Gmail. Último mensaje entrante y saliente se muestran por separado y por proceso; hilos sin proceso no se atribuyen a uno de los procesos por inferencia.

## Prioridad y navegación

Orden: oferta vigente próxima a vencer, conversación pendiente, tarea/seguimiento vencido, falta de responsable, revisión/corrección documental, riesgo por resolver, proceso con al menos siete días en la etapa auditada. Los seguimientos todavía no vencidos siguen disponibles sin alerta crítica. Cada alerta incluye motivo, siguiente acción, fecha y responsable; una tarea vencida utiliza el propietario real de la tarea. Abrir documentos/análisis/lenders lleva a la pestaña existente; correo abre las conversaciones del expediente seleccionado. No se ejecuta la acción desde Resumen.

## Activación y reversión

Requiere todas las migraciones previas 001–041. Preparar 042 y su revisión sobre una copia; este trabajo no autoriza ni ejecuta migraciones remotas o despliegues. La reversión está en `supabase/rollbacks/042_financing_control_dashboard.sql`; exportar la tabla nueva de transiciones antes de revertir si sus registros deben conservarse. V1 y los otros historiales permanecen intactos. Una reinstalación no reconstruye el historial eliminado.

## Límites deliberados

- No hay monto solicitado por proceso ni asociación de documentos/análisis por proceso. No se crean copias ni atribuciones automáticas.
- Un envío por portal o histórico sin correo reconciliado no se certifica como envío confirmado por esta métrica. Requiere un contrato explícito de evidencia independiente.
- No se suman dos fuentes de desembolso sin conciliación; el conteo histórico separado puede incluir un registro de la misma operación.
- Las fechas/timestamps ausentes se presentan como no disponibles; no se utilizan updated_at ni started_at como sustitutos de transición.
- Los iconos de ayuda son disclosures nativos (`details`/`summary`), accesibles por teclado y toque, no solamente por hover.
- La demo conserva datos ficticios y presenta como no disponibles los envíos para los que no tiene evidencia de reconciliación. No certifica producción.

## Presentación compacta

El seguimiento toma como referencia `curated-dashboard-prototipo.html`: barra de requisitos aprobados, columnas independientes para documentación y aplicación, estados breves de riesgo y comunicación resumida desde mensajes con fecha real. El filtro de atención es un único selector junto a etapa y permanencia. Encabezados, controles y contenido de gráficas tienen espacio interior consistente.

Cada fila permite abrir **Detalle / Details** para consultar los conteos documentales, las fechas entrantes/salientes, SLA, versiones enviadas, ofertas y motivo de la acción. **Ver desglose / View breakdown** conserva los subtotales del expediente sin ocupar la vista inicial. El cambio es de presentación: conserva RPC, filtros de servidor, permisos y significado de las métricas. No requiere otra migración. En móvil, la tabla se desplaza dentro del panel y no ensancha la página.

Verificación del ajuste: 15 pruebas existentes de financiación y seguimiento aprobadas, typecheck y build webpack con Node 22 en una copia aislada de los cambios de campañas en curso. Revisión de navegador en ES/EN, selector, apertura/cierre de detalle por teclado, barras y márgenes de escritorio, y ausencia de desbordamiento de página en móvil. Evidencias: `.local/control-visual-desktop.png` y `.local/control-visual-mobile.png`.

## Verificación

`tests/financing-control.test.ts`: unidades independientes, deduplicación de importes/requisitos, recepción/aprobación, extractos repetidos, borrador y cambio de fuentes, cola/incertidumbre/confirmación, varios lenders y correos, paquete congelado, vencimiento real de oferta, transición auditada, permisos/MFA, período de desembolso, paginación y reversión/reinstalación. Las suites existentes de DB y seguimiento se mantienen.

Validar además con `pnpm test`, `pnpm test:db`, `pnpm typecheck` y `pnpm build`, usando Node 22 según engines. La validación local no verifica el estado de las migraciones ni el despliegue remoto.

Resultado local de esta entrega: 219 pruebas aprobadas (ejecución completa con concurrencia 2), aceptación de base de datos, `next typegen`, `tsc --noEmit` y build Turbopack aprobados en Node 22.23.3. El caso de agregado incluye más de mil filas, con total independiente de la página. Se comprobó en navegador la demo en ES/EN, las seis referencias numéricas visibles, ayuda por clic y Enter, viewport móvil, ausencia de desbordamiento al abrir la ayuda y navegación a Documentos y a las conversaciones del expediente correcto. Evidencias locales: `.local/financing-control-desktop.png` y `.local/financing-control-mobile.png`. No se aplicó ninguna migración remota ni se desplegó.
