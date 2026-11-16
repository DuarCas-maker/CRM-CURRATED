# Publicación autorizada — CRM producción

Petición del usuario16/11/2026: «implementa la conciliación del intento vencido para recuperar la conexión existente sin repetir la autorización en Google. y publica los cambios en produccion». Abarca el parche previo de compatibilidad y el incremento de conciliación. No requiere volver a solicitar esa misma autorización.

Destino: https://crm.finlabinc.com, SQL existente https://supabase.finlabinc.com/pg/query (PostgreSQL15.8); Coolify web `rv8rpfxhf0mbxprge6h6ki9c`, worker `vc4aybj4ucje7zstpsp3zboh`, rama remota main. Base integrada57b98f3. No se edita el WIP del coordinador ni se cambian flags, secretos o modo del worker. Push a main activa ambos builds existentes.

## Orden

1. Sellar fuentes/SQL y revisar diff. Verificar pruebas106, tipos y build Webpack; ensayo nativo PG15.19 con instalación/reversa vacía, uso y negativa a borrar evidencia usada. El modo Turbopack se verifica además en el build Linux de Coolify con dependencias locales al contenedor.
2. Preflight READ ONLY: proyecto/rol/versiones, ausencia del nuevo schema y RPC, hashes de helpers existentes, estado de política y presencia del origen. No probar operaciones humanas mediante JWT fabricados.
3. Crear dump custom en directorio privado700 del volumen PostgreSQL, archivo600; `pg_restore --list` y decodificación completa a /dev/null, hash/tamaño. El respaldo no sale del servidor. No se afirma restauración integral ni protección ante pérdida del VPS.
4. Aplicar una sola vez recovery.delta.sql con hash sellado, timeout/bloqueo acotados y guard de helpers/target en la misma transacción. SQL aditivo: un schema/tabla privada y cuatro funciones; ningún cambio a RPC, tablas o RLS existentes salvo uso posterior explícito de la conciliación. Postflight READ ONLY de ACL/RLS/search_path y caché PostgREST.
5. Registrar commit con lista de archivos del incremento y parche previo; comprobar remote main inmediatamente antes del push. Si avanzó, integrar solo en checkout aislado y volver a verificar. No forzar push ni sobrescribir WIP compartido.
6. Observar deployments web/worker Finished y healthy con commit exacto. Health público200; nueva ruta sin sesión403, sin origen POST403, parámetros inválidos cerrados. Verificar GET con sesión real superadmin/MFA.
7. Desde la sesión real, consultar intentos recuperables y conciliar el origen seleccionado. Presupuesto nuevo por conciliación: dos GET Composio metadata y un proxy GET del perfil Gmail, 0 retries/createLink/mensajes. La lectura previa del Auth Config consumió un GET de metadatos separado, sin perfil. No activar transporte ni confirmar revisiones humanas adicionales por éxito de OAuth.

## Criterio de éxito y reversa

Código Linux saludable, RPC con ACL/RLS esperadas, conexión reutilizada e identidad correcta, fuente marcada expired conservando fechas/conexión/fases, nueva continuación awaiting_brand o ready_to_register, sin transporte activado. La confirmación/registro de marca/candidato mantiene sus controles humanos existentes.

Fallo antes de usar: rollback SQL vacío ensayado, solo si ledger vacío y sin llamadas en vuelo; retirar código del release concreto. Fallo después de usar: preservar schema/ledger/cuentas, retirar la UI mediante rollback del código a la imagen/commit observado57b98f3 y no ejecutar reversa destructiva. No restaurar un dump completo sobre actividad posterior. Cualquier resultado de proveedor incierto permanece en ledger sin reintentos; revisar evidencia antes de otra operación.

Límites: el ensayo nativo genera una copia derivada del harness público sellado, conservando el original; su bootstrap histórico usa001–047 y añade los contratos existentes de Connect/v2 más este delta. No acredita todo el stack Auth productivo; eso se verifica con la sesión real y el postflight. No hay Docker local disponible; el build de contenedor ocurre en Coolify.
