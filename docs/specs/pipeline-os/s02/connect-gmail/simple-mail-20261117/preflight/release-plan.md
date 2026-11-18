# Preflight y promoción de Conexiones simples

**Registro histórico anterior al cierre de adjuntos.** Estado vigente: [closure.md](closure.md) y [promotion-manifest.json](promotion-manifest.json), sobre main `544b835`. El fallo de adjuntos que aparece pendiente abajo ya fue resuelto con cobertura del responsable/closer; el cupo global Composio sigue sin acreditar. Usar `finalize-candidate.mjs` para el paquete actual; `package-promotion.mjs` conserva la preparación anterior.

Fecha local: 17 de noviembre de 2026; capturas después de medianoche UTC del 18. SDD STRICT, FR/AC-001–011, T-010. Este es el estado actual de promoción; los documentos de implementación anteriores conservan su evidencia histórica.

**Resultado: candidato local conciliado y probado; publicación completa todavía condicionada.** Google Cloud es el proyecto correcto. No se modificó producción. Faltan acreditar el cupo gratuito aplicable de proxy de Composio, resolver o aceptar expresamente el fallo heredado de adjuntos y completar el backup del momento de publicación. No hace falta iniciar sesión otra vez ni repetir Google para preparar esta entrega.

## Lo comprobado

| Área               | Resultado observado                                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base               | `codex/simple-mail-promotion-20261118`, main y runtime web/worker `b86148613648076e47fbcc51db60895de331623f`. Los 41 archivos públicos de implementación no se solapan con cambios de main desde `9d28d5a`. WIP previo intacto.                                                                          |
| Catálogo           | Dos consultas administrativas HTTP 200, con transacción READ ONLY, timeouts y ROLLBACK. Captura de 456 funciones, 144 relaciones y 1450 columnas de los esquemas seleccionados; sin filas Auth ni contenido de buzones.                                                                                  |
| Contratos          | Las 16 funciones existentes referenciadas por el candidato coinciden en cuerpo normalizado, SECURITY DEFINER y search_path con la fixture canónica post052. No demuestra equivalencia de todo el runtime Auth/PostgREST.                                                                                 |
| Corrección post052 | `mail_runtime.command_v1(uuid,text,jsonb,uuid)` conserva el MD5 esperado `c2c3178219832b68d64bb85d22e39276`. Se mantiene la corrección local guardada del calificador, con definición original para reversa sin uso.                                                                                     |
| Marca              | La marca existente es `CURATED_FINANCIAL`, ID `a7563a6a-fc36-4888-a0af-76a12fea33c9`. Se corrigió el literal del candidato y sus fixtures; no se creó ni renombró una marca remota. El contador `curated_active: 0` de la primera consulta buscaba el código anterior y no significa que falte la marca. |
| Identidades        | Dos superadmins activos; todavía no hay perfiles seller/closer activos. Los superadmins son responsables elegibles. Los asesores futuros requieren su alta normal en el CRM.                                                                                                                             |
| QGR/Connect        | Política QGR generation 1 habilitada en DB, modo conservador; flags QGR apagados en runtime. Connect generation 1, proyecto `pr_y-80FotblnGt`, Auth Config `ac_0c4QEKnwPtOd`, coincidentes con Composio.                                                                                                 |
| Gmail              | Proyecto **Curated CRM Gmail**, ID `curated-crm-gmail`, número `12677035404`, organización `curatedfinancial.com`, audiencia Internal, Gmail API habilitada. Cliente directo exacto del runtime y callback `https://crm.finlabinc.com/api/gmail/callback`.                                               |
| Composio OAuth     | Cliente separado **Curated CRM Composio** en el mismo proyecto Google; ID coincide con el Auth Config custom habilitado. Callback `https://backend.composio.dev/api/v1/auth-apps/add`. Declara userinfo profile/email y Gmail readonly/modify/send.                                                      |
| Proveedores        | Cero consentimientos, intercambios de tokens, herramientas, proxy, lecturas de buzón o envíos ejecutados. Dos lecturas administrativas Composio: uso agregado y metadatos filtrados del Auth Config.                                                                                                     |

Google muestra cero filas en Data Access. Para una app interna de Workspace eso, por sí solo, no requiere añadir scopes ni publicar una app externa; la documentación de Google distingue el listado de scopes de la verificación de los permisos efectivos de cada buzón. Estos últimos se comprobarán en el flujo autorizado, no se deducen de tener el cliente configurado. Referencias: [consentimiento OAuth](https://developers.google.com/workspace/guides/configure-oauth-consent), [scopes Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Cupo Composio: qué falta exactamente

El panel autenticado confirma **Hobby, $0/mes**, 100000 tool calls/mes y cuentas conectadas ilimitadas. Los $2 de Instant credits no se incorporaron al presupuesto de correo. No se compró ni cambió nada.

En Month to date el panel presenta 3 tool calls y **33.18K Composio-managed app calls**. La API de resumen del proyecto devuelve exactamente 3 tool calls para el intervalo consultado, pero no devuelve consumo ni remanente de proxy. Son medidores distintos; no se pueden restar esos 3 de todos los límites ni asumir que quedan 997 proxies.

La [tarifa publicada](https://composio.dev/pricing/platform) distingue llamadas base, managed apps y proxy —este último con 1000/mes incluidos en la tarifa publicada—, además de condiciones de transición para proyectos anteriores. No se acreditó la aplicabilidad completa de esos límites a este proyecto ni el remanente global del periodo. El Auth Config custom no basta para resolver esa diferencia contable.

Por tanto, **no se prepara ningún INSERT de saldo positivo ni `hard_cap_free=true`**. `simple_mail.included` permanece sin provisionar; las reservas y el respaldo Composio quedan cerrados con motivo visible. Gmail directo puede funcionar sin ese presupuesto una vez publicado y conectado. Esto conserva la decisión del usuario sobre no gastar créditos pagados; no sustituye la entrega de Composio operativo.

Para abrir Composio hace falta una evidencia del proveedor que fije periodo, medidores aplicables, consumo global y tope sin cargos, y permita reservar un remanente conservador de cada medidor. Si el panel no lo expone, se necesita aclaración de Composio o un límite verificable por su administración. No se contactó soporte ni se creó una clave de organización. La evidencia actual no justifica comprar créditos como requisito de Gmail directo.

## Cambios de configuración preparados, no aplicados

Los valores efectivos y la presencia de secretos —solo booleanos— están en `runtime-observation.json`. Coolify tenía un aviso previo de cambios sin guardar; no se usó Save ni Reset. Se inspeccionaron los procesos en ejecución.

| Destino        | Delta previsto tras SQL compatible y con el mismo release                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web y worker   | `SIMPLE_MAIL_ENABLED=true`, `SIMPLE_MAIL_ORGANIZATION=curated`, `MAIL_QUOTA_POLICY_ENABLED=true`. Verificar primero descriptor/política QGR generation 1 y sus límites conservadores; afecta admisión de Gmail y debe habilitarse coordinadamente.                                                         |
| Web            | `COMPOSIO_BINDING_CHECKS_ENABLED=true` solo en la habilitación Composio. Connect, binding v2 y verifier setup ya están habilitados. Conservar su configuración vigente.                                                                                                                                    |
| Worker         | Provisionar de forma segura **la misma referencia de secreto existente** para `COMPOSIO_API_KEY` y el descriptor exacto existente `COMPOSIO_MAIL_CONTEXT`; hoy ambos faltan. No pegar valores en documentos, chat o logs. No necesita las claves de inicio Connect ni habilitar pantallas administrativas. |
| Routing global | Mantener el valor actual cerrado; la nueva función admite las cuentas gestionadas de forma explícita. No ampliar otros transportes.                                                                                                                                                                        |

La habilitación de Composio requiere además el presupuesto acreditado. Cambiar flags o copiar el contexto no crea ese presupuesto. No alterar plan, credenciales Google, callback, seguridad de la cuenta, DNS ni proveedores ajenos. No reanudar campañas o outbox pausados al conectar.

## Payload y orden de publicación

1. Revalidar main/runtime, catálogo guardado y ordinal. `058` es una **propuesta local**, posterior al máximo 057 observado en repo; no se reservó ni se insertó en `supabase/migrations`. Si cambian fuentes compartidas o contratos, conciliar y repetir solo los checks afectados.
2. Revisar `promotion-manifest.json`: contiene los 41 archivos y hashes del candidato sobre b861486. Las copias `058_simple_mail_connections.sql` y su reversa son byte a byte los candidatos ensayados; su encabezado sigue indicando uso local. No ejecutarlas remotamente por recibir este documento. El packager local valida base, hashes, contratos y pruebas antes de emitir el manifest.
3. Disponer del commit/payload concreto, autorización de publicación para web/worker/SQL y backup inmediato. El recibo histórico de campañas del 18/11 00:59 UTC declara dump con SHA y lista verificada; **no se verificó su archivo ni se considera backup de esta publicación**. Preparar un `pg_dump -Fc` del destino, comprobar tamaño/SHA y `pg_restore --list`; registrar ruta privada mediante referencia sin copiar el contenido. No confundir listar un archivo con una restauración completa ensayada.
4. Mantener feature flags cerrados, registrar valores previos y aplicar únicamente el SQL conciliado, transaccional y con lock_timeout. El guard debe abortar si cambió `command_v1`; nunca omitirlo. Confirmar ACL, nueva columna y ausencia de presupuesto inventado. No cargar fixtures en producción.
5. Publicar el mismo release en web y worker con flags cerrados, verificar commit/digest y salud de ambos y después habilitar coordinadamente Gmail/QGR. Provisionar y habilitar Composio únicamente después de acreditar su presupuesto. No activar funciones en una combinación antigua/nueva de binarios.
6. Smoke de lectura con sesión real superadmin/MFA y de los responsables autorizados. Confirmar estados, opciones, ACL y que ninguna conexión reanude envíos. Las rutas nuevas no están publicadas todavía: no se presentan permisos de fixtures como comprobación de las rutas reales.
7. Consentimiento Google solo por el usuario cuando haga falta; recuperar la conexión Composio existente si sigue siendo válida. La cuenta candidata no se declara lista antes de comprobar identidad/capacidades. Cualquier envío real requiere buzón, destinatario y contenido concretos acordados; no se usa una campaña de clientes como ensayo.

## Pruebas actuales y reversa

Sobre b861486 más el candidato corregido: **42/42** resultados focalizados, **14/14** nativos PostgreSQL 15.19 (clúster propio detenido), typegen/TypeScript/build webpack correctos. Regresión de **84 archivos: 536 correctos, 1 fallo, 6 omitidos**. El fallo es `tests/gmail-attachments.test.ts:235`, esperado 3/obtenido 4, reproducido anteriormente en baseline limpio 9d28d5a. No se relajó ni omitió, y el runner sigue saliendo con error. Debe resolverse o recibir una disposición explícita antes de publicar; no se declara G5 completamente verde.

QA visual histórico de la implementación usa fixtures y CSS real a 360/768/1280; no se repitió la UI en producción. Los ensayos nativos cubren forward/reversa/reapply, MFA/ACL, reservas concurrentes, callbacks y checkpoint CAS; no son un ensayo del stack productivo completo ni de entrega real.

Si un release falla: cerrar nuevos onboards/respaldo y coordinar worker; conciliar operaciones en curso sin reintentar estados inciertos; volver a imágenes compatibles registradas. Conservar SQL aditivo y recibos en una instalación usada. La reversa SQL rechaza onboarding/health/usage/included/fallbacks/sync existentes; solo se admite si está sin uso. Nunca restaurar un backup encima de mensajes nuevos para ocultar un fallo.

## Evidencia y siguiente paso

`promotion-manifest.json`, `promotion-base.json`, `catalog.json`, `selected-metadata.json`, `contract-comparison.json`, `runtime-observation.json`, `oauth-observation.json`, `composio-usage-observation.json`, logs de pruebas en la carpeta superior. Capturas/metadatos acotados, sin secretos ni contenido de clientes. No hubo commit, push, migración, deploy, cambio de configuración, operación Auth ni envío remoto.

Siguiente paso concreto: obtener el medidor/tope de proxy aplicable de Composio y dar disposición al fallo heredado. Con eso se puede cerrar el release completo y proceder a la publicación coordinada autorizada. Si se desea publicar Gmail directo mientras tanto, esa reducción temporal de alcance debe decidirse expresamente; este preflight no la supone.
