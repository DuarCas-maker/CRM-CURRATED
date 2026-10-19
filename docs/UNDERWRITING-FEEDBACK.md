# Checklist, progreso y respuestas incompletas

## Activación

1. Aplicar `supabase/migrations/037_underwriting_progress.sql` después de las migraciones 001–036 y luego `038_underwriting_human_review.sql`, desde Supabase SQL Editor o el procedimiento habitual de migraciones. Si ya se aplicó 037, ejecutar solamente 038.
2. Configurar `R_OPENAI_API_KEY` exclusivamente en Runtime de web y worker y desplegar ambos. Esta variable independiente corresponde al análisis de riesgo. Para extracción e identificación se usan `A_OPENAI_API_KEY` y `D_OPENAI_API_KEY` en la web. Aplicar también 041 para el registro de consumo; véase [AI-USAGE.md](AI-USAGE.md). No compartir claves en el chat ni guardarlas en el repositorio.
3. Como superadmin, abrir **Configuración → Análisis y underwriting**. Si el límite actual es 8.000, considerar probar 16.000 para el siguiente intento. Se permite hasta 32.000; incluye razonamiento e informe y puede aumentar el consumo. El valor existente no se modifica automáticamente y los análisis anteriores conservan su configuración.
4. Abrir **Oportunidades → ficha → Análisis manual**. Revisar el checklist y usar **Revisar documentos pendientes** para incorporar/corregir/aprobar archivos en Documentos.
5. Con la solicitud, al menos cuatro extractos distintos y todos los documentos adicionales obligatorios aprobados, solicitar un nuevo análisis. Al recibir el informe se abre la revisión: leer contenido, fuentes y observaciones, descargar el PDF y registrar la decisión humana. El resultado anterior no se reintenta automáticamente.

## Informe disponible y decisión humana (038)

Un informe recibido de la IA se guarda como borrador consultable aun cuando una comprobación de cifras, evidencias, períodos, lenders o criterios encuentre inconsistencias. Se conserva el contenido original y se muestran las observaciones específicas; no son una aprobación ni un rechazo de la solicitud. La versión estructurada facilita la lectura y los cálculos auxiliares. Si una exclusión supera los depósitos, el cálculo auxiliar queda sin confirmar; los valores originales siguen visibles. Si la respuesta completa viene con formato inesperado o texto en lugar de JSON, se ofrece su contenido original para lectura, sin inventar un análisis sustitutivo.

**Ver análisis** permite reabrir el informe en cualquier estado, incluyendo descartado o desactualizado. **Descargar informe PDF** incluye el contenido original, los archivos enviados, observaciones, cálculos auxiliares y el estado de revisión. Los archivos y PDFs conservan los permisos del expediente; las referencias desconocidas no conceden acceso a otros archivos.

El usuario confirma que revisó el contenido y puede **Aprobar informe y guardar revisión**, completando su resumen, conclusión, observaciones y recomendaciones; o **Descartar informe y guardar observación**, indicando un motivo. Descartar no elimina el informe ni crea un análisis aprobado. Se registran usuario, fecha y actividad. Cerrar deja la decisión pendiente. Los documentos modificados impiden aprobar una versión desactualizada, pero se conserva su consulta. El 100% significa que el documento se guardó, no que una solicitud de financiación fue aprobada.

Los intentos antiguos que fallaron con `UNDERWRITING_REPORT_REQUIRES_REVIEW` descartaron el contenido: no es posible reconstruirlo desde ese registro. Hace falta generar un nuevo informe después de actualizar el worker. Un error de conexión sin respuesta utilizable sigue mostrando un fallo técnico; el CRM no fabrica un documento de análisis que OpenAI no haya entregado.

Pruebas: `tests/underwriting-human-review.test.ts` verifica conservación íntegra del contenido, avisos múltiples, cálculos inconsistentes, formatos inesperados, PDF, permisos/MFA, rechazo idempotente, aprobación explícita, historial y el recorrido real del worker con OpenAI simulado. La prueba visual en `/demo` abre un informe con observaciones, comprueba el bloqueo de las decisiones sin confirmación, descarta y reabre el informe con su motivo, descarga el PDF y verifica una aprobación humana independiente. No se enviaron documentos reales a OpenAI para estas pruebas.

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

## Informe compacto en español e inglés

Los análisis nuevos incluyen un memo compacto inspirado en la estructura de los ejemplos: conclusión sugerida, ficha, resumen bancario, posiciones y otras deudas, riesgos, tier/SBA condicionado, opciones de lenders, pitch, pendientes y notas para CRM. La extensión objetivo es de 500–700 palabras por idioma, adaptada al expediente; no se recorta el contenido al descargar. Los ejemplos sirven de referencia de presentación: no se incorporan sus datos de clientes, contactos ni supuestos guidelines al catálogo.

Una sola solicitud genera los textos en ambos idiomas y comparte cifras, identificadores y tipos de deuda. La pantalla selecciona la versión del idioma del sistema. **Idioma del PDF / PDF language** permite descargar cualquiera de las dos versiones, sin otra llamada a OpenAI; las notas para CRM se copian en el idioma de la pantalla. El promedio de ingresos suma las cuentas de un mismo mes y conserva los importes desconocidos sin convertirlos en cero. Un pago semanal no se clasifica automáticamente como MCA.

El informe compacto es la vista principal y el PDF habitual. **Ver detalle técnico, fuentes y respuesta original** conserva el análisis estructurado completo para inspección. Las inconsistencias o contactos no respaldados por el catálogo se señalan para revisión, sin ocultar el informe. La aprobación o descarte sigue siendo una decisión explícita del usuario. No se realizan consultas judiciales, envíos a lenders ni cambios de pipeline por generar el texto.

**Activación del formato bilingüe:** configurar `R_OPENAI_API_KEY`, desplegar web y worker y generar un análisis nuevo. El formato no requiere otra migración sobre 038 ni modificar el modelo o el límite configurado; el registro de consumo agregado posteriormente sí requiere 041. Los informes anteriores conservan su contenido y su idioma original; elegir otro idioma solo traduce sus etiquetas, por lo que hace falta un análisis nuevo para disponer del memo bilingüe.

## Clave independiente para análisis de riesgo

En Coolify, agregar **una variable nueva** `R_OPENAI_API_KEY` en Production / Runtime de **web y worker**, guardar y volver a desplegar ambos recursos. El worker utiliza únicamente `R_OPENAI_API_KEY` para underwriting; si falta o solo tiene espacios, el análisis informa que falta configuración sin consumir la clave general. La web comprueba su propia variable para habilitar solicitudes, pero no confirma la configuración del worker: debe agregarse en ambos recursos. La extracción y clasificación ahora usan `A_OPENAI_API_KEY` y `D_OPENAI_API_KEY`, respectivamente, sin respaldo en `OPENAI_API_KEY`. No se cambia ninguna clave desde el prompt ni se guarda en Supabase. Para pruebas locales, agregar las variables también en `.env.local` y reiniciar los procesos locales. Consultar [AI-USAGE.md](AI-USAGE.md) para activar la migración 041 y el seguimiento por servicio.

No requiere migraciones, cambios de modelo ni otra llamada de IA para configurar la separación. Los informes guardados siguen consultables sin clave de riesgo; solo la generación nueva requiere la credencial. Las ejecuciones que ya estaban procesándose pueden conservar la clave cargada por el proceso anterior, por lo que conviene esperar a que terminen antes de desplegar. Para verificar el cambio, generar un análisis nuevo después del despliegue. Una clave de otro proveedor requiere adaptar la conexión; esta variable sigue usando la API de OpenAI.

Verificación: 165 pruebas automatizadas pasaron, incluyendo seis casos nuevos sobre equivalencia de idiomas/cifras, promedio multibanco, contrato de salida, observaciones sin bloqueo, PDF compacto y clasificación de saldo agotado durante streaming. Se verificaron visualmente la misma demo en ambos idiomas, el selector independiente del PDF y los dos PDF ficticios de dos páginas. Evidencias: `underwriting-compact-es.png` y `underwriting-compact-en.png`.

La comprobación real del 19 de octubre de 2026 con archivos ficticios recibió `insufficient_quota / credit_balance_exhausted`: la cuenta API no tenía créditos. No se pudo verificar la generación real del nuevo formato. Ese error explícito, incluso dentro de una conexión HTTP 200 por streaming, ahora se clasifica como `OPENAI_QUOTA_EXHAUSTED` y no como un corte incierto; no se reintenta. Revisar [facturación de la API](https://platform.openai.com/settings/organization/billing) antes de generar otro análisis. No se enviaron documentos de clientes en estas pruebas.
