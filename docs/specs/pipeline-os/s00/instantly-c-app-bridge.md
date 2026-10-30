# INS-CAPP: puente de control y preparación de prueba C integrada

29/10/2026, America/Bogota. **SDD STRICT**, por delegación temporal, permisos, persistencia y límites externos. Plan inicial seguido de autorización para implementar T02–05 offline: [estado actual y QA](instantly-c-app-validation.md). Las constancias de planificación al final conservan lo verificado antes de implementar. Sin permisos reales emitidos, env reales, red externa, activación, mensajes, push, SQL remoto o despliegue. [C original](instantly-phase-c.md), [integración de app](instantly-app-integration.md), [publicación comprobada](app-deployment-validation.md), [ownership](../parallel-development.md).

## Discovery y decisión confirmada

Respuesta9→A: **autorizar una vez en el CRM con superadmin/MFA y entregar al ejecutor un permiso temporal limitado a preparar/armar/consultar/cerrar ese único ensayo, sin contraseñas o cookies**. No crea ese permiso hoy. Instantly conserva v7/completed43/stage13; C/v8 real nunca empezó. App0af77b7 publicada,046 aplicada por operador y catálogo posterior comprobado; salud/login y entradas apagadas correctos, MFA/vistas confirmadas por operador. La bandera permanece ausente/apagada. Las cifras históricas de despliegue o el permiso de publicar0af77b7 no autorizan activar C o publicar este incremento.

Gaps reales: CLI C usa cReceiptFiles local; el callback publicado persiste en Supabase. El GET administrativo devuelve summary sin payloadDigest/receivedAt, necesarios para matchesLog. El bucle observe actual cada segundo estaba pensado para archivos: convertido directamente a HTTP puede superar cien consultas. La observación final actual precede al cierre: el puente debe certificar un snapshot posterior al cierre antes de aceptar resultado. No basta sustituir URL, copiar recibos manualmente o usar service_role desde CLI.

Se conserva el stack Node22/Next16/TS/Zod/Supabase, sin servicios, dominios, puertos, worker o SDK nuevos. Las referencias de API/payload de Instantly son las ya revisadas en C original; no se navega ni se atribuye verificación nueva a la documentación del proveedor. Disponibilidad de test/logs/costos actuales sigue condicionada al preflight futuro.

## Especificación y trazabilidad

Objetivo: una ejecución técnica única desde43 que controle un trial durable de la app, correlacione recibo/log cuando sea posible y retire exclusivamente su webhook temporal. No crea respuestas comerciales ni conversaciones.

| FR        | Requisito                                                                                                          | AC              |
| --------- | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| CAPP-FR01 | Preservar fuente43, bindings e historia, sin efectos en planificación/preview.                                     | CAPP-AC01/02    |
| CAPP-FR02 | Autorización única con usuario activo/superadmin/MFA/origen; permiso opaco y limitado, sin credenciales de sesión. | CAPP-AC03/04    |
| CAPP-FR03 | Control durable del único trial y evidencia mínima correlacionable, con cierre antes de aceptación final.          | CAPP-AC05/06    |
| CAPP-FR04 | Contadores separados y durables para Instantly/control/entregas, límites y reservas antes de HTTP.                 | CAPP-AC07/08    |
| CAPP-FR05 | Manifiesto privado inmutable, ventana y secretos vinculados; borrador imposible de ejecutar.                       | CAPP-AC02/09    |
| CAPP-FR06 | Reutilizar046 y contratos existentes; nueva migración aditiva para delegación, sin reescribir historia.            | CAPP-AC04/10    |
| CAPP-FR07 | Efectos únicos, conciliación solo lectura y cierre/revocación/limpieza propios incluso tras error.                 | CAPP-AC06/08/11 |
| CAPP-FR08 | Permisos de ejecución/infra separados; resultados honestos y sin datos de clientes.                                | CAPP-AC09/11/12 |

No funcionales: HTTPS/origen exacto, sin redirects; JSON control≤16KiB, respuesta≤64KiB, provider≤2MiB, callback≤256KiB; timeout por HTTP8s, no SDK con retries ocultos. Token aleatorio de32 bytes, entrega privada una sola vez; sin query/userinfo/fragmentos. Poll remoto espaciado≥10s, máximo12 observaciones normales. Mantener ventana receptor120s y máximo16 recibos/admisiones; guardar hash/flags/fechas, sin cuerpos, emails, contraseñas, cookies o API keys.

Fuera de alcance: envío/resume/activate/test-email, campañas/leads nuevos o modificados, respuesta real, pausa individual, análisis de documentos, datos de negocio, otros proveedores, nueva infraestructura, emisión de token o activación hoy. No se certifica costo cero global por este presupuesto.

## CAPP-ADR01: permiso opaco, RPC de control y ledger integrado

### Autorización y rutas propuestas

En la sección de Integraciones existente, añadir posteriormente un control visible solo a superadmin; no mezclar con botones de enviar campaña. Importar un manifiesto completo y mostrar ensayo/destino/ventana/presupuesto, sin secretos. El operador entra con su sesión/MFA habitual; **esa sesión nunca sale del navegador**. Acción explícita de autorización de un único ensayo.

POST propuesto `/api/integrations/instantly/trials/[nonce]/lease`: sesión existente requireUser, superadmin activo/aal2 y checkOrigin, cuerpo estricto sin actor/roles aportados por el cliente. La app comprueba secretos/manifest binding/origen y emite lease opaco. Dentro de una transacción prepara el trial046 exacto y registra hash del token, actor y límites; devuelve ticket descargable no-store una sola vez. El operador guarda el ticket en ubicación privada ignorada y el ejecutor lo carga internamente. Nada de pegar token en chat o imprimirlo. El navegador no recibe la API key Instantly, service_role o las claves de webhook/dedup.

Handoff previsto: metadata privada del ticket separada de su credencial; token solo en memoria o variable de proceso INSTANTLY_S00_CONTROL_TOKEN. Si se usa descarga local, entregar un archivo de credencial temporal .env privado/ignorado con permisos restrictivos y metadata sin token; nunca incrustar el token en el manifiesto JSON exportable. No generar ese archivo hoy. La carga interna futura requiere su autorización específica, sin abrir/imprimir valores reales. No añadir esta variable temporal al Coolify, servidor o worker.

Control propuesto `/api/integrations/instantly/control/[nonce]`: GET observación; POST action arm/close/revoke. Solo Bearer del lease, sin cookies o refresh token; no endpoint genérico de proxy. La preparación queda autorizada/realizada por la emisión y es comprobada por el probe inicial del ejecutor, sin segundo POST prepare. Mantener el GET administrativo actual como resumen de UI; no inventar hashes que ese contrato no devuelve. Todas las rutas nuevas continúan404 antes de DB cuando INSTANTLY_WEBHOOK_ENABLED no es true. No añadir otra variable de servidor, API key o secreto de firma: token aleatorio y hash durable bastan.

Errores de control propuestos:404 bandera apagada/ruta inválida;401 ticket inválido/ajeno/expirado/revocado, sin revelar su causa;403 actor ya no autorizado;409 emisión/armado incompatible o conflicto no resuelto;429 cupo;400/405 entrada, tamaño, content-type o método inválidos;503 almacenamiento/timeout interno. Respuestas sin SQL, bodies privados o headers completos. Aceptar un ticket no concede CORS abierto o sesión; origen externo en un request de navegador se rechaza. Identificador de intento y bucket se validan; H solo close/revoke propios, R solo lecturas/conciliación, nunca ampliar permisos por parámetros del cliente.

En ejecución futura, bandera/secretos deben habilitarse explícitamente antes de emitir el lease; no existe grant real mientras estén apagados. El callback requiere además trial armado y ventana válida: habilitar la bandera no arma por sí solo el receptor. Configurar/apagar variables y cualquier despliegue se presupuestan/autorizan como operaciones aparte; no son permisos implícitos de la interfaz de autorización.

### Persistencia propuesta, sin editar046

La046 ya aplicada acepta un manifiesto de12 claves y protege recibos; no tiene estado de delegación. **047 aditiva**, reservada por el coordinador, implementa la tabla técnica `instantly_webhook_control_leases` y RPC exclusivas de backend. Solo se aplica en bases descartables de QA; no en Supabase remoto.

Campos previstos: id, trial_id FK a046, actor_id, token_hash único, manifest_hash/source_hash, issued_at/expires_at/revoked_at, contadores normales/reserva/emergencia/entregas admitidas y límites inmutables. Una única emisión por nonce/trial; no reemitir un token perdido de forma automática. Hash/nonce indexados y constraints de cuotas/fechas. RLS y revocación de acceso directo para PUBLIC/anon/authenticated/service_role; solo execute de RPC al backend como046, SECURITY DEFINER/search_path vacío y nombres calificados. Probar owner postgres y supabase_admin, incluidos accesos necesarios a profiles; no cambiar propietarios o grants remotos a mano.

RPC issue: verificar actor activo/superadmin procedente de la sesión validada, preparar046 y registrar lease en una transacción. No armar ni llamar Instantly. RPC control: comprobar hash/nonce/bindings/actor aún activo-superadmin, caducidad y cupo, reservar antes de operar y devolver snapshot mínimo. Transiciones invocan funciones046 **dentro de la misma transacción**, sin múltiples REST independientes para leer+modificar. Orden de locks lease→trial; callback y cierre usan el mismo orden para evitar carreras/deadlocks. Expiración/revocación/actor desactivado bloquean arm y lectura delegada; administración con MFA conserva vía de recuperación acotada.

La emisión inicia contador normal1 y el intento local ya reservado. En operaciones admitidas, un error de transición no debe deshacer la reserva del intento: usar subtransacción para la transición y devolver error tipado después de persistir la reserva, sin propagar SQL crudo que revierta toda la RPC. Timeout puede dejar commit incierto: contar localmente y conciliar solo lectura. El presupuesto consume también solicitudes repetidas, aunque una transición idempotente no se vuelva a ejecutar; no permitir replay ilimitado con el mismo request_id. Un token inválido/no localizable no recibe estado ni privilegios; la llamada saliente sigue contada en el cliente.

Proponer expiración `min(issuedAt+10min, receiver.endsAt+60s)`; exigir receiver.endsAt≤issuedAt+9min para dejar margen completo de cierre. No más de un armado; fecha/vínculos/permiso no editables. Cierre terminal bloquea cualquier nuevo callback aceptado y armado; lectura final permite comprobar snapshot congelado antes de revocar. Revoke vuelve inválido el ticket y conserva filas/evidencia. No se necesita worker de expiración: verificar fecha en cada operación; expirado no equivale a un cierre SQL confirmado.

RPC de admisión callback: validar lease/trial/ventana y reservar admisión durable antes de devolver el trial al handler. Reusar receptor puro/store y CAS existente, preservando su máximo de un retry de conflicto, nunca retry de red. Mantener máximo16 admisiones/recibos, sin almacenar payloads. Errores de almacenamiento no producen2xx. Callbacks tardíos/duplicados nunca reabren el trial ni ejecutan negocio.

### Puente local y correlación

Adaptador remoto de CReceiver con transporte acotado y token privado. Respuesta estricta: nonce, sourceHash/manifestHash, revision, armed/closed, authenticated, contextValidated, conflict, payloadDigest, receivedAt y número de observaciones. Los hashes/IDs permanecen privados; stdout solo estados y consumos. Rechazar snapshot ajeno, revisión regresiva, fuente cambiada o campos inesperados. Digest del payload canónico con clave dedup existente permite comparar contra log propio; no es firma HMAC emitida por Instantly.

No reutilizar sin cambios el bucle HTTP cada segundo ni certificar estado leído antes de close. Nuevo flujo integrado **C_APP / journal v9 propuesto**: fuente v7 completa inmutable, contador calls exclusivamente Instantly43+intentos, bloque control independiente y referencias al manifiesto/lease/recibo. Un solo archivo autoritativo y locks; no ledger remoto duplicado para llamadas del proveedor. Lectores v7/v8 históricos se conservan y CLI legada no ejecuta C_APP accidentalmente. Reutilizar validadores/transporte/guardas de C original mediante extracción compatible de helpers si hace falta, sin duplicar una segunda máquina de proveedor no trazable.

Cada intento HTTP, incluso4xx/timeout/cancelación, se reserva y persiste antes de emitir. El grant humano también exige intención local durable antes del click; el ticket devuelto enlaza el intento. Si no existe journal/binding revisado, no emitir permiso. No crear v9 real hoy. Terminal no reanuda ni repite test tras reinicio; inspección/replay offline no toca env/red/save. Persistencia incierta deja estado pendiente y exige recuperación específica, sin borrar o resetear contadores.

### Alternativas descartadas

Copiar cookie/contraseña para ejecutar el GET administrativo: expone una sesión amplia y no cumple9→A. Usar service_role en CLI: elude MFA/permisos de app y amplía acceso a DB. Reutilizar API key o secretos webhook/dedup para firmar el lease: el ejecutor ya conoce esos valores y podría emitir permisos, perdiendo la autorización única. Token firmado sin estado: no revoca ni limita consumos de forma durable. Usar operational_settings para tickets: mezcla secretos/estado de ensayo con configuración de negocio. Opaque hash/RPC/047 reutiliza la infraestructura existente y evita esos problemas.

## Manifiesto: borrador y contrato futuro

[Ejemplo público no ejecutable](instantly-c-app-manifest.example.json). Borrador privado en `.local/pipeline-os/c-app-preparation/manifest.draft.json`, fuera de los12 archivos operativos raíz. Incluye origen real y hash/vínculos de fuente43 ya existentes, sin imprimirlos ni cargar env. No se generan nonce, claves, ticket o ventana activa; IDs/fechas/hashes de secretos faltantes son null. Campos draft=true/executionReady=false, permisos de ejecución false y controles/costos pendientes impiden usarlo como manifiesto final. No colocarlo en s00-instantly-c-manifest.json ni usar --execute.

Manifest final futuro, con schema estricto: versión C_APP, hash canónico de fuente43/scope/B, fingerprint de configuración ya autorizada, workspace y campaña únicos existentes, nonce24 hex, origin exacto https://crm.finlabinc.com y URL de callback, receiverManifest compatible046 con12 claves, ventana120s, referencias privadas a secretos/ticket, TTL lease, presupuestos/provider+control/admisiones y revisiones/costos/logging comprobados. Solo hashes/referencias, nunca secretos en JSON público. Fuente/B/campaña no se editan para adaptar el ensayo. No reutilizar el horario histórico de B ni fijar hoy una fecha que vencerá antes de implementar.

El manifiesto final no es autorización. Antes de ejecutar se debe tener implementación/QA/deploy de C_APP/047 aceptados, esquema/control/flags/secretos habilitados por permiso separado, ticket superadmin/MFA válido y cuota/API/webhooks incluidos confirmados actualmente. No pedir nuevamente credenciales Supabase: la app conserva las existentes; futura carga interna de env del ejecutor mantiene sus permisos específicos.

## Recorrido y presupuesto propuesto

**Hoy0 nuevas;43 conservadas.** No ampliar permisos19/62 del C original ni gastar el remanente5 de B. La autorización real tendrá que nombrar por separado proveedor/control, creación/test/DELETE propios, emisión/uso/revocación del lease, callbacks/admisiones y operaciones de configuración; este documento no la concede.

### Instantly: presupuesto de proveedor sin cambios

| Paso                                                                      | Normal mínimo | Normal máximo |
| ------------------------------------------------------------------------- | ------------: | ------------: |
| Workspace, plan incluido y campaña propia pausada/sin remitentes          |             3 |             3 |
| Listar hooks propios/preventivos, hasta2 páginas                          |             1 |             2 |
| Crear un hook y leerlo para verificar identidad                           |             2 |             2 |
| POST test, una sola vez                                                   |             1 |             1 |
| Listar logs (página o espera de visibilidad) y detalle de candidato único |             2 |             3 |
| DELETE propio, GET404 de ausencia y campaña final                         |             3 |             3 |
| **Recorrido completo correlacionable**                                    |        **12** |        **14** |

N14 + R3 + H2 = **hasta19 nuevas;43→máximo62 acumuladas Instantly**. R3 compartida para lecturas transitorias/conciliación, un retry por lectura; no repetir POST create/test/DELETE. H2 exclusivamente DELETE no intentado/GET de ausencia del hook propio. Sin log/candidato no se inventa detalle ni éxito completo; caminos parciales pueden consumir menos. No tocar campañas, leads, remitentes o hooks ajenos.

### App: presupuesto nuevo de control

| Operación de API de control                                         | Normal mínimo | Normal máximo |
| ------------------------------------------------------------------- | ------------: | ------------: |
| Grant desde navegador con MFA, prepara trial y emite ticket una vez |             1 |             1 |
| Probe de bindings/estado preparado y permiso del ejecutor           |             1 |             1 |
| Arm una sola vez, tras guardas del proveedor                        |             1 |             1 |
| Observaciones remotas; primera inmediata, siguientes espaciadas≥10s |             1 |            12 |
| Close terminal; después GET final del snapshot congelado            |             2 |             2 |
| Revoke del permiso; después GET que acredita ticket ineficaz        |             2 |             2 |
| **Normal**                                                          |         **8** |        **19** |

N19 + R4 + H2 = **hasta25 peticiones nuevas al control**. N19 es techo, no objetivo. R4 compartida: lecturas transitorias/conciliación, un retry máximo por operación, sin refresh/reemisión silenciosa. H2 se reserva para close/revoke todavía no intentados; si hubo intento incierto, conciliar con lectura de R o registrar cleanup pendiente, nunca repetir efectos. Una consulta401 después de revoke acredita ineficacia del ticket, no borrado de evidencia ni causa precisa si expiró. Sin token recibido tras grant incierto: parar antes de Instantly, no emitir otro permiso automáticamente.

Polling: hasta12 observaciones normales en120s y ningún bucle remoto de1s. Reservar close/final/revoke/verificación y R/H antes de arm/test. Al agotarse observaciones, cerrar/conciliar dentro de reservas; no seguir sondeando hasta recibir algo. Solo aceptar estado definitivo tras close y GET final, y volver a contrastar digest/contexto/conflicto con el log antes de terminar. Un callback conflictivo entre última observación y close convierte el resultado a parcial, no éxito.

**Cliente:20–33 peticiones normales en recorrido completo; techo44 nuevas (19 proveedor +25 control).** No llamarlo87 acumuladas:43 es únicamente historial Instantly y ya hubo4 HTTP de smoke de app fuera de ese contador. Campos separados en journal y reporte: providerTotal≤62/controlAttempts≤25; intentos HTTP salientes del ensayo≤44. Las reservas no se convierten en más páginas, polls o tests.

### Backend, autenticación y callbacks: no ocultar tráfico derivado

El diseño exige **una sola llamada REST/RPC a Supabase por petición de control**, incluidas transiciones/grant; lecturas y CAS internas ocurren en la misma transacción SQL y no añaden HTTP. Validación del actor activo/rol ocurre dentro de esa RPC. Solo el grant con sesión añade auth/profile: fijar y comprobar en QA un transporte autenticado con techo4 HTTP adicionales (normal esperado2, margen2 para renovación), sin refresh/retry ilimitado. Si el cliente existente supera ese límite, se detiene y revisa el contrato antes de habilitar ejecución; no afirmar hoy ese comportamiento implementado.

Por tanto, objetivo de backend HTTP derivado de control ≤25+4=29; **no son29 peticiones extra a Instantly** ni se suman a calls43. Implementación debe instrumentar/enforzar esos límites por capa; contarlos no autoriza queries directas desde CLI o service_role fuera de la app. Login inicial, navegación/assets del navegador, healthchecks rutinarios, configuración/restart o verificaciones adicionales de despliegue son precondiciones fuera del ensayo, a declarar/autorizar aparte; no presentarlo como techo de todo el tráfico del VPS.

Entregas Instantly→app se cuentan separadamente como D; se espera1, admitiendo como máximo16 para persistencia/ensayo. **16 no es garantía de máximo HTTP entrante**: el proveedor puede reintentar o llegar tráfico rechazado. Cada solicitud autenticada del callback puede derivar hasta4 HTTP DB (admisión+CAS y un conflicto read/CAS); registrar el número real. Modelo conservador de backend: ≤29+4D para las llamadas de control y callbacks contempladas, con hasta93 si D=16;93 es escenario, no techo global garantizado ante tráfico externo adicional. No ocultar los rechazos después del cupo/ventana ni afirmar que el límite de recibos elimina todo acceso DB. Requerir admisión/quota/cierre y logs acotados/medidos antes de la prueba; si aparece un volumen inesperado, detener/limpiar según permiso y no crear otro test.

## Aceptación y pruebas

| AC        | Dado / cuando / entonces                                                                                      | Prueba requerida                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| CAPP-AC01 | Fuente v7/43 intacta; al planificar/preview no hay env/red/permisos/v9 reales.                                | Baseline423 fuentes +12 privados; traps de env/fetch/save.                                             |
| CAPP-AC02 | Borrador/nulls/faltan permisos, al ejecutar debe fallar antes de cualquier HTTP.                              | Schema estricto y CLI con matriz de gates/modes.                                                       |
| CAPP-AC03 | Sin superadmin/activo/MFA/origen, grant rechaza antes de emitir ticket; cap no concede sesión o proxy.        | Anon/aal1/roles/CSRF; no cookies/passwords/API key en ticket.                                          |
| CAPP-AC04 | Ticket ajeno, expirado, revocado, perfil desactivado o cuota agotada, sin efectos/control concedidos.         | RLS/RPC/actor distinto/caducidad/rotación/unknown token; owner postgres y supabase_admin.              |
| CAPP-AC05 | Hash/revisión/fuente/nonce alterados, snapshot rechazado; payload crudo jamás persistido.                     | Esquemas/bindings/privacy sentinels y comparación HMAC de log.                                         |
| CAPP-AC06 | Callback compite con close; final leído tras cierre no cambia ni permite armado.                              | Race antes/después lock, conflicto tardío, commit antes2xx; no éxito falso.                            |
| CAPP-AC07 | Camino normal y extremos: proveedor≤19/62, control≤25, polls≤12 y uno solo de cada efecto.                    | Fixture20 mínimo/33 normal máximo/44 techo; reserva durable, HTTP fallido también cuenta.              |
| CAPP-AC08 | Timeout/429/cancelación/persistencia incierta no duplican efectos ni gastan H en diagnóstico.                 | R/H por capa, refresh bounded, arm/close/revoke inciertos, cleanup_required honesto.                   |
| CAPP-AC09 | Sin implementación/publicación/secretos/cuota/permiso específico, no emitir lease ni activar C.               | Gates de ticket/manifiesto/comandos; no heredar permiso de0af77b7.                                     |
| CAPP-AC10 | Nueva migración aditiva no altera046 ni datos de negocio; estado de permiso durable.                          | PGlite fresh/upgrade/roles/constraints, reverse solo descartable y ausencia de efectos CRM.            |
| CAPP-AC11 | Terminal/reinicio/replay no repiten test; hook propio ausente o cleanup pendiente y ticket revocado/ineficaz. | Crash en cada punto, archivo ledger único, final snapshot, no eliminar campañas/leads/lease histórico. |
| CAPP-AC12 | Separar transporte/contexto/log/respuesta real; no cerrar D/S00 o prometer costo global por2xx.               | Matriz full/partial, proveedor sample ajeno/log ausente y reporte sanitizado de cada capa.             |

## Tareas, dependencias y cierre

| T        | Objetivo / FR                                                | Dependencias                                                     | Terminado cuando / pruebas                                                                                                       | Estado                                                      |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CAPP-T01 | Contrato/ADR/manifiesto draft/presupuesto; FR01–08.          | Respuesta9→A, app publicada/43.                                  | Enlaces/trazas/cuentas/borrador no ejecutable y preservación verificados.                                                        | Preparada en este incremento; evidencia de cierre abajo.    |
| CAPP-T02 | Migración leases/RPC/admisión y permisos; FR02/03/04/06.     | T01 y solicitud explícita de implementación.                     | 047 local aditiva y QA de roles, concurrencia, cuota, revocación, upgrade y rollback descartable.                                | Completada local: 047 y QA SQL/API; remoto pendiente.       |
| CAPP-T03 | Control UI/API y ticket privado; FR02/03/05/08.              | T02.                                                             | Sesión/MFA/origen, download seguro, contract de observación, secreto nunca en logs; auth HTTP bounded.                           | Completada local: UI/API/ticket; sin permiso real.          |
| CAPP-T04 | Adaptador/ejecutor/ledger integrado; FR01/03/04/05/07.       | T02/T03.                                                         | v9 ficticia/compatibilidad, intentos durables, polling/cierre/revoke/cleanup con máximo probado.                                 | Completada local: v9 sintética/CLI; v7 real intacta.        |
| CAPP-T05 | QA conjunta y revisión; FR01–08.                             | T02–04.                                                          | AC01–12 positivas/negativas, límites reales de mocks, regresión656 de referencia/TS/build aislado actualizados.                  | Completada offline: 681/681, DB/TS/build/revisión.          |
| CAPP-T06 | Preparar release/config/manifiesto final/costos; FR05/06/08. | T05 y permisos remotos específicos.                              | Candidato nuevo revisado, esquema publicado, flags/secretos/control/roles y ticket válidos; presupuestos de preflight separados. | Pendiente; main/autodeploy no se toca.                      |
| CAPP-T07 | Ejecución única y consolidación; FR01–08.                    | T06 y autorización específica19/62+25 control y efectos propios. | Recepción/log/cierre/cleanup comprobados o parcial honesto, evidencia persistida y sin negocio.                                  | Pendiente; permiso real no solicitado por esta preparación. |

Orden futuro: implementación/QA offline → versión y migración revisadas → aprobación/publicación apagada → manifiesto final/costos/secretos/preflight → permiso de activación/ejecución acotado → grant humano con MFA → probe/guardas proveedor/arm/test/observación/log → retirar hook/campaña final → close/snapshot/revoke y consolidar. Configuración/activación/desactivación no se automatizan desde el lease ni se confunden con mensajes reales.

Rollback hoy: conservar fuente/counter y documentos anteriores, sin reset/stash/clean o cambios S01. Futuro: bloquear entrada/ejecución, retirar solo hook propio dentro del permiso y revocar/cerrar conservando registros;046/047 expansivas no se revierten destructivamente en remoto. Error de auth/identidad o DB incierta bloquea compensaciones dudosas; reportar estado pendiente y solicitar recuperación específica. No clonar journals al VPS ni restaurar saldo para continuar.

## Verificación de esta preparación

Solo lectura local de código/contratos y aritmética/manifiesto draft. Baseline privado de423 archivos de código/configuración/tests y12 JSON operativos, source43; no se crea manifiesto operativo C, ticket, secretos, nonce/ventana o journal v9 reales. Artefactos públicos nuevos son documentos/ejemplo; cambios de referencia solo en documentos propios. Sin llamadas reales, env, SQL, build, servidores, nuevos push o cambios S01. Tests de implementación/seguridad/transporte/047 siguen pendientes, aunque la documentación esté preparada.

Auditoría offline de esta preparación: source v7/completed43/stage13 válido; borrador con origen/hash/scope/B/fingerprint/campaña vinculados internamente, workspace pendiente sin cargar env. Todos los gates false y fechas/nonce/ticket/hashes de secretos null; validateCManifest existente lo rechaza. Sumas verificadas por filas: proveedor12–14 y control8–19, normales conjuntas20–33, techos19/62 y25/44; escenario DB con D16=93 y D17=97 muestra por qué no es un límite global. Preview C actual con traps devuelve43, env/fetch/save0/0/0.423 fuentes y12 JSON anteriores iguales; no se ejecutó C_APP, emitió permiso ni probó una047 inexistente. Referencia656/656 anterior no se presenta como QA del nuevo diseño.

Cierre documental:8 documentos Markdown y1 ejemplo JSON revisados,266 enlaces locales válidos,8 FR/12 AC/7 tareas trazados; formato/diff correctos. CAPP-T01 completada para planificación; G0–G3 preparados, G4/G5 de implementación y G6 remota pendientes. Borrador privado separado de los12 operativos y ningún manifiesto C real/recibo/047 SQL creado. Main/código desplegado0af77b7 sin cambios; documentación local no publicada por este incremento.

### Incremento local autorizado: T02–T05

Continuación de preparación autorizada después de ese incremento: [candidato](instantly-047-release-candidate.md) y [runbook047](instantly-047-release-runbook.md), CAPP-T06a local. No aplica permisos remotos o activación; T06 completa y T07 siguen pendientes.

La solicitud posterior autoriza implementar el puente y 047, con QA exclusivamente offline. La descripción anterior conserva la evidencia de planificación, no el estado de la implementación actual. No autoriza T06/T07, llamadas reales, activación, publicación o SQL remoto.

El journal v9 contiene el estado v7/v8 del ejecutor existente y un contador independiente de control; no duplica su máquina de estados. La opción interna `receiverFailureAsOperational` permite retirar el hook propio cuando falla el transporte de control; su valor por defecto conserva el comportamiento de C local. Un fallo de persistencia detiene nuevos HTTP y deja recuperación explícita pendiente. El adaptador exige el mismo lock que los demás ejecutores y rechaza enlaces simbólicos en sus directorios privados.

El callback de producción exige admisión 047 antes de persistir. Las fábricas anteriores conservan la dependencia opcional para compatibilidad de sus pruebas; la ruta real la inyecta siempre. La autorización emite únicamente una credencial efímera descargable y metadata separada; no crea una credencial en el manifiesto. Entradas JSON inválidas, demasiado grandes o con media type incorrecto reciben 400 y nunca llegan al RPC. La publicación y prueba del proxy HTTPS, MFA real y descarga del navegador quedan pendientes de T06.
