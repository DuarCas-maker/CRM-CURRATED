# CO-SETUP — preparación del primer alta real Gmail–Composio

09/11/2026 · SDD STRICT · planificación/configuración, sin ejecución operativa. Reutiliza la especificación, diseño y aceptación de ../../onboarding-http/, los contratos CW/C2 y las reglas S01/B1. No se modifica producto ni se repiten las pruebas aceptadas. Decisión nueva confirmada: usar el buzón existente de Curated Financial; modo `existing`, una cuenta/un intento, mismo superadmin/sesión MFA y Gmail esperado derivados de esa cuenta.

## Estado comprobado

Web y worker publicados en00b0093. Postflight051-r2 aceptado y espacio autenticado recuperado. Curated Financial activa, código CURATED_FINANCIAL; BUZON-01 connected con asociación confirmed y sin histórico adicional aprobado. El código de alta no activa el transporte, y composioProductOperationEnabled sigue false.

Lectura de nombres en Environment Variables del recurso web CRM CURRATADED en Coolify, sin revelar valores ni abrir env reales: APP_ORIGIN, SUPABASE_SERVICE_ROLE_KEY e INTEGRATION_ENCRYPTION_KEY presentes. COMPOSIO_API_KEY, COMPOSIO_CONNECT_SETTINGS, COMPOSIO_CONNECT_KEYRING, COMPOSIO_MAIL_CONTEXT, COMPOSIO_CONNECT_ENABLED, MAIL_TRANSPORT_ROUTING_ENABLED e INSTANTLY_WEBHOOK_ENABLED no aparecen. Ausencia de los flags equivale al default apagado del código, no a una habilitación. No se certifican los valores secretos, el estado de la DB de configuración ni la configuración privada del proyecto Composio por leer sus nombres.

## Requisitos y criterios

| Requisito / criterio | Resultado exigido |
| --- | --- |
| CO-FR01 / AC01 | Conservar mail_accounts e historial de BUZON-01 y su marca confirmada; seleccionar «Asociar cuenta existente». No crear otra cuenta CRM ni inferir M1/M2. |
| CO-FR02 / AC02 | Un descriptor real revisado: proyecto/API key del mismo proyecto, auth config Gmail OAuth2, cuota Google acreditada, modo callback standard, generación coherente DB/env y APP_ORIGIN exacto. Ningún null o dato ficticio se publica. |
| CO-FR03 / AC03 | Un intento;5 solicitudes Composio normales y1 de reserva máxima. No reutilizar permisos/remanente de S00 ni autorizar operaciones por preparar este protocolo. Instantly43/0nuevas. |
| CO-FR04 / AC04 | Registrar candidato solamente después de identidad exacta, cuenta/config/owner/estado válidos y revisión de marca vigente. C2, permisos efectivos, selección de transporte y operación son pasos posteriores. |
| CO-FR05 / AC05 | Worker paused y ruta Gmail directa conservados; routing, webhook y operación Composio apagados. Sin mensajes, revocaciones, nuevas verificaciones de leads, histórico o activación de campañas. |

## Configuración preparada

### Decisión posterior: continuar con Hobby

09/11/2026: el usuario elige conservar Hobby. No se autoriza upgrade, recarga, consumo adicional, llamadas de proveedor ni activación. Las capturas muestran Hobby y consumo agregado de aplicaciones administradas de19,89K en7 días y21,14K en90 días; no acreditan saldo del período mensual ni consumo Proxy. El menú de métricas mostrado no ofrece Proxy, por lo que no se insiste en buscarlo allí ni se deduce saldo a partir de tool calls.

El operador informa que el buzón objetivo ya tiene una conexión en Platform. Antes de generar otro enlace, revisar manualmente el proyecto, Auth Config y propietario técnico de esa conexión, sin revelar tokens ni modificarla. El modo existing de alta se refiere a la cuenta CRM y no importa automáticamente conexiones externas. Reutilizar una conexión exigirá compatibilidad con identidad/owner/configuración y el mecanismo de asociación; el reporte del operador no certifica esas condiciones. El sobre6 sigue propuesto para el camino de alta documentado, no es una orden de crear otra conexión ni presupuesto cerrado de una eventual asociación reutilizada. Siguiente paso: inspección visual de Platform/Users/Auth Configs y completar metadatos privados, conservando el estado cerrado y el cupo aún pendiente.

Plantillas privadas locales en .local/pipeline-os/composio-onboarding-20261109/: manifest.private.json, settings.draft.json y keyring.draft.json. No contienen credenciales nuevas ni identificadores privados recuperados del proveedor; los campos null son bloqueos deliberados y no pasan el schema de producción. No copiarlas tal cual a Coolify.

1. `COMPOSIO_API_KEY`: reutilizar la clave guardada del proyecto correcto solo después de revisar proyecto y permisos. Servidor/runtime de la web; nunca argumento de build/NEXT_PUBLIC, nunca pegar en el chat. No hace falta una clave por buzón. Alcance mínimo del caller: Connected accounts Read and write, Auth configs Read only, Proxy execute (Legacy) Write only. Observability Read only es opcional para revisión, no requisito para el camino normal. No se piden Tools/Session/Triggers/Webhooks.
2. `COMPOSIO_CONNECT_SETTINGS`: `{descriptor, organizations}`. descriptor.config contiene generation, project_id, auth_config_id, quota_project_id, owner_id y callback_mode=standard. descriptor.context contiene composio_project_id, credential_version, google_quota_project_id, auth_config_revision, provenance_reference y las dos procedencias revisadas. callback_origin=https://crm.finlabinc.com debe coincidir exactamente con APP_ORIGIN. Owner es plantilla técnica; el servidor deriva el user_id del binding previo o `crm-mail:<account_id>`, nunca del correo ni del ID del actor Google. No se cambia ese owner a mano para recuperar conexiones S00.
3. `organizations`: catálogo explícito de organizaciones admitidas. Para modo existing no se envía una organización nueva, pero el schema del servidor exige una lista no vacía. Copiar el identificador auténtico de la organización existente, sin deducirlo del dominio ni usar `fixture`.
4. `COMPOSIO_CONNECT_KEYRING`: activeKeyId y keys[id] de32 bytes, codificados en base64url canónico. Preparar/guardar por canal privado al ejecutar; no se generó una clave hoy. Es independiente de INTEGRATION_ENCRYPTION_KEY: no sustituir ni rotar la clave Gmail existente. Runtime de la web, sin build. Conservar claves anteriores si hay intentos cifrados activos.
5. `COMPOSIO_CONNECT_ENABLED=false` durante toda la preparación. Solo cambiar a true en el corte explícito de alta, con configuración DB/env concordante. COMPOSIO_MAIL_CONTEXT se prepara para C2/operación posterior; no es requisito del caller de alta. No añadir estas variables al worker por preparar el alta.

Callback de aplicación: https://crm.finlabinc.com/api/mail/composio/connect/callback. Es distinto del redirect_uri Google de la OAuth app administrada por Composio. Mantener callback estándar, sin OAuth callback verifier del proyecto: el caller no implementa session_uri/complete_auth. Si ese verificador está activo, detener y evaluar compatibilidad; no apagarlo a ciegas. No registrar la URL CRM como redirect_uri de Google por confundir ambos retornos. Cookie segura HttpOnly/SameSite=Lax; usar la misma sesión/origen durante Google. TTL máximo10min y sin extenderlo por reanudar.

## Configuración durable en DB, sin nueva migración propuesta

050 ya instaló los schemas y RPC. Antes de publicar datos de configuración, leer de manera autorizada si existe composio_connect.configuration, su generación/política de sesión y el descriptor runtime vigente, solo metadatos. No ejecutar050/051 de nuevo.

La publicación revisada usa public.composio_connect_publish(jsonb) para la política inicial si aún no existe y public.composio_connect_runtime_publish(jsonb) para el descriptor. Ambas funciones exigen service_role. El segundo RPC reutiliza la política existente y avanza la generación, por lo que no se debe inicializar la política con la misma generación que se pretenda publicar después. Elegir generaciones después de observar el estado real, no asumir1. max_age_seconds/inactivity_seconds deben proceder de la política Auth revisada; no inventar valores ni cambiar Auth.

Preparar posteriormente un procedimiento atómico con los metadatos reales y postflight de configuración. Hoy no se genera SQL ejecutable con placeholders ni se marca policy_reviewed/provenance como comprobado. Es carga de configuración, no un DDL nuevo ni una razón para repetir la instalación.

## Presupuesto propuesto, no autorizado

| Fase | Solicitudes nuevas Composio | Efecto |
| --- | ---: | --- |
| Preflight de configuración |1| GET /api/v3.1/auth_configs/{id}; comparar Gmail/OAuth2/ENABLED y el config elegido antes de crear enlace. |
| Crear enlace |1| POST /api/v3.1/connected_accounts/link; un intento, sin retry automático de una emisión incierta. |
| Identidad al retorno |3| GET de la conexión, GET del auth config y POST tools/execute/proxy con Gmail GET users/me/profile. |
| Reserva de diagnóstico |1| Solo GET de esa misma conexión si hay una discrepancia; no segundo enlace ni repetición del proxy/consentimiento. |
| **Total máximo propuesto** |**6**| Camino normal5; flujo de alta en sí4. |

La consulta Gmail de perfil es1 llamada indirecta, incluida en el POST proxy anterior; no sumar otra solicitud a Composio. No se leen mensajes ni adjuntos. El navegador y Composio gestionan tráfico OAuth/Google interno cuyo total de requests no expone este código; este sobre no promete seis requests para toda Internet ni para el proveedor OAuth subyacente.

El ledger histórico S00 de corrección reporta92 solicitudes. Se conserva terminal y sin cambios; no se usa su antiguo remanente. Si se adopta ese antecedente solo como suma de control,92+6=98; no es una autorización ni un contador global de toda la organización. El alta tendrá su acta/ledger propios y contará también los intentos fallidos.

Caller CRM dirigido:8 acciones/requests previstas (opciones iniciales y de cuenta, begin, start, resume, callback, status del retorno y register); puede hacer falta adopt si una revisión cambia. No equivalen a todo el tráfico de página/Auth/PostgREST: workspace, assets, lecturas de DB y renovación de sesión se registran aparte y no consumen el contador Composio. Las fases con receipts y la correlación impiden el replay normal, pero no existe un cupo global configurable6 para cualquier número de intentos/usuarios. La autorización deberá fijar uno y detener ante error; no se promete ese techo fuera del alcance.

Costo adicional permitido propuesto:$0. Verificar en el panel del proyecto el plan real, consumo, conexiones disponibles, condiciones del OAuth app/proxy y límites de gasto. La página pública de precios no certifica el cupo de esta cuenta; si falta evidencia, no emitir siquiera el preflight API. No upgrade, pago, recarga o herramienta premium. Los scopes declarados readonly/send siguen el contrato existente; solicitarlos en OAuth no es permiso para enviar en el piloto de alta.

## Pasos de ejecución futura y aceptación

T01: completar metadatos privados desde panel Composio/Auth y catálogo CRM, revisar costo incluido, permissions/callback. T02: validar plantillas localmente contra schemas reales, comprobar ausencia de placeholders y preparar claves privadas sin mostrarlas. T03: autorizar y publicar datos de configuración, con generación/política concordantes; agregar variables runtime de la web con alta false; aplicar el cambio de entorno/reinicio/redeploy acordado conservando la pausa. T04: smoke de configuración apagada y revisión original MFA, sin proveedor. T05: autorizar el sobre6/$0 y habilitar solo el alta; preflight1, seleccionar modo existing/BUZON-01/Curated Financial, iniciar una vez, avisar al titular que seleccione el mismo Gmail en Google. T06: retorno/identidad3, adoptar la revisión vigente si se pide y registrar candidato; comprobar completed/candidato sin activar transporte. T07: cerrar acta, apagar el alta si el ensayo era temporal y conservar permisos/historial/recibos. Deshabilitar el flag no revoca una conexión externa.

Aceptar el ensayo solo con email exacto (sin publicarlo), owner/config/proyecto correctos, una cuenta CRM preexistente conservada y candidato registrado; cero mensajes/cambios de transporte y uso dentro del sobre autorizado. Guardar hashes/alias/estados, no tokens o enlaces. Ante identidad errónea, timeout,429/5xx, sesión vencida, configuración stale o cupo dudoso: detener; no crear otro enlace, adoptar otra cuenta o revocar automáticamente. Cerrar/cancelar localmente no prueba revocación de Google. Cualquier reserva debe conservar trazabilidad del intento original.

Dependencias abiertas: valores reales/revisión actual del proyecto y auth config, cupo incluido, política Auth, generación DB y claves/configuración runtime. La marca confirmada está resuelta. No se declara listo para habilitar mientras falten esas evidencias.

## Fuentes revisadas

Código del snapshot publicado: src/lib/server/mail-accounts/composio-connect/{http,provider,config,secrets,store,orchestrator}.ts y schemas composio-connect/verification-context. Lectura pública09/11: [link](https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink), [proxy](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy), [permisos API key](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions), [callback verifier](https://docs.composio.dev/reference/api-reference/connected-accounts), [OAuth propio/cuotas](https://docs.composio.dev/docs/auth-configuration/custom-auth-configs), [precios](https://landing.composio.dev/pricing). No se llamó a endpoints autenticados del proveedor.
