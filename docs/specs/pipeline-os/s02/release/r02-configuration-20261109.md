# R02 — primera marca y asociación real de buzón

09/11/2026 · SDD STRICT · ejecución por la UI publicada del CRM Qrated. Se reutilizan las reglas S01/B1 y el protocolo de R02, sin cambios de código o SQL. El usuario confirmó explícitamente Curated Financial como marca del único buzón conectado observado; la respuesta se recibió a la pregunta previa a asociar la cuenta.

## Alcance y trazabilidad

- R02-FR01 / AC01 / T01: verificar catálogo vigente, evitar duplicados y crear Curated Financial con código estable CURATED_FINANCIAL y estado activo. Catálogo actualizado sin marcas previas; creación guardada y marca visible activa.
- R02-FR02 / AC02 / T02: proponer la asociación solo de BUZON-01, único buzón existente conectado, con evidencia de la confirmación del titular. No se deduce la marca del dominio, ni se conecta otro buzón. Propuesta guardada como pending y revisión seleccionada con cuenta/marca correctas.
- R02-FR03 / AC03 / T03: revisar impacto antes de confirmar; colas/envíos en curso/inciertos/campañas activas mostraron0/0/0/0. Histórico adicional no aprobado y fechas vacías. Se confirmó la propuesta por la UI; no se editaron membresías, permisos de remitente, campañas o históricos.
- R02-FR04 / AC04 / T04: después de recargar, la colección de revisiones muestra confirmed y la cuenta muestra connected/Curated Financial. Los selectores de Asociación Composio y Transporte de cada cuenta ahora ofrecen una cuenta. Sin alertas observadas ni error de carga del espacio.
- R02-FR05 / AC05: conservar Gmail directo, worker paused, routing/Composio/webhook sin activación y43 peticiones Instantly. No se cambió configuración de Coolify, no hubo OAuth, mensajes, llamadas a proveedores, SQL manual, push o despliegue en esta ejecución. Las llamadas a la app para consultar y guardar marca/propuesta/confirmación sí forman parte de esta operación autorizada.

## Evidencia y límites

Se observaron los recibos de guardado y el estado persistido por UI tras recarga. El rol visible de la sesión es Superadmin, que conserva su excepción administrativa existente; no se inventa una membresía ni se concede acceso a otra persona. No se copian correos, IDs privados, cookies o datos de clientes en este registro. BUZON-01 representa únicamente el buzón revisado, no la etiqueta histórica M1/M2.

Captura recortada sin direcciones: .local/pipeline-os/r02-20261109/brand-confirmed-panel.png. No publicar las capturas amplias de trabajo, que pueden mostrar otros paneles o datos privados.

Esta evidencia acepta la configuración de marca del primer buzón bajo el actor actual. No acredita todo R02 para otros miembros/roles, permiso de envío de otro usuario, transporte seleccionado, alta Composio, verificación C2, piloto de mensajes o reanudación del worker. No se repitieron las pruebas aceptadas de recepción, adjuntos, importación ni051.

## Recuperación y siguiente paso

No se ejecuta una reversa por comprobar el resultado. Si se requiere cambiar la marca, usar una nueva propuesta/revisión vigente y revisar su impacto; no borrar el historial, modificar revisiones manualmente ni usar SQL para saltar el flujo. Desactivar la marca por su operación administrativa normal requiere una decisión explícita y no elimina la asociación confirmada.

Siguiente bloque: preparar la configuración auténtica del alta Gmail–Composio (descriptor/auth config, callback del CRM, credenciales de servidor, cifrado y cupo incluido) y su presupuesto. La habilitación y OAuth real se autorizan en ese paso; la marca activa no los habilita por sí sola. Instantly C permanece pendiente.
