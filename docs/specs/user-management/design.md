# Diseño — Administración de usuarios

STRICT · spec v1 · 2026-11-16

## Arquitectura y componentes

Actual: `src/components/crm.tsx` contiene navegación y configuración; `src/lib/server/supabase.ts` crea clientes y valida sesión/MFA/perfil. `profiles` contiene rol/estado, `audit_log` registra operaciones y `accept_invitation` mantiene altas por invitación. Cifrado AES-256-GCM existente en `src/lib/server/crypto.ts`.

Propuesta aditiva: `user-management.ts` define contratos Zod; `server/user-management.ts` implementa operaciones; `server/user-management-http.ts` valida peticiones; `/api/users` expone GET/POST. `components/user-management.tsx` aporta la pantalla y diálogo usando tokens existentes. `crm.tsx` agrega navegación superadmin. No modifica worker, proveedores, MFA ni flujo de invitación.

## Flujo y contratos

Cada GET/POST → `requireUser` (getUser + AAL2 + perfil activo) → rol superadmin → validación → operación DB/Auth → respuesta privada sin caché. POST verifica origen antes de leer cuerpo.

- GET `/api/users?q=&page=0`: búsqueda literal, máximo 100 caracteres, páginas de 25; `{items, total, page}`. Filas: id, nombre, correo, rol, estado, `has_private_text`, `private_version`; nunca ciphertext/texto.
- POST `/api/users`: unión discriminada por `action`:
  - `create`: `request_id` UUID, name/email/role/password.
  - `access`: user_id UUID, role, active, expected_role, expected_active; bloqueo optimista.
  - `password`: user_id UUID, password.
  - `private_text`: user_id UUID, text, expected_version entero >=0.
  - `reveal`: user_id UUID; devuelve text/version únicamente tras autorización y auditoría.
- Status: 200 operación/listado; 201 alta; 400/401/403/404/409/413/503 según spec. No errores internos o Auth sin filtrar.

## Modelo y migración

`docs/specs/user-management/migrations/054_user_management.sql`, numeración posterior al paquete documental 053 existente, sin modificar paquetes sellados anteriores. Requiere tablas core/Auth; no depende de los frentes Pipeline OS. Sigue el empaquetado de 048–053: no se añade al catálogo histórico base47 en `supabase/migrations`, que alimenta las pruebas reproducibles de paquetes sellados.

Tabla `user_private_fields`: user_id UUID PK/FK profiles, encrypted_text nullable, version bigint >0, updated_by FK profiles, updated_at timestamptz. PK satisface todas las búsquedas. RLS activado; sin privilegios para PUBLIC/anon/authenticated, sin políticas directas; service_role accede. No columnas nuevas en profiles. Solo metadatos booleanos/versiones salen por listado autorizado.

RPC autenticadas: listado y cambio de acceso, validando `current_app_role() = superadmin` (MFA incluido). RPC de servicio: finalizar creación, lectura/escritura privada y auditoría de contraseña; vuelven a comprobar actor activo/superadmin en DB. `security definer`, `search_path=''`, nombres calificados y EXECUTE revocado a PUBLIC/anon/authenticated salvo RPC de usuario explícitas.

## Integraciones, consistencia e idempotencia

Auth Admin createUser/updateUserById se usa solo en servidor con cliente service_role. Se añade fetch con timeout 15 s sin reintentos automáticos. La clave de servicio nunca sale al cliente.

Creación usa `request_id` como UUID de Auth (soportado por SDK local 2.117.2), y marcador en app_metadata administrable solo por servidor, con actor y datos no secretos. Antes de crear consulta ese ID: solo reanuda una creación propia con iguales datos no secretos. Correo/invitación existente produce conflicto. Tras Auth, RPC inserta perfil y auditoría en transacción; repetir no cambia el perfil ni la contraseña. Si Auth/finalización queda incierto, el mismo formulario conserva la clave para reconciliar. No se borran cuentas como compensación. Un Auth sin perfil no tiene acceso al CRM; al reintentar se finaliza. Contraseñas no se guardan en metadata/recibos/logs.

Ante una respuesta incierta, la UI conserva temporalmente el intento original en memoria y bloquea sus campos; Reintentar reenvía exactamente esos datos. Evita que el usuario cambie la contraseña del formulario y reciba éxito de una creación anterior con otra contraseña. Errores definitivos permiten corregir campos y usar una nueva clave; cerrar el diálogo descarta el intento en memoria.

Cambios de acceso serializados con advisory transaction lock, control de rol/estado esperados y bloqueo de cambio propio; auditoría atómica. Texto privado: bloqueo del perfil, versión monotónica y transacción auditada; cifrar JSON con user_id y texto vincula el ciphertext a su persona. Se reutiliza `INTEGRATION_ENCRYPTION_KEY` existente. Un valor vacío guarda NULL e incrementa versión. Contraseña: evento solicitado antes de Auth y evento completado después; ante fallo de auditoría posterior se indica resultado incierto sin revelar detalles; no se prometen revocaciones de sesiones que Auth no garantice.

## Seguridad y privacidad

Denegar antes de construir cliente de servicio. Lectura de texto privada por POST, verificación de origen y guard DB independiente. Sin secretos en listados, workspace, errores, audit_log, command_receipts, localStorage o URLs. Texto recuperado solo en memoria del diálogo; ocultar descarta el valor, cerrar/desmontar/cambiar usuario o visibilidad también. Copiar solicita lectura autorizada cuando está oculto, sin mostrarlo. Nueva contraseña con confirmación en UI, siempre campo password. El texto no es una copia automática de la contraseña de acceso.

## Calidad, compatibilidad y alternativas

Se mantienen componentes UI y español/inglés. Página de 25 filas, búsqueda en DB. Demo muestra perfiles ficticios sin mutaciones reales. Formularios protegidos contra pérdida de cambios; mensajes live y botones etiquetados. Costo: solo Auth/DB existentes, sin correos ni proveedores pagos. Métricas: audit_log con actor/target/acción y estados, sin contenido. No nueva librería ni contrato roto; serviceClient acepta fetch opcional de forma aditiva.

Alternativas: añadir campo a profiles (descartado por lectura compartida), usar tabla privada (elegida, ADR-001); crear mediante invitación (descartado por 2A). Borrado y reset de MFA: no aplica, fuera de alcance.

## Riesgos y pruebas

Dos sistemas Auth/DB no comparten transacción: reconciliación por ID estable, perfil insertado idempotentemente, sin rollback destructivo. Auth real/configuración remota no se comprueban sin autorización. Clave de cifrado perdida requiere recuperación desde backup de clave. Portapapeles requiere HTTPS/permisos y muestra error si falla.

Pruebas: contratos/roles/origen/tamaño, operaciones con puertos ficticios incluidos fallos y reintentos, DB PGlite desde core con dos admins/resto de roles/AAL1/anon/servicio, reversa local, render/UI y responsive. Ver `verification.md`.

## Rollout y rollback

Ver `rollout.md`. Solo se preparan fuentes/SQL; no se aplican en remoto. Cambios existentes del usuario se conservan.

## Desviaciones

2026-11-16 — La regresión de catálogo/instaladores históricos carga todos los archivos de `supabase/migrations` y exige la base47 exacta. Añadir 054 allí invalida sus contratos de origen. Se prepara 054 en este paquete, igual que 048–053, y se aplica explícitamente en tests de Usuarios y en su futuro rollout. No se alteran ni relajan pruebas/paquetes sellados. La copia de build aislada incluye `worker/mime`, dependencia estática existente de Gmail, sin arrancar worker. Los diálogos usan la protección de sus formularios propios y deshabilitan el snapshot nativo del modal para que revelar/cambiar de pestaña no produzca avisos falsos de cambios.

2026-11-16 — Smoke del build observó que la regla global de `next.config.ts` reemplaza el `Cache-Control` del Route Handler por `no-store`. Se añade una regla específica posterior para `/api/users` que conserva `private, no-store`, sin modificar CSP ni reglas de otras rutas.
