# I02 — reservas SQL y compatibilidad (STRICT)

10/11/2026. Implementación local autorizada; I03–I05 y producción siguen pendientes.
Se aplican spec-driven-development y supabase-engineer. La aclaración adicional autoriza
solo los binarios PG15.19 de F2, con un clúster propio, loopback y datos ficticios.

## Contrato y alcance

- QGR-FR02/03/06/07, partes SQL de AC03/04/06/07/12/13/14/15.
- `mail_quota` privado: versiones inmutables, head único, recibos de publicación y
  reserva, uso por minuto, slot agregado y marcas de consumo legado observado.
- `mail_quota_publish(jsonb,bigint,boolean,uuid)`: solo superadmin activo con MFA y
  sesión Auth vigente; CAS de generación, idempotencia ligada a actor/payload y
  comprobación de pausa declarada/sin trabajo en vuelo al habilitar o cambiar enabled.
  No depende de conocer un proyecto Google ni habilita el proveedor Composio.
- `mail_quota_reserve(uuid,text,integer,uuid,bigint,uuid,timestamptz,text)`:
  solo servicio; política enabled y generación vigente, cuenta connected, deadline
  máximo 10 minutos. El recibo identifica un único intento; no es permiso de envío.
- El grupo es siempre `gmail:crm:shared`; cuenta y proyecto directo conservan
  pacing previo. La espera es el máximo de slots aplicables. No se borra consumo.
- Lock común advisory → tablas legadas slots/usage → head/cuenta/recibo. Las
  reservas v2 se serializan; locks de tablas acotan la captura frente al RPC039.
  Se incorpora únicamente el delta positivo por proyecto/minuto. Una regresión
  de un contador reciente bloquea; cambios de generación/credencial no resetean nada.
  La transición exige pausar admisiones externas; el SQL no puede detener HTTP en vuelo.
- Expand bindings: versión 1 por defecto, campos nuevos nulos; v1 sigue exigiendo
  Google. v2 referencia política histórica y no necesita Google. Mientras falte I03,
  una constraint impide `verified` en v2. Referencias/versiones son inmutables.
  No se modifica C1/C2/Connect/039/049/050 ni se registra un candidato desde producto.

## Seguridad y reversa

RLS sin políticas y sin DML directo incluso para service_role; helpers privados,
RPC SECURITY DEFINER/search_path vacío, ACL explícita. El esquema inicia sin head:
reserva cerrada por defecto. Sesión/actor y generación se revalidan después de locks
y antes de replay. La integración futura debe revalidar también después de esperar
y antes del proveedor: devolver wait_ms no equivale a haber esperado ni enviado.

SQL candidato sin ordinal, exige marcador local, PG15 y conexión loopback a DB
`qgr_i02_*`. El rollback normal cierra definitivamente el head y conserva evidencia.
`remove_empty` elimina solo el delta si no hay historia, reservas ni bindings v2;
con datos falla antes de borrar. Nunca reinicia contadores para aparentar reversión.

## Verificación prevista

Fixture nativo con 47 migraciones históricas y DDL aceptado de 049/050, sin ejecutar
sus protocolos remotos. Pruebas de ACL/roles/sesiones, paridad I01/SQL, CAS/replay,
captura histórica, cuenta/proyecto/grupo, límites y deadlines; carreras con dos
conexiones y bloqueo observado, fallo transaccional y ambas reversas. No se arrancan
web, worker, Auth HTTP o PostgREST. Los binarios de F2 no se copian; no se abren sus
datos, env ni contadores. Conservación de fuentes públicas mediante huellas.
