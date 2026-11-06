# Diseño — tres identidades y una asociación revisada

C3 compuesto/probado offline31/10/2026 por continuación humana: [evidencia](block-c/c3-verification.md),14 nuevas/125 regresión/TS correctos. Un test nuevo, sin cambios a producto/SQL/fixtures C1/C2/A/B/I01. C1/C2/C3 funcionales locales; siguiente: preparar versión conjunta A/B/C y cierre de gates INT-T04/T00-02-I. QA visual/build/contención, catálogo y promoción siguen pendientes. Directo activo, Composio deshabilitado, Instantly43/0 nuevas; sin APIs/envíos/remoto/push/deploy. Las constancias anteriores conservan su alcance histórico.

C2 local implementado/probado31/10/2026 por autorización humana: [evidencia](block-c/c2-verification.md),28 nuevas/97 regresión/TS correctos. Dos fuentes C1 extendidas/dos adiciones; identidad/permisos y evidencia sellada con dependencias falsas, aprobación humana sin activar transporte. C3 y promoción pendientes; Gmail directo activo, Composio deshabilitado, Instantly43/0 nuevas. Sin env reales/API/envíos/SQL remoto/push/deploy o cambios del checkout S01. Las constancias previas conservan su alcance histórico.

Actualización C1 implementada31/10/2026: [entrega y límites](block-c/c1-verification.md),24 pruebas nuevas/73 regresión/TS correctos. Registro/API/panel/revocación de candidatos y SQL en memoria, sin evidencia positiva o selector Composio. I01/A/B/47 SQL/49 hashes operativos conservados fuera del único compartido permitido; Instantly43 y0 API/envíos/remoto/push/deploy. Siguiente incremento: C2, verificador inyectable offline y protocolo de evidencia, bajo solicitud; visual/build/contención/catálogo y promoción siguen pendientes.

Actualización C31/10/2026: [diseño concreto](block-c/design.md), [ADR004](block-c/adr-004-evidencia-sin-selector.md) y [paths finitos](block-c/manifest.json) sustituyen las candidaturas abiertas C más abajo. Persistencia/cabecera CAS/checks y rutas propias, sin otro wrapper crm_command, sin tocar revisión comercial B2/fachada/worker. Solo preparación, ningún SQL/código nuevo. B1/B2 ya implementados localmente; lo siguiente conserva su contexto histórico.

Preparación posterior B: [diseño detallado](block-b/design.md) y [paths B1/B2](block-b/manifest.json) sustituyen las candidaturas abiertas de B indicadas más abajo. Hoy solo documentación; implementación de B y C sigue pendiente.

Concreción A autorizada31/10/2026: [block-a-local.md](block-a-local.md) convierte la propuesta A en implementación local; los SQL preliminares se conservan solo como fixtures, mientras el candidato local materializa29 definiciones efectivas y elimina tres bloques de reescritura/captura temporal. No es SQL numerado o autorizado remotamente. No cambia el diseño pendiente B/C ni el selector directo.

## Fuentes existentes y compatibilidad

Base coordinador `fb9f201` más S02-I01 local. Fuente S01: checkout público referenciado en [manifiesto](integration-manifest.json), base reportada `ae0c42c`; revisión previa [39 huellas](../s01-review.json). Se revalidaron esas39, las ocho de S02-I01 y los45 SQL comunes. No se certifica índice/HEAD limpio de S01; se integra después un delta de contenido revisado, no su rama completa a ciegas.

`google.ts` mantiene OAuth → pacing → `reserve_gmail_api` → espera → `beforeRequest` → HTTP directo. `worker/gmail.ts` ejecuta `recheck_outbox_delivery` en ese callback y conserva `sendAttempted`/uncertain. S01-I02 añade proyecciones y guardas antes de contenido/storage/despacho; no cambia el transporte. Su helper rechaza RPC ausente. El despliegue parcial de consumidores/SQL sería incompatible.

La nueva comprobación de SQL I01/I02 sobre001–047 pasó en memoria. No transforma los scripts de sandbox en migraciones finales: contienen marcadores, esquema auxiliar y captura/reescritura de definiciones. La migración final debe usar definiciones y privilegios revisados sobre el catálogo acordado, sin depender de tablas temporales de una sesión de ensayo.

## Identidades separadas

| Concepto                 | Fuente de verdad y alcance                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persona y permisos       | `profiles` + sesión/AAL2 + roles/caso/área + `mail_permissions`.                                                                                        |
| Marca vigente e historia | Fundamento S01: `operating_brands`, membresías, revisión de cuenta y evidencia/snapshot de cada operación. Organización OAuth no es marca.              |
| Cuenta estable del CRM   | `mail_accounts.id`; dirección primaria y hilos/documentos/cola existentes. Cambiar proveedor conserva ID.                                               |
| Conexión técnica         | Proyecto Composio + auth config + connected account + usuario Composio + identidad verificada. El usuario Composio no es automáticamente `profiles.id`. |
| Cuota Google             | Proyecto del cliente OAuth real verificado; no deducible del prefijo de una clave o de la marca. Distinto del proyecto Composio.                        |

## Datos propuestos, todavía sin SQL de aplicación

Reutilizar el fundamento S01 sin catálogo paralelo. Completar comandos que actualicen marca/membresía/revisión y auditoría transaccionalmente. Snapshot de marca/actor/revisiones en campaña/preparación/outbox según el propósito; no reescribir historia al reasignar cuenta. Los mensajes de legado pueden conservar procedencia desconocida visible solo según sus permisos previos acreditados.

Nueva relación propuesta `mail_provider_bindings`:

- `id`, `account_id` FK estable; proveedor fijo `composio`; `revision` positiva; creador/revisor/fechas, clave idempotente y resultado auditado.
- `composio_project_id`, `auth_config_id`, `connected_account_id`, `composio_user_id`, `google_quota_project_id` explícitos; ninguno es secreto sustituto de la API key.
- `expected_mailbox_email` contrastado contra la cuenta; `verified_mailbox_email`, fecha y referencia/digest de evidencia producida por servidor. Sin guardar respuesta completa del proveedor.
- `status`: `candidate`, `verified`, `blocked`, `revoked`, `superseded`; motivo fijo y referencia a revisión previa. Una verificación no es una activación.
- Índice por cuenta/revisión y unicidad de conexión `(composio_project_id, connected_account_id)` para asociaciones vigentes; a lo sumo una asociación verificada vigente por cuenta. Versiones superseded conservan evidencia. Conflictos entre cuentas se rechazan, no se reasignan automáticamente.

Selección de transporte separada, **futura**: cuenta/proveedor/binding/revisión/epoch de escritor. Valor inicial Gmail directo. No añadir selección Composio a `gmail` en A/B/C. El `ResolvedComposioBinding.status="active"` de I01 solo podrá construirse en servidor cuando exista un corte operativo posterior: no mapear `verified` a `active`.

RLS en relación nueva; anon sin acceso, humanos sin DML directo, administración vía comandos acotados superadmin/AAL2. Lectura operativa devuelve solo capacidades/estado redacted, nunca API key/IDs completos. RPC privilegiadas con `search_path=''`, nombres calificados, EXECUTE mínimo y autorización de actor; no un RPC genérico para escribir cualquier columna. Definir grants/índices y probar matriz al implementar, no asumirlos por este texto.

## Comandos y límites de API propuestos

Reutilizar `requireUser`/`checkOrigin` y convenciones de errores existentes. Conservar rutas OAuth directas. La callback actual crea credencial, permiso y trabajos: **no reutilizar esos efectos para asociar Composio**.

Superficie propuesta `/api/mail/accounts/[id]/composio` para consultar estado saneado y registrar/revisar un candidato. Mutaciones aceptan `expectedRevision`, `expectedAccountRevision`, `requestKey` y campos candidatos permitidos. Actor/rol, estado verificado, identidad observada, selección y timestamps nunca se aceptan del navegador. Repetir la misma clave/payload devuelve el mismo resultado; payload distinto409; cambios concurrentes409.

La verificación futura usa un servicio servidor con dependencias inyectadas, límites de llamadas y proyecto permitidos. Consulta metadatos de conexión/configuración e identidad primaria de Gmail; compara cuenta, proyecto, toolkit Gmail, propietario, estado y permisos requeridos. No eliminar puntos/alias/`+tag`, no aceptar un alias sendAs como prueba del buzón primario y no relacionar por nombre visible. Canonicalización consistente con el correo almacenado (trim/case), sin fusionar identidades distintas. Cambiar cualquiera de esos campos invalida la evidencia. Cuenta equivocada queda bloqueada, cuenta CRM/directo intactos.

En el incremento offline el verificador solo recibe fixtures. No se crea ruta que invoque una API real automáticamente al guardar; publicación futura mantiene capacidades de asociación/verificación deshabilitadas hasta revisar configuración y autorizar su uso.

## Guarda al preparar y al despachar

S01 define conjunción, no sustitución: perfil activo/AAL2 en comando humano, marca activa/confirmada, membresía o superadmin, remitente, propósito/caso/área y fuentes adjuntas autorizadas. Servicio/worker revalida actor vigente y ámbito; no simula una sesión humana con IDs del cliente. Mantener límites y supresiones existentes.

Toda preparación conserva revisiones de marca/cuenta y posteriormente binding/epoch de escritor. Cambios invalidan pendientes; comparar en claim y en el punto final inmediatamente antes del HTTP. Serializar cambio de proveedor/reasignación con despacho mediante la reserva/lease transaccional acordada; una simple lectura antes de reservar no evita la carrera. Si ya hay intento externo, tratar como incierto y conciliar por Message-ID, sin fallback/reenvío automático.

Lectura histórica de otra marca exige expediente/área/fuente; no da derecho a operar el remitente. Revocar marca o conexión no borra mensajes/documentos ni firma URLs para contenido no autorizado.

## Secuencia técnica y cambios afectados

A tiene manifiesto finito de28 existentes y siete nuevos de código/tests, más cuatro SQL preliminares de referencia; ninguno se copió. Los dos deltas SQL finales se revisan/nombran por coordinador tras cerrar catálogo y ownership;001–047 no se editan. No se reserva048 por documentación.

B completa comandos/S01 y guardas pendientes: candidatas `src/app/api/actions/route.ts`, `src/app/api/campaigns/route.ts`, `src/lib/server/campaign-delivery.ts`, `src/components/integrations.tsx`, `worker/gmail.ts`, `worker/campaigns.ts`, `worker/db.ts` y SQL nuevo. **No es autorización ni manifiesto final**: congelar solo los paths necesarios después de integrar A y revisar sus definiciones. Reutilizar comandos/predicados existentes y evitar dos motores de permisos.

C propone módulos nuevos `src/lib/server/mail-accounts/composio-binding.ts`, `composio-inputs.ts`, ruta administrativa indicada y tests propios de asociación; su manifiesto y delta SQL se fijan con B. Sin editar transportes I01 ni introducir selector. UI mínima dentro de configuración existente cuando se implemente; mostrar «asociación pendiente/verificada, transporte Gmail directo», no «conectado» como si Composio estuviera operativo.

Riesgos abiertos: drift/privilegios reales, procedencia de legado, estado Git de entrega S01, escritores antiguos, identificación del proyecto de cuota y metadatos vigentes de conexiones. Se resuelven en los gates de [tareas](tasks.md) y [transición](rollout.md), no mediante nuevas inferencias o llamadas en esta preparación.
