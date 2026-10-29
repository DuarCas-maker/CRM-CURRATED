# S00: inventario y preparación del ensayo Composio

Fecha: 25 de octubre de 2026. Modo diagnóstico y preparación, SDD STANDARD para herramientas locales; marco global STRICT. El usuario autoriza inventariar migraciones, permisos, límites, subcuentas y líneas, y preparar el ensayo sin ejecutar mensajes ni operaciones pagas. No autoriza cambios de esquema, activaciones, compra de líneas ni ejecución de herramientas Gmail.

## Requisitos y aceptación

| ID         | Requisito                                                               | Aceptación                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S00-I-FR01 | Inventariar migraciones locales y distinguir catálogo/ledger remoto.    | S00-I-AC01: contar y verificar continuidad 001–045 local; jamás inferir instalación remota de una API accesible o de un marcador aislado.                                                                                                                         |
| S00-I-FR02 | Inventariar capacidades de lectura y límites sin mutaciones.            | S00-I-AC02: rutas documentadas de metadatos, GET únicamente, sin ejecutar tools, crear triggers, consultar conversaciones, enviar o verificar contactos. Un 403 se registra sin elevar permisos.                                                                  |
| S00-I-FR03 | Contar subcuentas/líneas y atributos operativos con paginación acotada. | S00-I-AC03: cuentas con alias locales, permisos conocidos, límite diario y capacidades SMS; sin nombres, emails, números, IDs o secretos en resultados. Reportar si el inventario está incompleto.                                                                |
| S00-I-FR04 | Preparar una prueba concreta y revisable de Composio.                   | S00-I-AC04: remitentes/destinatario resueltos privadamente, texto y PDF ficticios, número máximo de mensajes y llamadas, medición, criterios y parada ante resultado incierto; ejecución deshabilitada.                                                           |
| S00-I-FR05 | Preservar reglas de acceso a secretos y límites de autorización.        | S00-I-AC05: reutilizar únicamente la carga interna ya autorizada de `s00.env`; no cargar `.env.local` ni repetir el único POST TextTorrent ya consumido. Migraciones remotas requieren acceso SQL de lectura o un resultado de metadatos aportado por el usuario. |

## Diseño

No hay cambios en la aplicación, base o worker. El inventario local usa archivos SQL del repositorio. Las consultas remotas se ejecutan con hosts/rutas fijos, sin redirecciones, sin reintentos y con timeout/tamaño máximos; solo se guardan resúmenes sanitizados. Los cursores y emails de subcuentas permanecen en memoria; nunca se siguen URLs de paginación devueltas por el proveedor. Se construyen páginas sobre la misma ruta autorizada.

Lecturas previstas:

- Composio: configuración y conexiones esperadas, metadatos de herramientas Gmail y trigger de nuevo correo, instancias de trigger filtradas por las cuentas. No ejecutar herramientas para comprobar permisos: el alcance de lectura y los scopes solicitados no acreditan permisos efectivos de ejecución.
- Instantly: plan del workspace, cuentas paginadas y, si el permiso existe, metadatos de la clave actual. Nunca sumar permisos de otras claves ni devolver sus valores.
- TextTorrent: listado paginado de subcuentas y números activos de la administradora y de cada subcuenta activa mediante act-as. No `/me` POST ni inbox de mensajes. La ruta de números activos no se confunde con abrir una conversación, que puede marcar mensajes leídos.
- Supabase: consulta de catálogo en transacción READ ONLY mediante SQL preparado. La clave de API no equivale a acceso SQL al ledger. Si no hay conexión SQL utilizable, entregar la consulta y registrar el bloqueo sin pedir duplicar claves existentes.

Límites: máximo cinco páginas por listado, hasta 100 cuentas Instantly por página y 50 registros TextTorrent por página; máximo 40 solicitudes de metadatos por ejecución. Detener un listado ante 401/403/429, formato inesperado o falta de progreso, y reportar parcialidad. Ninguna ruta de envío, compras, warmup o verificación se incluye. Los límites publicados y los observados en la cuenta se registran por separado.

Interpretación de respuestas: permisos explícitos vacíos no prueban denegación del rol; las capacidades ausentes o expresadas como un array vacío son desconocidas. Contar por separado capacidades confirmadas y desconocidas. El listado de la administradora puede agregar líneas de subcuentas: filtrar por propietario antes de atribuirlas, sin interpretar esa agregación como un fallo de seguridad. `complete` acredita únicamente el recorrido de las páginas del listado.

## Tareas y pruebas

| Tarea     | Dependencia   | Terminada cuando                                      | Verificación                                                                                         |
| --------- | ------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| S00-I-T01 | T00-02        | Manifiesto local y SQL de catálogo/ledger preparados. | Continuidad local y consulta de catálogo en PGlite ficticio; remoto solo con acceso disponible.      |
| S00-I-T02 | T00-03–T00-05 | Inventario autorizado ejecutado y resumido.           | Contratos oficiales, estados reales, paginación y anonimización; lo desconocido queda pendiente.     |
| S00-I-T03 | S00-I-T02     | Ensayo Composio preparado y revisable, sin ejecutar.  | Comprobar que no hay flag de envío habilitado ni secretos/destinatarios reales en artefactos.        |
| S00-I-T04 | S00-I-T01–03  | Evidencia y siguientes pasos actualizados.            | Revisión de archivos, formato/enlaces y resultados sin confundir muestras con inventarios completos. |

La skill [supabase-engineer](C:/Users/Usuario/.agents/skills/supabase-engineer/SKILL.md) se aplica al diagnóstico del catálogo y no autoriza migraciones. Reversión de este paquete: retirar herramientas y documentos de inventario; no hay efectos remotos que revertir.

## Evidencia

### Migraciones y permisos de base

[Manifiesto local](migrations-local.json): **45 archivos, secuencia continua 001–045**, con SHA-256 por archivo. No se modificó ninguna migración. La [consulta de catálogo](../../../../scripts/pipeline-os/s00-database-inventory.sql) pasó en PGlite con las 45 migraciones, 82 tablas públicas y los seis marcadores esperados. En esa base local no existe ledger Supabase; es coherente con la aplicación manual de SQL del test y no describe el servidor real.

**Resultado remoto recibido del usuario:** [catálogo aportado](supabase-catalog-user-provided.json), 81 tablas públicas regulares, todas con RLS habilitado, 73 políticas en total y seis marcadores verdaderos. `migration_ledger_available=false`: no procede ejecutar la consulta opcional del ledger ni asumir que ninguna migración fue instalada. No se leyó `.env.local`, no se pidieron claves ni hubo conexión remota directa del agente.

[Comparación local](supabase-catalog-comparison.json): las 81 tablas reportadas coinciden exactamente en nombre, RLS y número de políticas con la base PGlite reconstruida mediante 001–045. Hay una diferencia: `lender_guideline_versions` existe localmente y no aparece en el listado remoto. La consulta original solo lista relaciones de tipo `r`; antes de afirmar ausencia física, comprobar su presencia/tipo mediante catálogo. Esto impide acreditar equivalencia de esquema o instalación íntegra de 030 a partir de los seis marcadores.

Los 16 nombres con cero políticas también coinciden con el baseline local. Las migraciones restringen acceso directo a tablas internas (por ejemplo, credenciales y aplicaciones cifradas); no corresponde añadir políticas de lectura por ese contador. No se han comparado definiciones de políticas, grants, owners o comportamiento de roles remotos: RLS habilitado no constituye por sí solo una auditoría de permisos correcta.

Impacto localizado: [030_lender_management.sql](../../../../supabase/migrations/030_lender_management.sql) crea la tabla, las columnas `lenders.guidelines`/`guideline_version`, funciones de guardado/importación y un trigger de snapshot. El [endpoint de guidelines](../../../../src/app/api/lenders/guidelines/route.ts) consulta la tabla, y la función de guardado inserta su historial. Si la tabla está ausente, esas operaciones pueden fallar. No se invocaron operaciones reales para comprobarlo y no se concluye que toda 030 esté ausente.

Seguimiento S00-I-T01: preparar y probar [consulta puntual de 030](../../../../scripts/pipeline-os/s00-lender-guidelines-inventory.sql), READ ONLY, sin filas de lenders ni ejecución de funciones de negocio. Criterio: devuelve tipo/columnas/RLS/conteos de políticas de los objetos implicados y presencia de firmas/trigger, tanto con 030 instalada como antes de instalarla. Después contrastar el JSON del entorno actual antes de diseñar una migración reparadora. No reejecutar 030 a ciegas ni crear un ledger retrospectivo. Backup/restauración y comparación de definiciones completas siguen pendientes.

### Lecturas reales de proveedores

**35 GET autenticados**, todos HTTP 200: inventario principal 23, diagnóstico de formatos 3, contratos de herramientas/trigger 6, contrato de adjuntos 2 y confirmación de requisitos de respuesta 1. Desglose: Composio 19, Instantly 6, TextTorrent 10. Ningún POST en esta continuación; no se repitió la consulta única de identidad TextTorrent. Cero envíos, tools ejecutadas, compras o verificaciones pagas; el cobro del proveedor no se midió. La autorización de lectura no se interpreta como autorización de consumo de ejecución.

Los resultados sanitizados se conservan únicamente en `.local/pipeline-os/`, ignorado: `s00-inventory-result.json`, `s00-inventory-details.json`, `s00-composio-tool-contracts.json`, `s00-composio-attachment-contract.json`, `s00-composio-reply-contract.json`. No contienen credenciales, IDs privados, nombres, emails ni números. La primera captura contabiliza capacidades `true`; el diagnóstico posterior demuestra que los arrays vacíos son desconocidos. El comprobador actualizado añade contadores de desconocidos y distingue permisos explícitos de efectivos; no se repitió todo el inventario solo para cambiar etiquetas de reporte.

### Composio

- Configuración propia y ambos buzones corresponden a los IDs esperados. Scopes solicitados: perfil/email y `gmail.readonly`/`gmail.send`; sin `gmail.modify`, `gmail.compose` o acceso completo. El chequeo previo acredita ACTIVE y dos identidades distintas; este inventario no ejecutó Gmail.
- Cinco definiciones de herramientas y trigger de correo consultados, versión `20261023_00`. **Cero triggers activos** en la configuración, listado completo; trigger publicado de tipo polling, no push de Gmail. No se concluye que no pueda entregar resultados del polling a un receptor webhook de Composio; ese contrato debe diseñarse y verificarse antes de activarlo.
- Cabecera real `x-ratelimit: 2000`, con remanente entre 1999 y 1990 durante el inventario principal. Es cuota API observada; no acredita plan, precio, permiso de ejecución ni capacidad de envío Gmail.
- `GMAIL_REPLY_TO_THREAD` exige además uno de tres scopes de contactos que no están configurados. Se prepara una respuesta por proxy con permisos actuales, sin ampliar OAuth: [protocolo y límites](composio-test-plan.md). Permiso Proxy execute y comportamiento aún pendientes.

### Instantly

- Workspace esperado confirmado; suscripción outreach presente, límite total/base **25.000 leads**. `available_credits=0` en el producto de créditos: no equivale al saldo o cuota de envío de correo y no justifica comprar un plan.
- **32 cuentas**, paginación completa: 27 con código de estado `1` y 5 con `-1`. No se activaron, repararon ni probaron envíos. Límites diarios configurados: seis cuentas en 60 y veintiséis en 30; son ajustes, no una garantía de entregabilidad o capacidad restante. Los cinco códigos negativos requieren revisión antes del piloto.
- Ninguna de esas 32 direcciones coincide con los dos buzones Composio, comparación únicamente en memoria. No es un error de autenticación; no asumir estadísticas o remitentes compartidos entre servicios.
- La consulta de claves devolvió una página con dos registros y cursor adicional, sin identificar la clave actual. **Scopes exactos de esa clave desconocidos**; la lectura autorizada de cuentas/plan sí tiene evidencia. No se recopilan ni suman permisos de otras claves; el listado de claves no se presenta como inventario completo.
- Límite publicado: [100 solicitudes/s, 6.000/min por workspace](https://developer.instantly.ai/getting-started/rate-limit). No se observó una cuota equivalente en cabeceras; no se hizo prueba de saturación.

### TextTorrent

**6 subcuentas activas y aprobadas + administradora = 7 cuentas; 12 líneas activas**. Recorrido de páginas completo; las lecturas act-as de las seis subcuentas respondieron 200 y líneas con propietario correcto. La consulta raíz agregó las 12 líneas; el filtro por propietario atribuye solo una a la administradora y excluye las otras once de su subtotal. No sumar ese listado agregado a los subtotales.

| Alias          | Líneas propias activas | SMS/MMS confirmadas | Capacidad no declarada |  Límite SMS diario configurado |
| -------------- | ---------------------: | ------------------: | ---------------------: | -----------------------------: |
| Administradora |                      1 |                   0 |                      1 |    No consultado en esta ronda |
| Subcuenta 1    |                      1 |                   0 |                      1 |                          5.000 |
| Subcuenta 2    |                      1 |                   0 |                      1 |                          5.000 |
| Subcuenta 3    |                      2 |                   1 |                      1 |                          5.000 |
| Subcuenta 4    |                      1 |                   0 |                      1 |                          5.000 |
| Subcuenta 5    |                      5 |                   3 |                      2 |                          5.000 |
| Subcuenta 6    |                      1 |                   0 |                      1 |                          6.000 |
| **Total**      |                 **12** |               **4** |                  **8** | No sumar como saldo disponible |

Cuatro líneas retornan objeto de capacidades con SMS y MMS `true`; ocho retornan array vacío. **Desconocido no significa incapaz**. Todas las subcuentas retornan `permissions=[]` y no incluyen permisos de rol: no hay permisos explícitos declarados ni prueba de permiso efectivo de envío. La lectura act-as sí quedó comprobada; no se amplió ningún rol.

El [contrato público](https://texttorrent.com/docs/api) indica **60 solicitudes/minuto compartidas por la administradora**, no 60 por cada subcuenta. El límite diario de cada subcuenta no es saldo, autorización de campaña ni prueba de entrega. Saldo/precio y límite diario de administradora pendientes; no se repitió POST `/me` ni se consultaron inbox/conversaciones.

### Ensayo preparado y cierre pendiente

[Plan Composio](composio-test-plan.md) y PDF ficticio listos, sin ejecutor de envío habilitado. El ensayo propone como máximo cuatro correos API y dos respuestas manuales, 32 operaciones Composio y dos descargas de adjuntos, únicamente después de autorización específica del protocolo y consumo. Permisos efectivos, transporte de adjunto, latencia real, revocación/reconexión y pruebas operativas Instantly/SMS siguen pendientes. S00 permanece abierto. El catálogo y el seguimiento de 030 ya se recibieron: faltan sus objetos comprobados. La [recuperación propuesta](lender-management-recovery.md) está ensayada localmente; el respaldo y su aplicación remota siguen pendientes.

### Seguimiento 030 recibido: ausencia confirmada

El [resultado puntual aportado](supabase-lender-guidelines-user-provided.json) no encuentra tabla, columnas, tres funciones o trigger de 030. La reproducción 001–029 + 031–045 coincide con todos los metadatos del catálogo aportado; aplicar después la 030 original funciona localmente. Ocho comprobaciones funcionales y de permisos correctas, con fixtures ficticias. [Propuesta, evidencia, riesgos y recuperación](lender-management-recovery.md). No hubo SQL remoto ni cambios en migraciones. El respaldo/restauración y una autorización específica siguen pendientes antes de ejecutar la reparación; no se requiere otro JSON de diagnóstico idéntico.

### Postvalidación 030 positiva

Se recibió el [catálogo puntual posterior](supabase-lender-guidelines-postmigration-user-provided.json), idéntico al del ensayo local. Se confirma existencia de la tabla regular con sus cinco columnas/RLS/una política, las dos columnas de lenders, tres funciones y trigger. La comprobación de objetos faltantes queda resuelta; no equivale a verificar las definiciones, grants, funcionalidad remota o todos los datos del servidor. No se vuelve a solicitar aplicar 030 o hacer respaldo.
