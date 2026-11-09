# HTTP/UI — diseño y decisión de correlación

## HTTP-ADR01

Componer requireUser/MFA con getClaims verificado del SDK, sub/session_id/aal/exp y revisión actual del perfil. Clientes humano y servicio separados del store T-009; ninguna aprobación por service_role. Factory HTTP con puertos inyectables para probar sin red. Producción lee variables solo al usar feature habilitada, nunca archivos env.

Tres variables nuevas: COMPOSIO_CONNECT_ENABLED=false, COMPOSIO_CONNECT_SETTINGS (descriptor T-004 y lista permitida de organizaciones) y COMPOSIO_CONNECT_KEYRING (claves base64url AES32 bytes con ID activo). Reutilizar APP_ORIGIN/COMPOSIO_API_KEY. Origen HTTPS del descriptor igual a APP_ORIGIN; descriptor completo y credencial se comparan de nuevo antes del wire. Owner se deriva del intento durable, no del formulario. No publicar configuración en cada request: la publicación de descriptor DB es preparación explícita posterior.

State usa UUID del intento + underscore + nonce aleatorio; el formato sigue el contrato T-003/T-004. Permite resolver una cookie por intento sin consultar por state ni revelar un correo/brand. Cookie __Host-crm-connect-ID contiene proof, deadline y metadata de revisión/recibo; Secure/HttpOnly/path=/, sin Domain, SameSite=Lax para retorno top-level de Google. Nunca extender el deadline al consultar o retomar.

Para recuperar un ACK de inicio perdido sin crear otro intento, UUID/proof/state/clave callback se derivan determinísticamente de una subclave HKDF del keyring servidor, sesión/actor originales e idempotency_key aleatoria del formulario, con dominios HMAC separados. State/proof conservan entropía criptográfica y no se revelan en JSON. La rotación de clave/contexto no reconstruye una autorización antigua: provoca conflicto/revisión, nunca una nueva creación silenciosa.

POST inicio crea intento sin emitir. POST start crea un enlace una sola vez mediante fase/recibo. POST resume comprueba sesión vigente y303 hacia URL allowlist cifrada; guarda revisión y clave callback originales antes de salir. GET callback acepta solo state/status/connected_account_id, usa cookie/sesión original y revisión congelada para replay, realiza la comprobación de identidad y vuelve a la app mediante303 sin datos privados. GET de estado no emite proveedor.

El store recibe una extensión administrativa mínima inspectIntent que devuelve snapshot/review_id ya autorizados a través del mismo view/load: declarar before/after contra T-009, sin cambiar su SQL ni escribir en F2. La cookie puede conservar metadata opaca pendiente (review_id/revisión/context hash) para adoptar después de confirmar B1 o recargar; nunca es autorización. Si cambió contexto, la UI lo indica como revisión pendiente y la adopción vuelve a pasar los guards humanos/DB. No inferir una aprobación de la cookie.

UI: consultas solo explícitas, no polling ni proveedor al montar. Marca/organización de opciones permitidas y contexto por cuenta; toda respuesta tardía de otra selección se descarta. Un CTA principal por estado, formularios protegidos, enlace nunca en JSON ni DOM. Asociar marca es un acto B1 separado; el panel ofrece adoptar su revisión ya confirmada, no confirmarla automáticamente. Cuenta/candidato no se etiqueta como transporte activo.

El retorno usa un UUID de intento validado en query para abrir Configuración/General únicamente al superadmin activo; ese cambio de vista no consulta proveedor ni autoriza nada. El panel recupera el intento solo con consulta explícita y cookie/sesión original.

El DTO administrativo incluye únicamente el Gmail esperado ligado al snapshot, para mostrar al operador qué cuenta debe elegir incluso antes de materializarla en Workspace. No se deduce de la lista de otras cuentas ni del displayName del proveedor.

## Fuentes y límites

- [Retorno estándar y correlación](https://docs.composio.dev/docs/authentication/manually-authenticating): status/connected_account_id preservando query propia; cotejo de conexión y usuario, perfil para identidad.
- [Verificador global alternativo](https://docs.composio.dev/reference/v3/api-reference/connected-accounts): session_uri es otro contrato; no se añade silenciosamente.

Las fuentes públicas no acreditan el ajuste real del proyecto. Tests con RPC/HTTP/cookies/Auth/keys ficticios. El SQL final, catálogo/preflight/postflight, PG15 físico de composición, publicación y piloto propio son posteriores. No repetir048/049. Reversa: apagar flag, pausar/drenar acciones antes de cambiar SQL/binarios; no borrar incertidumbres ni reenviar automáticamente. En este turno no hay efecto remoto a revertir.
