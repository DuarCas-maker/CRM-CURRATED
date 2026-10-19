# Checklist, progreso y respuestas incompletas

## Activación

1. Aplicar `supabase/migrations/037_underwriting_progress.sql` después de las migraciones 001–036, desde Supabase SQL Editor o el procedimiento habitual de migraciones.
2. Desplegar tanto la web como el worker con esta versión. El worker conserva la misma variable `OPENAI_API_KEY` ya configurada. No se necesita compartir una clave nueva.
3. Como superadmin, abrir **Configuración → Análisis y underwriting**. Si el límite actual es 8.000, considerar probar 16.000 para el siguiente intento. Se permite hasta 32.000; incluye razonamiento e informe y puede aumentar el consumo. El valor existente no se modifica automáticamente y los análisis anteriores conservan su configuración.
4. Abrir **Oportunidades → ficha → Análisis manual**. Revisar el checklist y usar **Revisar documentos pendientes** para incorporar/corregir/aprobar archivos en Documentos.
5. Con la solicitud, al menos cuatro extractos distintos y todos los documentos adicionales obligatorios aprobados, solicitar un nuevo análisis. El resultado anterior no se reintenta ni se convierte en un informe válido.

La web y el worker admiten un despliegue gradual previo a 037: el checklist y los errores siguen disponibles; el progreso detallado y el límite de 32.000 requieren la migración. Se recomienda aplicar la migración primero. Reiniciar también el worker: actualizar solo la web no activa la captura del motivo ni los avances por archivo.

## Qué se muestra

- Check verde: documento aprobado con archivo y huella registrados; la demo usa fuentes ficticias.
- X roja: documento ausente, sin aprobar, en corrección, aprobado sin archivo o extracto duplicado. La etiqueta explica el siguiente paso.
- Los extractos muestran número y banco. Se requieren cuatro archivos distintos, se incluyen todos los aprobados y los adicionales sin aprobar no bloquean al alcanzar cuatro distintos aprobados. El análisis verifica la cobertura mensual a partir del contenido.
- No se habilita el análisis con más de 24 fuentes aprobadas. Los documentos adicionales obligatorios también deben estar listos.
- Avance registrado por etapas: cola 0%, preparación 5%, comprobación/descarga de archivos 10–40%, análisis con OpenAI 50%, validación 85%, guardado 95% y borrador guardado 100%. Mientras OpenAI responde, la barra permanece en esa etapa; no es un porcentaje de lectura interna ni una estimación de tiempo. La vista consulta avances cada dos segundos mientras el trabajo está activo, incluso después de volver a abrir la ficha.
- Un fallo detiene la barra antes del 100%. El 100% indica que se guardó el borrador; sigue pendiente la revisión humana.

## Diagnóstico de OPENAI_INCOMPLETE_RESPONSE

La implementación anterior agrupaba cualquier estado distinto de `completed` bajo ese código y descartaba `incomplete_details`, uso de tokens e identificador de respuesta. El fallo observado tenía cinco fuentes y un presupuesto de 8.000 tokens; su causa específica no se guardó y no puede confirmarse retrospectivamente.

Ahora se distingue el agotamiento de tokens (`OPENAI_OUTPUT_LIMIT_REACHED`), filtros de contenido y resultados inciertos. Se conservan estado/motivo permitidos, límite, identificador y uso de tokens también cuando la respuesta falla o el informe no supera la validación. Los mensajes indican cómo actuar y el código queda en Detalle técnico. No se guardan informes parciales ni se reenvían automáticamente solicitudes inciertas o incompletas. Las instrucciones de salida favorecen un informe compacto sin omitir secciones, fuentes ni riesgos relevantes.

OpenAI documenta que `max_output_tokens` incluye el razonamiento y la salida visible y que agotarlo puede dejar una respuesta incompleta: [guía de razonamiento](https://developers.openai.com/api/docs/guides/reasoning). Un presupuesto mayor reduce esa posibilidad, pero no garantiza el éxito ni permite atribuir el fallo antiguo con certeza.

## Verificación

Se verifican requisitos reales, duplicados, mensajes, barra accesible, respuestas incompletas sin reenvío, preservación de diagnósticos/uso, avances del worker por archivo, permisos del RPC, lease vigente, progreso sin retrocesos, fallos antes del 100% y configuración versionada hasta 32.000 sin modificar ejecuciones anteriores.

Comandos: `pnpm exec tsx --test tests/underwriting-feedback.test.ts tests/underwriting.test.ts`, `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm build`.

La prueba visual de `/demo` comprueba un expediente vacío con botón deshabilitado, el acceso directo a Documentos y un expediente completo con cinco checks verdes y borrador al 100%. No se enviaron documentos reales ni solicitudes de pago a OpenAI en estas pruebas.

## Corrección del corte a los tres minutos

Después de activar 037, el registro del intento de 16.000 tokens confirmó un corte a los 180,03 segundos desde el inicio de la API. El código anterior cancelaba la conexión con `AbortSignal.timeout(180000)`. El intento anterior de 8.000 sí conservó `incomplete_reason=max_output_tokens`, por lo que son dos fallos diferentes: elevar el presupuesto no corregía el tiempo de espera.

El underwriting ahora solicita `stream: true`, recibe los eventos de OpenAI mientras se genera el informe y dispone de un máximo total de quince minutos. Solo se acepta el objeto Response de un evento terminal; nunca se transforma el texto parcial en un informe. Los cortes, tiempos agotados y errores del stream conservan el identificador de respuesta si OpenAI ya lo había enviado y no provocan un segundo envío automático. La solicitud conserva `store: false`, el modelo y el presupuesto configurados. La clasificación breve de documentos mantiene su comportamiento y su tiempo de espera anterior.

**No requiere otra migración.** Desplegar esta corrección en web y, especialmente, en el worker. Se puede mantener el límite de 16.000. Una vez actualizado el worker, solicitar un nuevo análisis desde la ficha; las ejecuciones anteriores permanecen en el historial con su resultado original. Si vuelve a agotarse el presupuesto, se mostrará el error específico de tokens; si la conexión se corta o vence el máximo de espera, se mostrará el motivo de conexión correspondiente.

Las pruebas de `tests/underwriting-stream.test.ts` verifican eventos partidos entre chunks y caracteres UTF-8, uso de la espera de quince minutos, respuestas incompletas, interrupciones, fallos antes/después de los encabezados, preservación del identificador y ausencia de reenvíos o datos sensibles en los errores. Una comprobación real con el mismo modelo recibió correctamente un informe JSON mínimo por streaming en una sola solicitud: 43 tokens de entrada y 14 de salida, sin archivos de clientes. Esta comprobación valida la conexión, no el contenido de un expediente real.

Referencia de implementación: [streaming de Responses](https://developers.openai.com/api/docs/guides/streaming-responses).
