# CO-SETUP-r1 — evidencia de preparación

Actualización09/11: elección explícita Hobby registrada en protocolo, presupuesto y manifiesto privado. Upgrade no autorizado; cupo del ensayo sigue sin confirmar. Se conserva la información del operador sobre una conexión Platform existente como pendiente de revisión, no como identidad/correspondencia probada. No se generan enlaces ni se usa esa conexión en esta actualización.

09/11/2026. Modo planificación con SDD y revisión de integración. El usuario confirmó usar el buzón existente, una sola cuenta, bajo Curated Financial. No se interpretó esa selección como permiso de tráfico, OAuth, despliegue o activación.

## Comprobaciones ejecutadas

- Se trazaron createLink/readIdentity del proveedor publicado:1POST link y3 solicitudes de identidad, con GET del auth config antes del proxy Gmail. El código usa APIv3.1, timeout por request10s, fase identidad30s y TTL de intento máximo10min. No hay retries de fetch en el adaptador. El caller y los receipts se revisaron para no proponer otro enlace ante un estado incierto. Esto no es una nueva prueba contra el proveedor.
- La documentación oficial vigente mantiene link y proxy con los campos usados. Se revisaron permisos de la API key, callback verifier, cuotas OAuth y precios; esas páginas no acreditan la configuración privada ni el cupo disponible del proyecto. URLs en protocol.md. No se envió ninguna petición autenticada a Composio o Gmail.
- En Coolify se leyeron únicamente los nombres visibles de variables del recurso web correcto. No se guardaron cambios, abrieron valores de secretos, pidieron credenciales ni generaron claves. Los tres valores de alta/APIkey faltantes están registrados en el protocolo y manifiesto privado. Flags ausentes siguen sus defaultsfalse.
- Se leyó como antecedente el total92 del resultado histórico S00, sin modificarlo, reabrir su ejecución ni usar remanente. Instantly43 no se consultó remotamente.
- Validador local de preparación, con Node22.23.4/tsx: JSON legibles,5normales+1reserva=6,4del alta en sí y proyección92+6=98. El schema real rechaza el descriptor incompleto deliberadamente; keyring vacío y0secretos generados. Los tres archivos privados están ignorados por Git. Resultado local: .local/pipeline-os/composio-onboarding-20261109/validation.json.
- Comprobación de preservación local:49huellas privadas previas iguales, artefactos050 iguales, HEAD00b0093 e invariant de operación Composiofalse. El helper también referencia el smoke5GET histórico de publicación; no se ejecutó de nuevo ese smoke ni acredita el alta.

## Trazabilidad y límites

CO-FR01/AC01: decisión de modo existing y marca confirmada incorporadas al manifiesto; no se crea una cuenta ficticia ni se fijan IDs por inferencia. CO-FR02/AC02: contrato/configuración y campos pendientes preparados, no completos. CO-FR03/AC03: presupuesto calculado y no autorizado. CO-FR04/AC04: cierre candidato separado de C2/transporte. CO-FR05/AC05:0llamadas de proveedor,0mensajes,0cambios remotos y0peticiones Instantly en esta preparación.

No se modificó código de producto, dependencias o SQL; no se repitieron suites ni pilotos ya aceptados. No se aplica otra migración para preparar estos artefactos. No se ejecutaron RPC de publicación de configuración. La lectura directa de la configuración durable y de la política Auth, la revisión del auth config/proyecto/cupo actuales y el ensayo real siguen pendientes. No se marca readyForActivation ni se promete un cupo global en el runtime que el código no tiene.

T01/T02 están preparados como checklist/plantillas con gates visibles; T03–T07 son ejecución futura. El siguiente paso útil es completar/revisar privadamente proyecto, auth config, cuota Google y cupo incluido, conservando flags apagados. Después se podrá concretar la publicación de configuración y la autorización del ensayo con hasta6solicitudes nuevas. No se amplía el alcance a operación Composio ni a otro buzón.
