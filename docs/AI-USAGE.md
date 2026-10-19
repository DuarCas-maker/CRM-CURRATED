# Claves y consumo por servicio

| Servicio | Variable | Coolify Production / Runtime |
|---|---|---|
| Análisis manual / riesgo | `R_OPENAI_API_KEY` | Web y worker |
| Completar aplicación con documentos | `A_OPENAI_API_KEY` | Web |
| Identificar tipo de documento | `D_OPENAI_API_KEY` | Web |

Las claves deben ser diferentes en OpenAI para atribuir costos por clave. Los nombres de variables por sí solos no separan el consumo si contienen la misma clave. No se usa `OPENAI_API_KEY` como respaldo ni se cambia el modelo configurado. No agregar estas claves a Build, `NEXT_PUBLIC_*`, Supabase ni Git.

## Activación y prueba

1. Aplicar **041_ai_service_usage.sql** en Supabase SQL Editor, después de las migraciones de underwriting existentes hasta 038. Esta migración no depende de 039 ni 040 ni requiere volver a ejecutarlas.
2. Guardar las variables anteriores en Coolify y desplegar **web y worker** con este commit.
3. Como superadmin, abrir **Configuración → Análisis y underwriting → Consumo de IA por servicio**. Seleccionar 7, 30 o 90 días y actualizar. Solo el superadmin con MFA puede consultar esta contabilidad global; vendedores y closers no tienen acceso.
4. Ejecutar una extracción de aplicación, identificar un archivo nuevo y generar un análisis de riesgo. Cada llamada nueva debe aparecer con su servicio/modelo, clave por nombre, fecha, estado y tokens. Reabrir una identificación ya almacenada utiliza la caché del CRM y no genera una llamada ni un registro adicional. Descargar PDFs o cambiar el idioma de un análisis guardado tampoco consume otra llamada.

La tabla `ai_usage_events` registra oportunidad, usuario, modelo, servicio, nombre de variable, referencia de OpenAI, fecha, duración y tokens informados de entrada/salida, caché y razonamiento. No guarda claves, fragmentos de claves, prompts, respuestas, nombres de archivos ni contenido de clientes. El detalle conserva los identificadores de oportunidad y usuario para conciliación autorizada en la base de datos.

Una entrada se guarda **antes** de llamar al proveedor. Si no se puede registrar, la llamada se bloquea con `OPENAI_USAGE_UNAVAILABLE`, sin consumir otra clave. El fallo de registro suele indicar que falta 041 o que hay un problema de conexión/permisos. Un fallo al cerrar el registro no descarta un informe recibido ni reenvía la solicitud a OpenAI: queda una fila sin cierre confirmado y se emite `AI_USAGE_FINALIZATION_PENDING` con solo metadatos de consumo para conciliar. Los resultados inciertos e incompletos conservan los tokens que el proveedor haya informado. Un valor desconocido queda `null`, nunca se inventa cero. La contabilidad conserva las filas si se elimina una oportunidad, desvinculando sus identificadores.

La sección muestra totales de tokens conocidos y las últimas 50 llamadas del período. El resumen se calcula en SQL sobre todo el período, no sobre esas 50 filas. Caché forma parte de entrada y razonamiento de salida: no se suman otra vez. El registro comienza al desplegar esta versión; no reconstruye el historial anterior ni cambia los registros originales de underwriting. No es una aprobación o rechazo financiero del cliente.

No se inventan importes en dólares: conciliar los costos facturados por clave/proyecto en OpenAI, utilizando las referencias y tokens del CRM. Una llamada fallida o incierta puede haber consumido tokens; consumo desconocido no significa costo cero. Referencia: [API de costos](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs).

## Verificación

Las pruebas de `tests/ai-usage.test.ts` comprueban claves independientes sin respaldo, registro previo a la llamada, tokens reales de respuestas completas/incompletas/inválidas, conexiones inciertas sin consumo inventado, fallos del registro sin reenvío al proveedor, permisos de escritura, MFA, agregación del período completo y cierre inmutable. La suite completa pasó 203 pruebas y la compilación de producción terminó correctamente. La revisión visual de la demo verificó ambos idiomas y el filtro de período; `ai-usage-es.png` y `ai-usage-en.png` contienen cifras ficticias. No se enviaron archivos de clientes ni se consumieron las nuevas claves en estas pruebas. Aplicar 041 y probar los tres servicios en producción sigue siendo necesario para verificar la configuración real de Coolify.
