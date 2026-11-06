# Diseño C — persistencia, evidencia y revisión

31/10/2026 · C1 implementado y probado offline según [c1-local](c1-local.md); C2 implementado/probado offline según [concreción](c2-local.md) y [QA](c2-verification.md); C3 compuesto y probado offline según [evidencia](c3-verification.md), sin cambios a este diseño/producto. QA visual/build/contención y promoción pendientes. Concreta [ADR002](../adr-002-asociacion-sin-activacion.md) y [ADR004](adr-004-evidencia-sin-selector.md); no reemplaza permisos ni transporte de B/I01.

## Integración con la aplicación existente

- Stack: Next16.3.8, React19.3, TypeScript7, Zod4, Supabase y PGlite; pnpm existente. Sin dependencias nuevas. Route Handler App Router y params asíncronos según guía instalada de Next.
- `src/components/integrations.tsx` ya muestra GmailHistory y BrandSettings. Añadir una sección C autocontenida, sin cambiar los formularios OAuth ni el dominio Workspace.
- Nueva ruta propuesta `/api/mail/accounts/[id]/composio`, con requireUser/MFA, checkOrigin en POST, readBounded y errors/DTO propios. No añadir kinds C a `/api/actions` o envolver de nuevo crm_command: reduce cruces con A/B y conserva sus hashes.
- `brand_sender_capabilities` es para envío, no permiso de administración C. Usar superadmin/AAL2 y contexto de cuenta/marca revisada; ninguna asociación concede can_send o membresía.
- `src/lib/server/google.ts` y los siete archivos I01 protegidos quedan intactos. No importar el verificador C desde la fachada/worker, ni retornar su tipo activo. Reutilizar patrones de B, no duplicar su motor de autorización.

## Modelo aditivo propuesto

Tres relaciones pequeñas, sin otra cola. Nombres finales fijados en C1; candidato SQL exclusivamente en `block-c/migrations/c-composio-bindings.local.sql`, protegido por `pipeline_os.block_c_local='in_memory_test'`, sobre001–047+A+B1+B2. Ese candidato ya se implementó/probó exclusivamente en C1 local; no se reserva048 ni se editan A/B.

| Relación                       | Datos y reglas                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail_provider_binding_heads`  | account_id PK/FK RESTRICT, revisión técnica bigint segura >=0, current_binding_id nullable y metadatos de auditoría. CAS monotónico incluso tras revocar/reemplazar; FK compuesta verifica que el binding pertenece a esa misma cuenta. No modifica mail_accounts.brand_revision.                                                                                                                                                                                         |
| `mail_provider_bindings`       | id UUID, account_id FK, provider fijo composio, revisión/versionado ligado a cabecera; tuple inmutable de proyecto Composio/auth config/connected account/usuario/proyecto Google declarado; expected_mailbox_email derivado del CRM; contexto esperado de identidad/marca/revisión; status candidate/verified/blocked/revoked/superseded; motivos cerrados, created/reviewed_by y timestamptz. Nuevos identificadores requieren nueva fila, no editar la tuple aprobada. |
| `mail_provider_binding_checks` | id, binding/account/revisiones, actor y su revisión, contexto de cuenta/marca/configuración, token_hash de uso único, inicio/deadline hasta10min, estado prepared/completed/failed/expired, hechos normalizados mínimos y digest SHA256, razón cerrada y fecha. Un check en curso por candidato. Guardar evidencia al terminar es atómico y de un solo uso. No respuestas completas/tokens/claves.                                                                        |

Constraints/índices: revisiones1…MAX_SAFE_INTEGER cuando positivas; provider/status/motivos cerrados; FKs RESTRICT y límites de tamaño/longitud/tiempo; `unique(account_id,id)` para FK compuesta; una asociación corriente por cuenta mediante cabecera y restricción parcial de estados corrientes; `(composio_project_id,connected_account_id)` único entre candidate/verified/blocked corrientes. Cuenta ajena con la misma conexión recibe conflicto genérico, sin ID/correo de la otra cuenta. `revoked` y `superseded` conservan evidencia; no se borran para liberar silenciosamente una identidad.

Índices por account_id/revisión/id y checks por binding/deadline/estado, usados por historial, CAS y exclusividad. No índices de búsqueda global de IDs privados. No backfill de relaciones reales o historia. Estado verificado muestra cuándo se comprobó; no significa salud actual continua ni aptitud para el futuro corte.

### Transiciones

| Acción                           | Precondición y efecto                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registrar primer candidato       | Head esperado0; cuenta existente/identidad y marca revisadas; tuple estricta. Crear head/fila/recibo/auditoría en una transacción.                                                                                                       |
| Reemplazar/reconectar localmente | CAS actual; nueva fila con tuple completa. La asociación corriente anterior pasa superseded; si ya era revoked, conserva ese estado terminal. Check anterior queda inutilizable y se incrementa head. No llamar revoke/link de Composio. |
| Terminar check satisfactorio     | Nonce/revisión/actor/configuración/contexto coinciden, no vencido/usado. Guardar evidencia; **no aprobar aún** ni seleccionar proveedor.                                                                                                 |
| Terminar check fallido           | Conservar hechos mínimos/razón; candidato blocked y revisión técnica nueva. No sustituir el estado de otro candidato si el resultado llegó tarde.                                                                                        |
| Confirmar asociación             | Superadmin/AAL2 explícito y revisión actual; evidencia satisfactoria de la misma tuple/contexto, revisión humana y audit atómicos. Status verified; nada se activa.                                                                      |
| Revocar binding                  | Acción CRM con CAS y motivo cerrado. Conservar fila/checks, invalidar aprobación efectiva; no revocar OAuth, pausar directo o borrar contenido.                                                                                          |

La cabecera cambia en toda mutación de binding; la preparación de check no muta datos comerciales ni renueva evidencia. Guardar evidencia, aprobar o reemplazar exige revalidar bajo locks; si no coincide el snapshot,409 y ninguna aprobación parcial. Evitar liberar una conexión ocupada antes de comprobar/crear su reemplazo en la misma transacción.

## Seguridad, concurrencia e idempotencia

RLS habilitada, sin políticas/grants de acceso directo a las tres tablas para anon/authenticated/service_role. Operaciones solo por RPC específicas. SECURITY DEFINER con owner contrastado, `search_path=''`, nombres calificados y EXECUTE mínimo. Comandos humanos derivan actor/rol/AAL2 de sesión y vuelven a comprobarlos antes del recibo. Helpers privados sin EXECUTE público; contexto de configuración, snapshot privado y finalizar check son de servicio; snapshot/finish exigen nonce válido/contexto sellado, no actor/verified libres desde cliente.

Reutilizar command_receipts con kinds C exclusivos, fingerprint canónico y clave por actor; autorización antes de replay. Mismo actor/clave/payload devuelve resultado saneado, distinto payload409; auditoría una vez, sin tuple/correo/respuesta. No reutilizar primitivas B de marca para atribuir permisos de envío.

Orden compatible con B: marcas involucradas ordenadas UUID → cuenta CRM → perfil/membresía si corresponde → head → binding → check/recibo. Unicidad entre cuentas impuesta además por constraint; conflicto revierte todo. Revisar orden de advisory locks/recibos frente a B al implementar. Revalidar cuenta/email/status/brand_revision y revisión/rol activo del actor bajo locks antes del resultado o confirmación. PostgreSQL multiconexión sigue siendo gate; PGlite solo demuestra transacciones/CAS/barreras lógicas.

Cambios externos de marca/email/activo no generan llamadas ni jobs C. El contexto efectivo se compara al consultar/confirmar: un verified guardado se presenta obsoleto si ya no coincide. Un futuro corte exige nueva evidencia actual y su autorización; no consume un verified antiguo como permiso. Registrar C no cambia revisiones/snapshots B2 de correo directo.

## HTTP y DTO

GET autenticado SA de una cuenta: `{account:{id,email,brand_name,brand_revision},head_revision,transport:'gmail_oauth',composio_enabled:false,current,history,cursor}`. Cuenta propia de administración, no lookup global por conexión. `current/history` solo UUID interno, estado/razón/revisión/fechas, actor permitido, referencias enmascaradas y estado de evidencia; no IDs externos completos, cuerpos ni hashes de secretos. Cursor compuesto revisión+UUID, tamaño25 por defecto/máximo100.

POST mantiene envelope `{kind,payload,idempotency_key}`; kinds propuestos `register_candidate`, `confirm_binding`, `revoke_binding`. Body máximo16KiB y objetos estrictos. La cuenta viene del path, expected_head_revision del payload. Registro admite solo los cinco IDs técnicos declarados y revisiones esperadas de la cuenta; correo esperado/actor/status/evidencia se derivan. Confirmación usa binding_id/check_id/revisiones, nunca booleanos verified o campos observados; revocar usa binding_id/revisión/motivo cerrado.

En C1, confirmar sin evidencia devuelve un error cerrado; no fabricar una comprobación para que funcione el botón. C2 implementa la validación de evidencia **solo con dependencias falsas**, sin endpoint HTTP de ejecución del proveedor. La ruta administrativa no recibe claves ni acepta URL/host/endpoint del cliente. Errores C cerrados ES/EN y no-store; faltar SQL503, jamás ejecutar consultas amplias de servicio como fallback. Sesión sin MFA/activo/rol403, cuenta no visible404 sin enumeración.

## Verificador C2, exclusivamente offline

Servicio nuevo con dependencias de metadatos de conexión/auth config y perfil primario. Sin import del SDK, sin lector de env/key, sin global fetch. La aplicación no construye dependencias de red; todos los tests suministran funciones falsas. El comprobador no exporta `ResolvedComposioBinding` ni un constructor de transporte. Nonce solo en memoria servidor, hash en DB, nunca URL/browser/log. Finish de servicio revalida contexto/nonce y guarda evidencia mínima, no un JSON cliente arbitrario.

Contrato normalizado interno: conexión `{id,auth_config_id,user_id,toolkit,status,disabled}`, config `{id,toolkit,enabled,declared_scopes}`, identidad `{primary_email}`, contexto confiable de proyecto/configuración `{composio_project_id,credential_version,google_quota_project_id,provenance_reference}`. Son DTO internos, **no una afirmación de que esos campos existan juntos en una respuesta externa**. Evidencia guarda los hechos comprobados y su digest ligados a la tuple y contexto, sin full response. API key o hash de ella nunca forman parte del DTO.

Comparar trim/case de email de forma coherente; no eliminar puntos, plus-tags o aliases, no usar displayName/sendAs como prueba primaria. Estado ACTIVE, toolkit gmail, configuración y owner exactos; permisos de lectura/envío requeridos por el propósito del conector futuro. Declaración de scopes en config no prueba por sí sola grants efectivos: sin evidencia suficiente, comprobación incompleta/bloqueada. Proyecto Composio debe provenir de contexto servidor confiable y demostrar correspondencia de clave/proyecto; no de un campo repetido del candidato. Proyecto Google requiere procedencia explícita del cliente OAuth real; si no se puede demostrar, no marcar verified ni inferir del proyecto directo/Composio/prefijo.

### Contrato externo referenciado, sin uso actual

Fuentes locales leídas: `scripts/pipeline-os/s00-composio-common.ts`, observer/correction y `tests/fixtures/pipeline-os-composio.ts`. Contienen contrato previo de metadata auth_configs/connected_accounts y proxy de perfil Gmail. Se reutilizan patrones/parsers justificados, **sin importar el ejecutor S00**, su contador, credenciales o lógica que acepta displayName como indicio secundario.

| Paso externo eventual            | Contrato local de referencia                                                                           | Regla de C                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Metadata auth config             | GET de auth_configs/{id}, toolkit y scopes declarados.                                                 | Normalizar sin persistir credentials o respuesta completa.                                                        |
| Metadata conexión                | GET de connected_accounts/{id}, auth_config.id, toolkit.slug, user_id/status.                          | Cruzar todos los IDs/contexto exactos, sin listar todo el proyecto.                                               |
| Identidad primaria               | Proxy con destino fijo Gmail profile y método semántico GET; transporte HTTP del proxy puede ser POST. | Allowlist de host/path, solo perfil, nunca mensajes/firma/envío; emailAddress es prueba primaria, no displayName. |
| Proyecto Google / clave-proyecto | No demostrado por esos tres DTO por sí solos.                                                          | Exigir evidencia servidor/configuración revisada aparte o bloquear; no inventar una extracción.                   |

No se consultó documentación web ni proveedor en este turno. El contrato público vigente y la procedencia de cuota se contrastarán antes de cualquier prueba real; hasta entonces solo fixtures normalizados, no simulación presentada como validación real.

C2: timeout lógico10s por dependencia y30s total, hasta tres lecturas semánticas por intento, **cero retries automáticos**. Presupuesto real0. 429/5xx/timeout/incompleto → evidencia no aprobable; corregir/reintentar será una intención explícita. Ningún endpoint send/link/revoke/watch, descarga de documentos, lectura de mensajes o consulta de planes. Límite de tamaño por respuesta normalizada256KiB, strings acotados y sin logs del payload. Estos son límites locales propuestos, no cupos del proveedor. Proyecto/cuota no comprobados bloquean antes de la futura ejecución; su protocolo real fijará presupuesto propio.

## UI y módulos

Sección «Asociación Composio» en Configuración junto a cuentas/marcas. Elegir cuenta, mostrar marca y transporte directo; registrar tuple completa como entradas privadas, sin autocompletar desde S00 o primera conexión. Referencias enmascaradas tras guardar. Explicar diferencias de Auth Config, Connected Account y User ID en ayuda de cada campo. Mostrar pendiente/verificado como asociación, no «correo conectado por Composio».

Usar panel/Field/ProtectedForm/t existentes, ES/EN, labels y foco, estados carga/vacío/error/503/409/solo lectura y aviso de cambios sin guardar. Revisión/revocación requieren resumen visible de la cuenta, nueva preparación tras409 y bloqueo del botón mientras se procesa. No CTA de envío, conexión Google, verificación real o activación. Layout360/768/1280 a verificar al implementar; SSR y bundle local pasan en C1; no hay capturas ni QA visual/teclado acreditada.

## Rendimiento, compatibilidad y pruebas

Acceso por cuenta e índices; no escaneo del catálogo Composio ni polling externo. Mutaciones pequeñas transaccionales, sin mantener locks durante proveedor. La evidencia puede expirar/volverse obsoleta durante el intervalo; finish la rechaza. C2 no inicia trabajador o tareas de fondo.

SQL aislado desde001–047+A+B1+B2 y rollback; comparar definiciones/grants de A/B/046/047 antes/después. Fixtures dos cuentas/dos marcas/cinco roles, proyecto/config/owner cruzados, primario distinto, scopes insuficientes, proyecto no demostrable, duplicados/CAS/replay y respuesta tardía. Composición prueba que registro/confirmación/revocación no cambian Gmail directo, permisos, firmas, HTTP o cola. No repetir envío/respuesta/PDF ni importación/Bouncer.

Riesgos: drift del esquema real, cuota/proyecto no demostrables, metadatos con secretos, alias confundidos con primario, evidencia tardía, constraints concurrentes y escritores antiguos. Gates y recuperación en [rollout](rollout.md); no prometen resolución remota hoy.

## Concreciones C2 implementadas

Cuatro RPC acotados: check_context solo servicio publica hash/generación; check_begin humano SA/AAL2 prepara nonce sellado y recibo; check_snapshot solo servicio devuelve ticket privado; check_finish solo servicio valida/consume el nonce y calcula digest. Sin endpoint HTTP nuevo o caller desde UI/worker/factory. Helpers servidor exigen clientes/dependencias/contexto explícitos y vuelven a publicar configuración antes de terminar/confirmar. Cualquier futura rotación debe invalidar esa generación primero; fuente productiva de contexto aún no existe.

Cabecera incorpora verification_context_hash/verification_generation. Check incorpora esos campos, account_row_version opaca (xmin durante TTL) y confirmed_at. Usa mail_authorization_revision B2 para actor. UI/DTO C1 intactos: flags verification_available/can_confirm false. Estado verified conservado se muestra stale si vence evidencia o cambia contexto/generación/actor/cuenta. Un replay idéntico devuelve el recibo histórico, no renueva ni revalida la aprobación efectiva.

Scopes conservadores de los DTO internos: gmail.readonly y gmail.send explícitos, tanto declarados como efectivos y ligados a conexión/config/usuario. No se implementan equivalencias de scopes sin contrato externo vigente. Ninguna procedencia ficticia se presenta como comprobación real. El timeout además comprueba tiempo transcurrido al resolver cada dependencia para cerrar respuestas que retrasan la cola de timers.
