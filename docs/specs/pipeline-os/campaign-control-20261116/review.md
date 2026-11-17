# Revisión del candidato

Modo: revisión del propio diff contra FR01–07/AC01–07. Producto: endpoint/control server y cliente, modelo, panel/lista/detalle/CSS, composer y conexión al workspace; SQL up/down, fixtures y ensayos. Base a881100. Sin cambios de worker, manifests/lock, entorno, credenciales o infraestructura.

Hallazgos confirmados y corregidos antes de entregar:

1. La consulta de presupuesto de un remitente sin permiso hacía fallar la lectura completa del propietario. Ahora consulta solo brand_b2.can_sender, oculta correo/uso y mantiene motivos operativos calculados para el creador. READ ONLY y seller sin permiso, probados.
2. El primer borrador del access por rol ampliaba visibilidad de seller_admin fuera de marca. Se conservó brand_b2.can_campaign en RPC y RLS. Un admin de ventas sin membresía no recibe grupos ni filas de tabla.
3. Reasignar a una cuenta con enrollment histórico chocaba con unicidad/clave congelada. Rechazo explícito CC_TARGET_HISTORY antes de cambiar historia, con rollback completo probado. No reactivar claves antiguas como solución.
4. Backfill inicial no representaba futuras campañas del CRM clásico. Triggers aditivos corrigen alta y actualización de metadatos sin alterar límites globales del grupo controlado; prueba del RPC clásico pasa.
5. Confirmación del composer nombraba solo la cuenta principal. Ahora indica cantidad total, número de remitentes y máximo global; editar campos vuelve a exigir revisión. Observado en UI final23/2/25.

Correctitud/concurrencia: distribución ordenada disjunta; operaciones en una transacción; recibos de replay; guardas de admisión/cupo/horario originales; bloqueo del grupo antes del cómputo global, vuelta a queued solo de reserva no admitida, sin consumir intento. Reasignación bloquea cuentas antes de grupo y filas de contactos/enrollments/outbox; claims no esperan filas ajenas con el grupo tomado (SKIP LOCKED). Ensayo concurrente PostgreSQL nativo pasa.

Seguridad/datos: cliente por sesión, origen exacto, MFA del requireUser existente y rol SQL; JSON acotado, selección/alcance revalidados; security definer con search_path vacío, RLS y ACL explícitas contra defaults service_role. Helpers sin acceso directo de clientes. Nombres y texto se renderizan como texto React; preview reutiliza render seguro con datos de ejemplo y enlaces sin navegación. No se cambió identidad/snapshot congelado de un outbox.

Compatibilidad: grupo lógico sobre campañas físicas existentes; worker intacto y claim original preservado; campañas previas se agrupan por metadatos y las futuras del CRM clásico se sincronizan. No modificar selected_contact_ids de una intención ya admitida. SQL y fuente instalada conciliados en lectura.

Verificación:71 pruebas, TypeScript y build pasan; nativo con fuente final y captura visual con fixtures. No quedan hallazgos altos confirmados abiertos dentro de este alcance. Limitaciones: sin imagen Docker local, Auth/PostgREST real para los nuevos RPC ni envío real; pendientes de G6. Reasignación a destino con historia y reversa de grupos múltiples permanecen bloqueadas por diseño compatible, con motivo explícito y procedimiento documentado.
