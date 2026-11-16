# Diseño implementado

Ledger RLS privado `composio_recovery.runs`, uno por origen y por clave de actor. Guarda snapshot de estado/revisión/fechas, sesión/nonce de conciliación y reserva/admisión. Origen limitado al mismo actor y revisión de autorización, sin identidad/binding aceptados, plazo vencido y fase sin vuelo. Solo se normaliza su estado a expired; se conservan fecha límite y conexión.

GET humano/MFA lista candidatos propios. Cada fase exige concesión humana de10s, payload hash, sesión activa y consumo único; ejecución reservada a service_role. Begin/check/reserve/admit/finish/fail no reutilizan capacidades OAuth. Guard bloquea sujeto y consulta contexto/configuración/marca/cuenta/head/política actuales. Configuración, marca, cuenta existente y head existente se bloquean durante las comprobaciones; finish vuelve a comprobar el contexto derivado tras materializar. Un cambio o llamada incierta cierra el avance sin retry automático.

Servicio limita a dos GET metadata y un proxy GET profile,30s totales y timeouts acotados. Cuota compartida se reserva bajo el mismo advisory lock y se admite una sola vez antes del perfil. Un resultado verificado crea continuación nueva awaiting_brand/ready_to_register con nueva correlación de sesión; el correo, owner, conexión, proyecto y marca se toman del servidor, no del payload cliente. La continuación mantiene los RPC humanos existentes para revisión/registro, sin activar transporte.

HTTP valida origen, JSON estricto y sesión real; cookies HttpOnly/Secure/SameSite Lax. Un POST perdido se consulta en ledger; la lista puede reconstruir cookie de continuación únicamente para la misma sesión y dentro de su plazo. GET no consulta proveedores. Una conciliación fallida/en vuelo no se reenvía. Listado no expone claves idempotentes, hashes, descriptor o connection_id al navegador.

UI integrada en Conexiones ofrece consulta y acción explícitas, sin llamadas automáticas a proveedor ni navegación Google. El aviso del callback anterior se conserva por separado del GET y deja de mostrarse cuando el servidor confirma la identidad.
