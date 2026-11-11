# I01 — contrato concreto, sin integración

10/11/2026 · STRICT. El usuario autoriza implementar y probar offline únicamente los dos archivos de I01 y registrar su evidencia. Se conservan las respuestas previas; no hay nuevas decisiones de negocio ni aprobación para I02 o ejecución real.

## Contrato concretado antes de escribir código

- `mailQuotaPolicySchema`: objeto estricto, `contract_version:2`, `policy_id` UUID, `generation` entero seguro positivo, `mode:crm_shared_conservative`, `state:disabled|enabled` explícito y `limits` obligatorio. No coerción ni defaults.
- `limits`: `group_units_per_minute` hasta900000, `account_units_per_minute` hasta4500 y no mayor al agregado, `group_units_per_window` hasta75000000; todos enteros positivos. `window_seconds` exactamente86460 conserva la ventana24h+1min propuesta. Los límites inferiores válidos son posibles; este incremento no puede elevar los techos.
- `google_project` opcional/null. Si se aporta objeto: `provenance:unknown` exige `project_id:null`; `provenance:oauth_client_reviewed` exige identificador no vacío. El parser solo valida una declaración del servidor: no acredita revisión real ni saldo.
- `mailQuotaScopeRequestSchema`: unión estricta por proveedor. Directo requiere `account_id` UUID; Composio requiere además `auth_config_id` válido. No recibe límites, owner, credenciales, verificación ni scope impuestos por navegador. La validación no autoriza la cuenta; el caller futuro deberá hacerlo.
- UUIDs se normalizan a minúsculas para que representaciones equivalentes no fragmenten el grupo por cuenta. Otros IDs permanecen exactos.
- `resolveMailQuotaScopes(policy, request)`: acepta `unknown`, valida, rechaza política deshabilitada y devuelve snapshot readonly/congelado de versión/policy_id/generation, grupo literal `gmail:crm:shared`, cuenta `gmail:account:<uuid>` y límites. El grupo no depende de policy_id, generación, proveedor, cuenta, Auth Config o metadato Google. Una política nueva no reinicia por sí sola un bucket.
- Errores cerrados: `MAIL_QUOTA_POLICY_INVALID`, `MAIL_QUOTA_POLICY_DISABLED`, `MAIL_QUOTA_SCOPE_INVALID`. Mensajes estáticos sin detalles Zod/entradas ni secretos.

El módulo solo importa Zod. No consulta reloj, env, archivos, contadores, red, DB o worker. No reserva capacidad, acredita identidad/permisos, aplica pacing ni habilita un transporte. No importa contratos v1 ni los adapta con datos ficticios.

## Verificación prevista

Tests sintéticos con fetch bloqueado antes de importar el módulo: aceptación sin Google, procedencia consistente, versiones/campos extra cerrados, techos/ventana/casos numéricos, grupo común entre cuentas/proveedores/Auth Configs, UUID canónico, estabilidad entre revisiones y políticas, estado disabled, snapshots inmutables y errores saneados. TypeScript sin emisión/incremental y formato instalado; sin Next typegen/build ni instalaciones.

Comparar960 tracked y15 untracked previos contra el manifiesto de preparación,20 fuentes específicas y HEAD. Excluir únicamente estos documentos QGR y los dos archivos nuevos declarados al comparar WIP ajeno. Verificar ausencia de imports del módulo desde producto. Esta evidencia no completa los AC que exigen SQL/HTTP/carreras o proveedor real.
