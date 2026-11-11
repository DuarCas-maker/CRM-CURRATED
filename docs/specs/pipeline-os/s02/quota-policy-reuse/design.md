# Diseño QGR v1

Estado posterior10/11: I03 y [CR-TI01/tokeninfo](i03-tokeninfo.md) implementan el
adaptador servidor con evidencia [offline](i03-tokeninfo-verification.md). Fuente
concreta: tokeninfo por proxy fijo, sin exportar tokens. La compatibilidad de la
conexión real e I04–I06 siguen pendientes; el diseño original inferior es histórico.

Actualización10/11: I01 se concretó en [i01-design.md](i01-design.md), con [resultado offline](i01-verification.md). I02 concreta las partes SQL en [i02-design.md](i02-design.md), con [evidencia propia](i02-verification.md). Las propuestas de integración servidor/UI siguientes continúan pendientes; el texto original conserva su alcance de diseño.

10/11/2026 · STRICT · propuesta, sin código o SQL ejecutable nuevo. [Spec](spec.md), [ADR/CR](decision.md), [aceptación](acceptance.md).

## 1. Arquitectura observada

- C1 registra IDs técnicos y deriva el email de mail_accounts. Admite el owner externo existente, incluido uno de pruebas, sin convertirlo en autoridad humana. Exclusividad por proyecto Composio+conexión, CAS y revisión de marca.
- C2 compara google_quota_project_id contra un contexto declarado y exige facts.quota. No consulta saldo Google ni saldo Composio. El verificador inyectable y sus pruebas existen; la ruta publicada de asociación llama a composioBindingCommand, no inicia por sí sola la comprobación C2 externa. El DTO SQL sigue verification_available=false.
- Connect incluye ese identificador en configuración/persistencia. El modo existing se refiere a cuenta CRM; start emite link. QGR no usará start para adoptar una conexión ya existente.
- runtime-context verifica huellas y cuota antes de preparar transporte. google.ts llama a reserve_gmail_api; SQL039 agrupa por project, pacea por cuenta y frena a75.000.000 unidades/ventana móvil. No es un simple campo decorativo.
- composio-proxy envía connected_account_id, user_id, endpoint, method y body opcional; no envía el proyecto Google. Los IDs de Composio y Google no son intercambiables.

## 2. Política interna v2

Nuevo contrato propuesto, distinto de la forma v1. Datos: contract_version=2, policy_id UUID estable, generation positiva, mode=crm_shared_conservative, state=disabled|enabled, límites enteros positivos y ventana definida. Metadato Google opcional/null con procedencia separada: unknown u oauth_client_reviewed. Nunca declarar revisión OAuth si no ocurrió.

El primer modo v2 agrupa **todo el tráfico Gmail que emita esta instalación**, tanto directo como Composio. Es un superconjunto conservador cuando se desconoce qué clientes comparten proyecto. No derivar un bucket por ca_id, user_id, buzón, proveedor o Auth Config: dividirlo permitiría multiplicar el cupo. Aun con metadatos Google conocidos, este primer modo conserva el grupo global; una optimización a grupos independientes requiere otra revisión.

La clave de grupo es interna y estable; no se introduce dentro de google_quota_project_id ni se etiqueta como proyecto Google verificado. Cambiar credencial, generación, binding o provider no reinicia esa clave, sus reservas ni su ventana. El esquema compartido no depende de un id secreto o un nombre de persona.

Límites iniciales propuestos: agregado900.000 unidades/minuto; cuenta4.500 unidades/minuto; agregado75.000.000 unidades en ventana móvil24h+1min, manteniendo el margen y el cálculo por método actuales. No elevar límites en este cambio. Usar los mismos costos de gmailRequestCost para la admisión común; no equivale al contador de peticiones Composio. El valor de umbral diario y la ventana heredados se conservan como política local, no como afirmación de facturación Google.

## 3. Reservas y tráfico directo

Mientras la política esté deshabilitada y Composio apagado, el camino directo actual conserva su comportamiento. Cuando se autorice habilitar la política v2, todas las solicitudes Gmail deben reservar el grupo común antes de emitir, incluidas consultas de identidad y otras entradas que no pasen por la fachada gmail().

Para directo se conserva también el límite previo por proyecto y el pacing por cuenta. La espera efectiva será la mayor de las restricciones aplicables, sin debitar dos veces la misma solicitud en un mismo contador. Para Composio se exige el grupo común y el límite por cuenta; no se necesita afirmar el proyecto Google real. La integración debe usar una reserva transaccional de alcance múltiple, locks en orden estable y un recibo interno por intento. Un replay administrativo no repite una llamada de proveedor.

Transición futura: pausar admisiones/esperar in-flight antes de habilitar, consolidar conservadoramente el consumo previo de las últimas24h+1min de todas las claves existentes, y poblar el nuevo agregado sin resetear el histórico. La suma puede contar de más si había alias del mismo proyecto; no puede contar de menos. Si faltan contadores confiables, no habilitar silenciosamente: mantener operación directa previa y dejar Composio cerrado hasta una transición revisada.

Los datos v1 y sus contadores no se borran. El guard común se suma a las limitaciones existentes, no las desactiva. Todo acceso de verificación/perfil/onboarding debe quedar cubierto por un hook de cuota con contexto humano o de intento autorizado; nunca ejecutar un GET Gmail solo porque sea lectura. Tras cada espera se revalidan sesión/capacidad/revisión/política/deadline antes del wire. OAuth token refresh no es una solicitud a Gmail API y no se mezcla con sus unidades.

## 4. Asociación existente y C2

Reutilizar register_candidate mediante contrato v2, sin introducir un segundo sistema de bindings. Request futuro: versión2, cuatro IDs Composio (proyecto, Auth Config, conexión, owner) y las revisiones/idempotency_key existentes. El servidor deriva policy_id/generation y correo esperado. Rechazar cualquier cuota, verified, facts o email esperado impuestos por el navegador. No migrar owner externo a crm-mail, ni abrir Connect.start, complete_auth, refresh, revoke o create link como efecto secundario.

El candidato reservado corresponde a la conexión original del buzón objetivo, identificada mediante evidencia histórica local. Debe volver a verificarse cuando se autorice tráfico real; no se copian sus IDs a fixtures o docs públicos. Un owner compartido entre conexiones exige seleccionar siempre el ca_id exacto y restringir cada acceso por account_id/binding, no dar acceso a todas las cuentas de ese owner.

Adaptador C2 propuesto: revisar contrato externo y producir evidencia normalizada, manteniendo las comprobaciones de conexión/owner/configuración/Gmail primario. Declaración de scopes del Auth Config, screenshot o GET profile satisfactorio no prueban permiso de envío. Si la API no aporta grants efectivos con procedencia verificable, devolver permission_unproven y detener. No fabricar effective_grants a partir de declared_scopes, ni enviar un correo para probarlos.

Versionar el contexto y la forma de hechos. En v2 la condición de cuota se expresa como política interna válida y vigente; no poner facts.quota=true ni quota_provenance=oauth_client_reviewed para fingir que se conoce Google. Los hechos v1 conservan su significado original. El digest v2 incluye versión, tuple, generación de credencial, configuración, política y sus límites; un cambio invalida la comprobación y exige revisión humana nueva.

Verificación futura prevista: GET conexión, GET Auth Config y GET perfil vía POST proxy. Presupuesto provisional en [budget.json](budget.json). La fuente exacta de permisos efectivos sigue siendo un bloqueo del adaptador real, no de esta planificación. Las tres solicitudes solo constituyen un camino satisfactorio si esa evidencia está disponible dentro del contrato revisado.

## 5. Modelo de datos y compatibilidad

Propuesta expand/contract sin número de migración reservado:

| Objeto                     | Delta propuesto                                                                             | Control                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Política interna privada   | Head singleton con policy_id/generation, límites y estado; slots/uso/recibos agregados      | service reserva; humano MFA publica mediante comando acotado; sin DML directo                   |
| mail_provider_bindings     | Discriminante de contrato y referencia a política v2; metadato Google opcional solo para v2 | CHECK v1 conserva Google obligatorio; CHECK v2 exige FK política; unicidad y auditoría actuales |
| Checks/contextos/snapshots | Payload/digest versionados; policy generation y hechos v2                                   | evidencia v1 no se reaprueba ni reutiliza como v2                                               |
| Connect/config/runtime     | Soporte dual explícito, sin reemplazar las columnas v1 a ciegas                             | registros e intentos antiguos legibles; cambios nuevos invalidan contexto viejo                 |

Tablas nuevas con RLS, sin acceso directo anon/authenticated; RPC backend mínimas, SECURITY DEFINER con search_path vacío. Mantener acceso denegado al contenido bruto, privilegios039/048 y guardas de Auth050. No reformar políticas ajenas ni permitir que service_role confirme por sí solo.

Migración local futura en esta carpeta/migrations; no ejecutarla en el CRM ni reeditar049/050/051. Preflight/postflight deben certificar el delta exacto y preservación. Un binario v1 no debe operar sobre un binding v2; rechazo explícito antes de credenciales, no fallback silencioso.

## 6. Superficie de impacto y coordinación

El coordinador conserva contratos compartidos, C1/C2, cuotas, rutas y release. El worktree F2 mantiene su delta T007-PD y las fuentes Connect. Antes de modificar config/provider/host/rutas Connect o SQL que le afecta: recibir snapshot final, comparar huellas y preparar un overlay explícito. No copiar WIP parcial ni escribir su directorio. El manifiesto propone superficies, no transfiere propiedad.

Primer incremento QGR-I01: solo módulo de política puro y sus tests, sin imports desde producto, IO, env, DB, fetch, worker o servicios. I02 añade SQL/compatibilidad; I03 servidor/admisión/C2; I04 UI y conciliación Connect; I05 QA/candidato de publicación. Nada de ello está autorizado por esta preparación.

## 7. Riesgos, observabilidad y operación

Riesgos principales: código legado que omita el guard global, dividir buckets por credencial, cambio de epoch que resetee consumo, fuentes externas de grants inexistentes, confundir owner con permiso CRM y despliegue parcial de contratos. Observabilidad: versión, alias opaco, generación, operación, motivo y contadores locales; sin payloads, correos o credenciales. UI ES/EN, teclado y estado de espera/errores, sin exponer campos técnicos innecesarios.

No se certifica consumo de otros clientes Google ni cupo Hobby/Proxy. Configuración incompleta o policy stale bloquea la nueva operación. El flag de producto Composio y el writer seleccionado permanecen independientes. Rollout/reversa en [rollout.md](rollout.md); pruebas previstas en [acceptance.md](acceptance.md).

Desviaciones: no aplica — no hay implementación en este turno. La revisión corrigió la explicación previa: el campo Google ya cumple una función de admisión local, no solo trazabilidad.
