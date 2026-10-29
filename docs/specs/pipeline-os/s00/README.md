# Sprint S00 validaciones locales y preparación de APIs

**Último incremento al28/10/2026:** [diagnóstico de lectura BD](instantly-b-diagnostic.md) implementado y probado offline:28 casos nuevos/284 S00, TypeScript correcto. Real sigue **B failed18**,8 archivos operativos idénticos,0 APIs/credenciales/migraciones/reinicio. Diagnóstico real pendiente de autorización propia hasta2 nuevas/20 acumuladas; no completa B o S00 ni demuestra la causa original.

**Estado vigente al28/10/2026:** Instantly B real autorizado y ejecutado:7 nuevas/**18 acumuladas**, detenido por B_UNSAFE_CAMPAIGN en comprobación inicial. Campaña propia pausada y verificada por emergencia,0 leads/envíos/operaciones pagas; historial A/R11 preservado. [Incidente y diagnóstico pendiente](instantly-phase-b-incident.md), sin causa por campo confirmada y sin reinicio automático. Composio/S00 restante conservan su alcance; S00 no está cerrado. Las cifras/pendientes anteriores quedan como cronología.

**Estado vigente al 27/10/2026:** Composio aceptado en su ensayo S00; Instantly A/R conserva **11 peticiones** y scopes declarados CRM-curated/all:all confirmados por operador. [Fase B](instantly-phase-b.md) implementada y verificada offline (**29 casos B, 256/256 S00**), sin llamadas reales, carga de credenciales, envíos o cambio del ledger operativo. B real, C/D, pendientes Supabase/TextTorrent y cierre S00 siguen abiertos. Las secciones siguientes conservan la cronología de los ensayos.

Actualizado: 26 de octubre de 2026. Estado: baseline local e inventario de metadatos de los tres proveedores completados; circuito funcional Composio validado en dos buzones, con cuatro PDF y dos confirmaciones. Catálogo remoto recibido: 81 tablas frente a 82 locales; 030 aplicada por el usuario y objetos comprobados mediante catálogo posterior correcto. Recepción automática en dos hilos Composio validada: 25.078ms y 21.757ms, 23 peticiones nuevas/60 acumuladas; reconexión, recepción CRM y contratos operativos restantes pendientes. S00 no se declara cerrado.

Estado vigente y cifras: [inventario de migraciones, permisos, límites y líneas](inventory.md). Resultado del ensayo: [protocolo Composio y variante autorizada de PDF propios](composio-test-plan.md). Las secciones cronológicas conservan los diagnósticos anteriores y sus correcciones; no implican que falten hoy las credenciales ya comprobadas.

Este informe ejecuta el alcance autorizado de S00 desde [spec.md](../spec.md), [design.md](../design.md) y [tasks.md](../tasks.md). No modifica flujos de producción, configuración existente, esquema remoto ni campañas. Los cambios locales previos del usuario permanecen intactos. El usuario autorizó usar y modificar el ambiente actual todavía sin uso: no se preparará otro entorno por ahora. El procedimiento y sus límites están en [environment.md](environment.md).

## Objetivo y alcance SDD

### Continuación local con las reglas Duarte

Modo implementación local de verificación, nivel **STANDARD**. Se mantienen los IDs RF/AC/T del plan existente; los siguientes FR son específicos de este paquete S00 y no renumeran requisitos anteriores.

| ID     | Requisito local                                                                                                                                   | Aceptación y tarea       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| FR-001 | La aceptación SQL debe distinguir nuevas campañas de primer contacto de las secuencias anteriores a 043, sin modificar negocio ni omitir pruebas. | S00-AC07, T00-02.        |
| FR-002 | Verificar la importación persistida de 50.000 filas ficticias y su replay usando únicamente PGlite desechable.                                    | S00-AC08, T00-02.        |
| FR-003 | En esta continuación no abrir archivos `.env` con valores reales, no usar credenciales privadas y no contactar servicios externos.                | S00-AC09, T00-02–T00-05. |

Diseño del ajuste: conservar la creación actual con `first_contact=true` y `steps=[]`; corregir la expectativa desactualizada de la suite y añadir una prueba que cree una campaña mediante el comando público antes de instalar 043, aplique las migraciones restantes y compruebe que pasos, ID y recibo idempotente históricos siguen intactos. No cambiar SQL ni invocar funciones internas para crear campañas nuevas con comportamiento anterior.

Hipótesis evaluadas: (1) expectativa de test desactualizada, confirmada al leer 043 y reproducir `0 !== 2`; (2) diferencia de runtime, descartada por reproducirse con Node 22; (3) fallo de carga de migraciones, descartado porque se aplican 001–045 antes del mismo assert. Tareas: corregir la fixture, proteger compatibilidad histórica, ejecutar DB/carga/regresión y registrar [verificación trazable](../verification.md). La parte externa continúa pendiente de identificar el ambiente actual y disponer de accesos; no bloquea este paquete local independiente.

Entregar un contrato verificable de configuración, inventariar el entorno sin divulgar valores y preparar pruebas de Composio, Instantly y TextTorrent. La falta de credenciales no impide verificar el contrato ni las migraciones en una base desechable. Sí impide certificar conectividad, permisos de planes, recepción cercana a un minuto y detención real de secuencias.

Incluido: herramienta offline, validador de configuración, ejemplo ficticio, pruebas de privacidad y validación, revisión de contratos oficiales, controles locales del repositorio y lista concreta de accesos. Excluido: conectar cuentas, crear OAuth/apps/webhooks, enviar mensajes, verificar contactos de pago, modificar una base remota, habilitar workers y desplegar.

## Criterios y evidencia

| ID       | Criterio                                                                                                                                 | Resultado                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| S00-AC01 | Inventario revela presencia/ausencia y clasificación de destino, nunca valores, dominios, destinatarios o errores con contenido privado. | Cubierto por herramienta y pruebas de redacción.                                                                       |
| S00-AC02 | Ningún diagnóstico contacta una API; localhost tampoco se presenta como staging verificado.                                              | Herramienta sin transporte de red; reporte `networkCalls: 0` y readiness externa no verificada.                        |
| S00-AC03 | Contrato exige máximos, calendario, presupuestos y distribución; conserva 48 h/24 h, baja global, supervisión y alcance del piloto.      | Cubierto por esquema Zod y pruebas. No implementa todavía el programador S06.                                          |
| S00-AC04 | Controles existentes se ejecutan localmente y sus fallos se reportan.                                                                    | TypeScript, aceptación SQL, carga persistida y 247/247 pruebas correctas; baseline corregido con protección histórica. |
| S00-AC05 | Contratos y pruebas reales diferencian capacidad documentada de capacidad comprobada en la cuenta.                                       | Matriz preparada; las tres APIs siguen sin prueba autenticada.                                                         |
| S00-AC06 | Operaciones reales usan el ambiente actual autorizado, ámbitos identificados y destinatarios controlados.                                | Pendiente de identificar destino y accesos de [access.md](access.md); no exige otro entorno. Sin operación real.       |
| S00-AC07 | La suite actual exige primer contacto; actualizar 043 preserva pasos, esperas, identidad y replay de campañas históricas, sin tocar SQL. | Prueba dedicada y aceptación SQL local ya ejecutadas correctamente en esta continuación.                               |
| S00-AC08 | Persistir 50.000 filas ficticias en bloques con replay y sin crear oportunidades ni contactar proveedores.                               | Correcto: 50.000 filas, bloques de 250, replay y aceptación SQL; carga de 34.427 ms en PGlite.                         |
| S00-AC09 | No abrir `.env` reales ni usar credenciales en esta continuación; conservar intactos los cambios previos del usuario.                    | Pruebas con PGlite/fixtures y lectura de código; sin inventario renovado de secretos.                                  |

## Diseño e implementación local

- [s00-contract.ts](../../../../scripts/pipeline-os/s00-contract.ts) contiene el contrato Zod y el inventario puro de variables conocidas. Devuelve estados y códigos, sin valores originales ni diagnósticos Zod con contenido de entrada.
- [s00-preflight.ts](../../../../scripts/pipeline-os/s00-preflight.ts) lee exclusivamente el archivo indicado mediante `--config-env`; no mezcla `process.env`, no autocarga `.env.local` y no tiene modo de red. Los errores de lectura, parseo o argumentos se reducen a un código fijo.
- [pipeline-os-s00.test.ts](../../../../tests/pipeline-os-s00.test.ts) prueba restricciones, datos faltantes, prioridades, zona horaria, protección de valores y el CLI como subproceso.
- [campaign.example.json](campaign.example.json) es una muestra ficticia para validar estructura. Los porcentajes, máximos, horario y presupuestos del ejemplo NO son parámetros aprobados por el usuario ni defaults de campañas. Ninguna pantalla o worker lo consume.
- No se añadieron dependencias ni comandos al manifiesto y no se modificó código de aplicación, workers o migraciones.

El contrato admite distribución por porcentajes o filtros priorizados, con no coincidentes retenidos para revisión. Valida estructura y coherencia numérica; no calcula asignación real, no comprueba cuentas en proveedores y no decide elegibilidad de una persona.

### Uso reproducible

Con Node 22 conforme al proyecto, desde la raíz:

```powershell
$s00Node22 = ".\.local\toolchains\node-v22.23.4-win-x64\node.exe"
& $s00Node22 --import tsx scripts/pipeline-os/s00-preflight.ts --campaign docs/specs/pipeline-os/s00/campaign.example.json
& $s00Node22 --import tsx --test tests/pipeline-os-s00.test.ts
```

No usar el flag `--env-file` de Node/tsx para esta herramienta: puede cargar variables antes de que el CLI controle errores. `--config-env` permite leer el archivo explícitamente sin autoload. Las pruebas detectaron esta colisión y se corrigió antes de entregar.

Código de salida: 0 = contrato offline válido; 2 = contrato faltante/inválido; 1 = error de entrada. **Salida 0 nunca significa que una API esté conectada o que haya permiso de envío.** Puede omitirse `--config-env` para validar solo la estructura con inventario vacío. No se imprimen rutas privadas ni valores en los errores controlados del CLI.

## Acceso disponible en esta continuación

La comprobación de presencia en el proceso heredado, sin abrir archivos `.env`, encontró ausentes las ocho variables examinadas de acceso Supabase/Composio/Instantly/TextTorrent. Solo se emitieron booleanos; no prueba ausencia en archivos privados o en el servidor. Para pruebas autenticadas faltan referencia del destino y provisión segura según [access.md](access.md). El diagnóstico offline ya no exige cuentas nuevas separadas, pero tampoco habilita red ni acredita conexión. Tras ese ajuste se repitieron las 10 pruebas S00 y TypeScript con resultado correcto.

## Inventario histórico de la sesión anterior

Los siguientes hallazgos pertenecen a la sesión anterior, previa a las nuevas reglas Duarte. En esta continuación no se reabren `.env.local` ni archivos privados de staging; no se afirma que la presencia de credenciales siga igual. Las ejecuciones del agente omiten `--config-env`; esa opción solo se usa en pruebas con archivos ficticios creados por los tests.

| Componente    | Hallazgo, sin valores privados                                                                                       | Consecuencia                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Supabase      | URL y claves presentes; destino remoto sin identificación de entorno.                                                | Excluido de pruebas: no se consulta, migra ni usa su service role.                                                              |
| Origen de app | Configurado como loopback.                                                                                           | No demuestra que la base asociada sea local o staging.                                                                          |
| Bouncer       | Clave presente.                                                                                                      | Presencia no equivale a validez; no se usó para evitar verificaciones pagas o datos reales.                                     |
| Cifrado       | Variable de integración presente.                                                                                    | No se muestra ni cambia; no se afirma validación de todas las credenciales guardadas.                                           |
| OAuth Google  | Lista de organizaciones vacía.                                                                                       | No hay configuración local de organizaciones para OAuth directo. Las cuentas almacenadas en la base remota no se inventariaron. |
| Gmail         | GMAIL_SYNC_MODE y GMAIL_HISTORY_ENABLED ausentes; identidad de servicio Pub/Sub vacía.                               | El código conserva Pub/Sub por defecto; esta configuración local no acredita recepción funcional.                               |
| Composio      | COMPOSIO_API_KEY y COMPOSIO_AUTH_CONFIG_ID ausentes.                                                                 | Sin prueba autenticada ni medición de latencia.                                                                                 |
| Instantly     | INSTANTLY_API_KEY ausente.                                                                                           | Sin validación de workspace/plan/cuentas ni pausa por lead.                                                                     |
| TextTorrent   | TEXTTORRENT_API_SID y TEXTTORRENT_API_PUBLIC_KEY ausentes.                                                           | Sin lectura de subcuenta/líneas ni prueba SMS.                                                                                  |
| Runtime       | Runtime inicial/cachés: Node 24.19.0; se obtuvo Node 22.23.4 oficial y se verificó SHA-256, en `.local/toolchains/`. | La validación final usa Node 22 compatible, sin reemplazar instalación global ni cambiar el lockfile.                           |
| Esquema       | 45 migraciones locales, 001–045.                                                                                     | Se aplicaron a PGlite desechable. Esto no identifica migraciones instaladas en Supabase remoto.                                 |

## Contratos y secuencia de validación externa

| Proveedor   | Lectura inicial del ámbito identificado                                                                                   | Prueba posterior con efectos, solo cuando esté autorizada                                                                                                                             | Condición aún no demostrada                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Composio    | Inventariar proyecto, auth config, cuentas conectadas y triggers; verificar dos buzones de prueba sin imprimir contenido. | Conectar identidades de prueba, enviar/recibir mensaje y adjunto controlados, repetir evento y reconectar.                                                                            | Selector de cuenta, permisos, recuperación y recepción medida alrededor de un minuto.       |
| Instantly   | Inventariar workspace, permisos de API, cuentas y campañas de prueba.                                                     | Crear borrador/lead ficticio, probar control de pasos/pausa y creación de resultado incierto en campaña ficticia del ámbito identificado. Activar envío es otra operación autorizada. | Frenar un lead sin afectar toda la audiencia, o adoptar pasos únicos liberados por CRM.     |
| TextTorrent | Consultar identidad/subcuenta, líneas/capacidades, saldo y límites sin mensajes reales.                                   | SMS a número controlado, respuesta, relectura y consulta de entrega con gasto acotado.                                                                                                | Acceso correcto a subcuenta, paginación y estados reales; recepción por consulta periódica. |

Fuentes oficiales consultadas:

- [Composio scoped project keys](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions): permisos separados por recurso; pedir primero lectura. [Cuentas conectadas](https://docs.composio.dev/reference/api-reference/connected-accounts): identidad explícita y autorización individual. No suponer que una clave autoriza por sí sola todos los buzones.
- [Índice oficial de Instantly](https://developer.instantly.ai/llms.txt) y [eventos webhook](https://developer.instantly.ai/guides/webhook-events): contratos de campañas/correo/eventos. No se ha comprobado autenticación de eventos ni pausa individual en la cuenta del usuario.
- [API TextTorrent](https://texttorrent.com/docs/api): autenticación mediante X-API-SID y X-API-PUBLIC-KEY. [Patrones SMS oficiales](https://www.texttorrent.com/features/sms-api): consultas REST y ausencia de un catálogo público completo de webhooks entrantes. La recepción inicial se diseñará con polling; no se inventan eventos o firmas.

Para latencia se registrarán recepción en buzón, evento, persistencia y visibilidad por separado; muestra, p50/p95/máximo, costo y demoras justificadas. Esta sesión no produjo mediciones reales. Si la configuración administrada no satisface D06 se prueba auth propia y la alternativa Gmail watch/history antes de comprometer la solución.

## Pruebas realizadas

Ejecuciones actuales con Node 22.23.4, sin abrir archivos `.env` reales ni arrancar web o worker contra un destino remoto. Evidencia y trazabilidad completas en [verification.md](../verification.md).

| Comprobación                                                    | Resultado actual                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato S00 y CLI con fixtures ficticias                       | 10/10 correctas, incluidas en la regresión completa. Sin autoload de archivos privados ni llamadas de red.                                           |
| Suite completa `tests/*.test.ts`                                | **247/247 correctas**, cero fallos, omisiones o cancelaciones; 109.217 ms.                                                                           |
| Compatibilidad de campañas al actualizar 043                    | Correcta; preserva pasos, esperas e identidad/replay de campañas históricas. Nuevas campañas: primer contacto sin pasos; permisos y MFA comprobados. |
| `tests/database.ts`                                             | Correcto: 45 migraciones y 16 grupos de aceptación tras corregir la expectativa desactualizada.                                                      |
| `tests/import-load.ts`                                          | Correcto: **50.000 filas persistidas**, bloques de 250, replay y ausencia de oportunidades automáticas; 34.427 ms de carga local.                    |
| TypeScript `tsc --noEmit`                                       | Correcto. No se repite `next typegen` en esta continuación.                                                                                          |
| APIs autenticadas, envío, latencia y backup/restauración remota | Pendientes de identificar el ambiente actual y de acceso seguro; ningún resultado local acredita estas capacidades.                                  |

Antecedentes de la sesión anterior: inventario explícito de configuración sin valores en el reporte, typegen, 51 pruebas seleccionadas y build con Webpack correctos. El primer intento del CLI falló por colisión con `--env-file`, se corrigió a `--config-env` y se repitió. El build con Turbopack encontró una restricción de permisos/junction de Windows. Estos antecedentes no se presentan como ejecuciones actuales. No se repite un build que cargaría `.env.local` bajo las nuevas reglas; no hay cambios de código de aplicación ni SQL en este paquete. El manifiesto no tiene script lint.

### Diagnóstico del fallo preexistente de base de datos

Antes del ajuste, [tests/database.ts](../../../../tests/database.ts) creaba una campaña nueva con dos seguimientos y esperaba `steps.length === 2` alrededor de la línea 794. La [migración 043](../../../../supabase/migrations/043_campaign_first_contact.sql) transforma toda campaña nueva a `first_contact=true` y `steps=[]`, preservando las secuencias antiguas. El fallo se reprodujo antes de las herramientas S00 con Node 24 y de nuevo con Node 22.23.4; no lo ocasionó este sprint ni se explica por el runtime.

La expectativa no coincidía con el contrato SQL vigente. En esta continuación se corrigió la prueba, no el comportamiento: se comprueba explícitamente primer contacto y se añade `tests/campaign-migration-compatibility.test.ts`, que crea la campaña antes de 043 mediante el comando público y verifica después sus pasos y replay. No se reactivan secuencias nuevas por un bypass. La aceptación SQL ya pasó; la regresión completa y carga correctas se registran en [verification.md](../verification.md).

## Estado por tarea y siguiente paso

| Tarea principal | Estado                                                                            | Falta para cerrarla                                                                                  |
| --------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| T00-01          | Contrato local y documentación preparados, validación offline ejecutada.          | Parametrizar la campaña real solo antes de activarla; no es una nueva decisión funcional.            |
| T00-02          | Baseline local, compatibilidad histórica y carga persistida completadas; parcial. | Identificar el Supabase actual autorizado, inventariar migraciones y preparar respaldo/restauración. |
| T00-03          | Contrato y plan Composio preparados.                                              | Proyecto actual, acceso seguro, dos buzones y prueba controlada de latencia/adjunto/reconexión.      |
| T00-04          | Contrato y plan Instantly preparados.                                             | Workspace actual y API; comprobar control por lead y conciliación en campaña ficticia etiquetada.    |
| T00-05          | Contrato y plan TextTorrent preparados.                                           | Cuenta/subcuenta actual, API, línea y autorización de SMS/gasto delimitada.                          |

Los accesos exactos y una plantilla histórica vacía están en [access.md](access.md) y [staging.env.example](staging.env.example). Sin esos elementos se conserva el avance local y no se interpreta la ausencia de pruebas como integración aprobada.

## Continuación del 25 de octubre: conexiones sin envíos

El usuario informó configuración completa de Composio/Instantly, credenciales de la administradora TextTorrent con act-as vacío y destinatarios controlados. Se preparó un [comprobador independiente](connections.md), con seis GET permitidos y cero red por defecto. No se cargaron archivos privados ni se efectuaron consultas autenticadas en esta preparación. Las pruebas dirigidas actuales suman 25/25 correctas y TypeScript pasó; las 247 pruebas completas del 24 de octubre permanecen como antecedente, no se repitieron hoy.

La excepción de carga interna fue concedida después de preparar la herramienta; el bloqueo actual es la asignación de valores del archivo S00, según el resultado que sigue. No faltan copias nuevas de las claves existentes. Supabase y Bouncer conservan su configuración en `.env.local` y no se usan en esta ronda. Esta parte no cierra T00-03–T00-05 ni demuestra entrega o recepción.

### Resultado autenticado de esta continuación

Composio respondió HTTP 401 al consultar metadatos del proyecto. El campo de API key contiene un valor con formato de Auth Config ID (`ac_`); no se muestra ni cambia el valor. Los IDs Composio y campos Instantly/TextTorrent están vacíos para Node en el archivo autorizado. Instantly y TextTorrent no fueron consultados. El primer intento en sandbox falló por DNS y el segundo fuera del sandbox obtuvo la respuesta del proveedor. Evidencia en [verification.md](../verification.md).

El usuario debe confirmar dónde guardó los valores y corregir su asignación en el archivo autorizado. Las pruebas finales del comprobador y regresión offline pasan **27/27**, con TypeScript correcto. No hubo envíos, verificaciones pagas, compras ni modificaciones remotas; la autenticación y los contratos operativos no quedan aprobados.

### Nueva revisión después de guardar las credenciales

La asignación anterior fue corregida. Instantly valida workspace esperado y lectura de cuentas (200). Composio valida configuración propia y una conexión ACTIVE (200) mediante consultas individuales, pero ambos campos `ca_` tienen el mismo ID. Falta el ID de un segundo buzón distinto. TextTorrent devuelve 405 al GET documentado y señala `Allow: POST`; su autenticación sigue pendiente y no se cambia de método sin autorización. Seis GET, sin envíos ni pagos; [evidencia](../verification.md).

### Identidad TextTorrent validada

La única consulta POST de identidad autorizada por el usuario devolvió **HTTP 200** con identidad válida de la administradora. La autenticación queda comprobada; el contrato real difiere del GET publicado. No hubo mensajes, verificaciones pagas, compras o cambios de configuración. El comprobador genérico sigue limitado a GET, por lo que ese chequeo debe actualizarse explícitamente antes de otra ejecución completa. El permiso POST concedido fue para una sola petición y ya se utilizó. [Evidencia y límites](../verification.md).

### Ambos buzones Composio comprobados

Después de corregir el segundo `ca_`, las tres consultas Composio (configuración y ambos buzones) devolvieron HTTP 200 y estado correcto. Se verificaron dos identidades de proveedor diferentes, ACTIVE, y ligadas a la configuración Gmail propia esperada. Las conexiones siguen siendo de Playground; falta integrarlas con el modelo/usuarios del CRM. No hubo envíos ni operaciones de pago. La autenticación inicial tiene evidencia positiva para Composio, Instantly y la administradora TextTorrent; S00 sigue abierto para criterios operativos. [Evidencia](../verification.md).

### Inventario y ensayo preparados, sin envíos

Se completaron 35 GET de metadatos, todos 200: scopes/contratos de Composio, workspace/plan/cuentas Instantly, subcuentas y líneas TextTorrent. Resultado: 32 cuentas Instantly (27 estado 1, cinco -1), seis subcuentas TextTorrent más administradora, 12 líneas propias sin doble conteo; cuatro capacidades SMS/MMS confirmadas y ocho desconocidas. Los roles efectivos de envío no se infieren de listas vacías de permisos.

Se verificó continuidad de 45 migraciones locales y se preparó SQL READ ONLY probado en PGlite. El usuario aceptó ejecutarlo en Supabase y compartir JSON; su resultado no ha llegado. No se cargó .env.local ni se aplicó SQL remoto. T00-02 sigue parcial para catálogo/ledger y respaldo/restauración.

Composio: dos buzones y cuatro scopes esperados; cero triggers activos. El helper de respuesta exige contactos, por lo que el plan propone proxy Gmail manteniendo los scopes actuales, pendiente de permiso y prueba real. No se cambió OAuth ni se implementó el adaptador de S02. El PDF ficticio está generado y revisado visualmente. El protocolo de seis mensajes totales (cuatro API y dos respuestas manuales) permanece deshabilitado y no cuenta con autorización de ejecución.

Verificación de este paquete: **38/38 pruebas dirigidas**, TypeScript correcto. Las 247 pruebas completas previas no se repitieron; tampoco build ni lint (sin script lint), pues no hay cambios de app y un build cargaría .env.local. Véase [verificación](../verification.md) para límites de evidencia y pendientes de S00.

### Catálogo Supabase recibido y contrastado

El usuario compartió el resultado READ ONLY: 81 tablas regulares, todas con RLS, 73 políticas y seis marcadores verdaderos; ledger ausente. Las 81 coinciden con el baseline local en nombre, RLS y número de políticas. No aparece lender_guideline_versions (030), por lo que se preparó una [consulta puntual](../../../../scripts/pipeline-os/s00-lender-guidelines-inventory.sql) antes de proponer reparaciones. Los 16 nombres con cero políticas coinciden con el diseño local; no se añaden políticas automáticamente. La comparación no acredita definiciones/grants ni todas las migraciones instaladas. [Resultado y alcance](inventory.md). No hubo conexión remota directa, cambios o envío de mensajes.

### Objetos 030 ausentes, reparación candidata ensayada

El segundo JSON confirma ausencia de tabla, columnas, funciones y trigger comprobados. Se reprodujo exactamente el catálogo recibido con 001–029 + 031–045; aplicar luego el archivo original 030 recupera los objetos en local. Ocho comprobaciones de conservación de datos ficticios, permisos/MFA, replay, historial y snapshots pasan. El segundo intento de instalación se rechaza, por lo que no debe reintentarse a ciegas. [Plan concreto](lender-management-recovery.md). No se aplicó SQL remoto, no se creó respaldo y no se ejecutaron mensajes; T00-02 continúa parcial.

### Decisión vigente sobre respaldo

El usuario pidió omitir el respaldo en este ambiente de pruebas y conservar la información. Se elimina ese paso como bloqueo de la aplicación autorizada de 030. Siguiente acción: ejecutar el SQL original completo una vez en el mismo Studio y postvalidar. No se ha aplicado todavía en remoto ni se exige otra autorización para 030; las pruebas operativas de proveedores siguen pendientes.

### 030 ejecutada por el usuario: postvalidación pendiente

El usuario informó Success al aplicar el archivo 030 en SQL Editor. Sigue la consulta puntual READ ONLY para confirmar tabla, columnas, RLS/política, funciones y trigger; no repetir la migración. No se ha recibido todavía el resultado posterior del catálogo y no se declara reparación validada ni cierre de S00.

### 030: catálogo posterior validado

El usuario compartió el JSON después de instalar 030: coincide exactamente con el catálogo puntual del ensayo local. Tabla/cinco columnas/RLS/una política, dos columnas de lenders, tres funciones y trigger presentes. [Evidencia](supabase-lender-guidelines-postmigration-user-provided.json). Esta corrección queda verificada en existencia de objetos; no acredita funcionalidad o permisos efectivos remotos, definiciones completas, recuento global posterior o integridad de filas antes/después. S00 sigue abierto para capacidades operativas de proveedores. Respaldo omitido por decisión del usuario; no repetir la migración.

### Ejecutor API Composio preparado

El usuario pidió ejecución por API. El [ejecutor](composio-runner.md) está implementado y probado, con proxy Gmail, journal/lock y reservas contra duplicados. Verificación: 52/52 pruebas S00 y TypeScript correctos. Dos conexiones reales preparadas, sin envíos. La API de uso no expone cupo mensual restante; el usuario está localizando plan/contador para compartir una imagen. No se exige otra aprobación general de mensajes autorizados. Hasta resolver la cuota incluida, no se ejecutan perfiles/proxy o correos.

### Cuota revisada; ejecución detenida por permiso Proxy execute

Las capturas confirman Hobby con 100.000 llamadas mensuales incluidas y uso cero en la ventana de siete días. Primer perfil por proxy: HTTP 403 antes de todo envío; una reproducción diagnóstica identifica permiso proxy-execute. Ambos correos siguen not_sent. Seis llamadas acumuladas del run, sin reset. Recuperación mínima preparada y probada para rotar solo la clave conservando destino/token/contador; S00 54/54 y TypeScript correctos. [Incidencia y permisos mínimos](composio-runner.md). Pendiente clave con permiso Proxy execute (Legacy), Write only; no requiere ampliar OAuth Gmail ni cambiar de plan.

### Dos correos iniciales enviados por API

La clave nueva y el destino original pasaron la revalidación. Los dos perfiles Gmail coinciden con las conexiones y se aceptó un correo ficticio por cada buzón. Run acumulado 15/32, instantCharge reportado 0; no equivale a medir todo el cobro o entrega al destinatario. Se esperan dos respuestas humanas en los mismos hilos con PDF. No hay cambios de aplicación, OAuth, worker o Supabase. [Protocolo actual](composio-test-plan.md). S00 continúa abierto para respuesta, adjunto y demás criterios.

### Respuestas observadas y adjuntos distintos del fixture

Las dos respuestas del destinatario llegaron a sus hilos. El ensayo no encontró el ACK y los PDF son otros (dos por respuesta, algunos de varios MB). Se leyeron solo los metadatos/texto necesario para identificar la prueba; no se descargaron o analizaron esos PDF ni se enviaron confirmaciones. Run 20/32 llamadas, detenido sin reenvíos. El usuario preguntó qué es ACK; se explicó como etiqueta del ensayo y se espera su decisión sobre los adjuntos. Recepción observada positiva; hash/confirmaciones/latencia siguen pendientes.

### Circuito multibuzón completado con los PDF autorizados

Tras autorización expresa, se comprobaron por bytes los cuatro PDF (dos por hilo) hasta 10 MB/archivo, sin extraer o analizar contenido ni guardar documentos. Se enviaron dos confirmaciones y se verificaron en sus hilos. Resultado: dos iniciales, dos respuestas, cuatro adjuntos y dos confirmaciones, **37/40 solicitudes** acumuladas (33 del ejecutor y cuatro diagnósticos anteriores), sin reset o duplicados. Checks locales: **60/60 y TypeScript correctos**. [Evidencia detallada](../verification.md).

Esto valida el circuito funcional por Composio con esas cuentas y archivos. No compara contra hash de origen, no demuestra lectura automática cercana a un minuto ni integración en la app. S00 sigue abierto para esos criterios, reconexión y contratos operativos Instantly/TextTorrent.

## Protocolo de recepción automática preparado: 26 de octubre de 2026

[S00-A: protocolo, contrato, presupuesto, criterios y tareas](composio-auto-receive.md), modo planificación STRICT. Propuesta: observar nuevas respuestas en los dos hilos existentes cada 30 s, hasta seis minutos, sin cuerpos, PDF o envíos API. Prever 13–35 peticiones, máximo nuevo40 con cinco reintentos; histórico37, techo acumulado propuesto77. No se ejecutó ni se amplió el techo vigente40. Recepción local del observador, latencia, reconexión e integración CRM siguen sin acreditarse por este nuevo plan.

## Observador implementado y validado offline: 26 de octubre de 2026

S00-A-T02/T03 completados con **35 pruebas nuevas y 95/95 S00**. [Observador y uso local](composio-observer.md): metadata, temporizador30s, deduplicación, reloj/latencia, techo/reserva y locks; cero API real, env privados o cambios del journal histórico. El CLI sigue offline por defecto. Revisión y criterios locales en [verificación](../verification.md); T04 y aceptación real pendientes, presupuesto previo37/40 intacto.

## Ensayo real S00-A completado: 26 de octubre de 2026

Dos respuestas nuevas detectadas/persistidas automáticamente en 25.078ms (M1) y 21.757ms (M2); relecturas sin duplicados. 23 consultas nuevas, total60/77, cero reintentos, sin envíos API/adjuntos/contenido. Uso Instant0 antes/después; no saldo mensual ni auditoría global de cargos. Replay local real: cero red/escrituras, source intacto, locks liberados y observador detenido. [Evidencia](../verification.md). T04/T05 de este bloque completos; S00 sigue abierto por reconexión y pendientes de otros proveedores. Recepción CRM sigue en S02/S03.

## S00-B preparado: desconexión y reconexión OAuth

[Protocolo, presupuesto y aceptación](composio-reconnect.md) preparados en modo planificación STRICT: M1 revocación/reauthorización, M2 control; enlace válido y recuperación preparados antes de afectar acceso. Base60 comprobada mediante lectura local de journals, perfiles distintos con owner Composio compartido. No se abrió s00.env ni se llamó a APIs. Recorrido normal18–21, máximo28 nuevas/88 acumuladas propuestos. El techo autorizado anterior sigue77 y no se revocó ninguna cuenta; siguientes tareas implementación y QA offline.

Actualización operativa S00-B: usuario autorizó28 nuevas/88 acumuladas; M1 revocado una vez, rechazo de conexión antigua y control M2 correctos. Tras vencimiento del primer enlace y consentimiento en el segundo, candidate ACTIVE tiene perfil diferente de M1. Se detuvo sin binding ni tercer enlace: **20 nuevas/80 acumuladas, H4 agotada**. Recuperación de M1 y cierre S00 pendientes; ocho slots del techo global no reponen H4. [Evidencia y decisión de identidad pendiente](../verification.md). QA offline actualizado142/142, TypeScript correcto; sin envíos API o descargas en este bloque.

Última actualización: diagnóstico de una lectura autorizado por separado confirmó **M2**, con perfil válido. **21 nuevas/81 acumuladas**, H4 agotada, sin binding; M1 sigue pendiente de recuperación. La excepción diagnóstica terminó y no permite otro enlace o cambios de cuentas. [Contrato y resultado](composio-identity-diagnostic.md); QA offline146/146 y TypeScript correctos.

## S00-C preparado: Gmail M1 correcto

[Protocolo de corrección](composio-m1-correction.md), planificación STRICT: confirmar correo M1 offline antes de generar un solo enlace nuevo, avisar al operador para selección explícita en Google y comprobar perfil/histórico/M2/cierre. **11–13 peticiones normales; hasta16 con reserva;81→máximo97 acumuladas propuestos**. No se consumen APIs o amplía el techo vigente88 por planificar. Implementación/QA offline y autorización de ejecución pendientes; no iniciar consentimiento ahora. Se preservan fuentes/counters y conexión M2 equivocada, sin otro revoke o envío.

Implementación posterior autorizada sin red: C-T02/C-T03 completados,27 pruebas nuevas y **173/173 S00**, TypeScript correcto. [Guía offline](composio-correction-runner.md). Journal real no migrado y total81 intacto; archivo privado s00-m1-target-email.txt preparado vacío para el remitente M1. Ningún enlace real o envío. Tras completar target, correct_precheck funciona sin credenciales/API; C-T04 real todavía requiere autorización y aviso posterior para Google.

## Reconexión M1 implementada y validada offline

S00-B-T02/T03 completos: [ejecutor por fases](composio-reconnect-runner.md), 45 pruebas nuevas/140 S00 correctas y TypeScript. Normal18–21/máximo28 nuevas comprobados con fixtures, base sintética60/techo88. No llamadas reales, env privados, revocaciones o auth links reales; las cuentas y el ledger real60/77 permanecen intactos. T04 requiere autorización específica y comprobar permisos/cupo/consentimiento humano. S00 sigue abierto.

## Estado actual: reconexión real de M1 completada

Con autorización C16/97 y selección humana del correo correcto, el ensayo terminó en **11 nuevas/92 acumuladas**. Perfil M1 original, histórico/relectura y M2 original antes/después correctos; binding pausado, closureComplete=true y uso Instant0 antes/después. Sin retries, envíos o descargas. Replay offline HTTP0/escrituras0, fuentes/counters históricos preservados y locks liberados. [Evidencia de C-T04/C-T05](../verification.md), [ejecutor y límites](composio-correction-runner.md).

La variable histórica del ID M1 no se reescribe: el nuevo CA ID verificado reside en el binding privado v2, el original queda como lineage revocado. Integración/activación en CRM y limpieza de conexiones duplicadas fuera de alcance. T00-02/T00-04/T00-05 aún tienen pendientes; S00 general no se cierra con esta prueba.

## Próximo bloque preparado: Instantly

[Protocolo S00-INS](instantly-validation.md) y criterios de aceptación preparados siguiendo SDD STRICT. Configuración clave/workspace/destinatario presente y con forma válida, revisada sin valores o API; permisos actuales siguen desconocidos. Fases propuestas: A lectura6–10/hasta12; B campaña/dos leads sin emisión19–20/hasta25; C webhook técnico9–10/hasta15 condicionado a receiver propio. Hasta52 nuevas del conjunto, sin autorización de ejecución y sin usar el presupuesto de Composio.

No se acredita pausa individual desde status read-only ni respuesta real desde test webhook. Alternativa provisional de pasos únicos y futura prueba INS-D mantienen los requisitos operativos abiertos; A/B/C no cierran T00-04 solos. Solo INS-T01 preparado; implementación/QA offline son el siguiente paso, sin activar campañas o enviar mensajes hoy.

## Incremento posterior: ejecutor A listo offline

[Guía, aceptación y evidencia INS-A](instantly-phase-a.md): núcleo/CLI/files implementados y probados con fixtures. 30 casos nuevos y **203/203 S00**, TypeScript correcto. Status por defecto sin env/mkdir/HTTP; `--check-config` sin autoload. Futuro execute solo A12 con alcance y cupo confirmados, sin mutaciones. Reserva N10/R2 previa a HTTP, límite8s/2MiB, schemas/tenant/clave exactos y replay conservador. No se cargaron credenciales ni se hicieron llamadas reales. Pendiente autorizar/ejecutar INS-T04; B/C, receiver y prueba operativa D continúan pendientes.

## Estado posterior: recuperación de paginación lista offline, real4 preservado

Ensayo A autorizado con plan confirmado se detuvo en4 por keys duplicadas; workspace/plan acreditados, scopes y lecturas restantes pendientes. [INS-R](instantly-pagination-recovery.md) implementado y probado offline: futuro journal v2 del mismo archivo conserva snapshot v1, techo12 y máximo8 nuevas; una muestra diagnóstica de claves, refresh/lecturas restantes y R2 compartida. **24 casos nuevos,227/227 S00**, TypeScript correcto. Preview real HTTP0/save0, hash y versión1 failed4 intactos, sin migración o carga de credenciales. R-T04 real pendiente; instrucción vigente prohíbe ejecutar APIs. No hay envío/campaña activada o aceptación B/C/D/S00.

## Estado actual: recuperación real11/12, permisos de clave pendientes

Autorizada y completada INS-R con **7 nuevas+4 previas=11 acumuladas**, N10/R1 (una página adicional de cuentas, cero retries). V2 conserva íntegro el fallo previo y su hash; replay offline HTTP0/save0 y cero locks. Workspace/plan83 posiciones, inventario32 cuentas, tipos de evento y búsqueda de nonce confirmados. Ningún envío o recurso remoto creado. Muestra de claves no identifica exactamente la actual: **scopes desconocidos**, único bloqueo restante. Acreditarlos en el panel antes de fases con efectos; no hay reset o reapertura automática aunque sobre1 intento. [Evidencia](../verification.md). T00-04 y S00 siguen abiertos.

## Confirmación posterior: CRM-curated/all:all acreditado por operador

La captura y la confirmación explícita del usuario vinculan CRM-curated/all:all con la variable guardada. Se registró constancia privada vinculada a la última huella probada; no se cargaron credenciales ni se hizo API. INS-T04 aceptado para descubrimiento/scopes declarados; el reporte API histórico sigue sin match y no se reescribe. Journal idéntico, **11/12**, sin envíos o fase nueva autorizada. Próximo bloque: ejecutar desarrollo/QA offline de B dentro de su propia solicitud; permisos efectivos y campaña/audiencia se verifican solo al ejecutar B autorizado. S00/T00-04 continúan abiertos. [Evidencia y límites](../verification.md).
