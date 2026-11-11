# Rollout y reversa QGR — propuesta

10/11/2026. Ningún paso remoto está autorizado por preparar este runbook.

Delta TI: ver [contrato](i03-tokeninfo.md) y [verificación](i03-tokeninfo-verification.md).
El adaptador actual admite tokeninfo sin exportar tokens; su uso real aún necesita
presupuesto/cupo y autorización, publicación y comandos v2. La reversa local TI usa
su baseline para retirar solo provider/verifier/tests TI, o vuelve a un puerto que
falle cerrado. No se altera ninguna reserva, proveedor elegido o SQL ya aceptado.

1. Implementar incrementos offline por alcance; integrar primero el snapshot final de Connect o aplicar un delta conciliado expresamente. Revisar contratos de proveedor/permisos sin consumir APIs. Cupo Hobby/Proxy sigue pendiente.
2. Ensayar migración aditiva y reversa en PostgreSQL15 con base representativa050/051 más el delta Connect que finalmente entre. Comprobar ACL/RLS/funciones/huellas y preservar datos v1 y contadores. No repetir049/050/051 en producción.
3. Preparar release web+worker compatible, SQL final sin ordinal hasta coordinación, preflight/postflight, imagen recuperable y controles de writer/in-flight. Recibir autorización concreta antes de publicar o aplicar SQL.
4. Publicar esquema expandido y binarios con política nueva disabled y operación Composio false. Smoke sin proveedor autorizado aparte. No usar una nueva variable como activación automática.
5. Antes de habilitar política, revisar consumo histórico, transición de reservas y autores que pueden producir tráfico. Pausar admisiones durante el corte y conciliar pendientes; no confundir cola vacía con ausencia de in-flight. Cargar agregado conservador sin resetear registros existentes. Activar la política requiere aprobación propia por el efecto de pacing en Gmail directo.
6. Revisar configuración y habilitar solo la comprobación de una asociación existente, con cupo/autorización propios. Conservar owner externo y ca_id original; no emitir un link. Confirmación humana de binding separada de writer. Cerrar la exposición temporal según el protocolo real preparado después.
7. R06/operación Composio e histórico siguen posteriores; no se habilitan por aprobar el candidato ni por disponer de Hobby.

## Reversa

- En la preparación: basta retirar únicamente esta carpeta si se solicita; no hay producto/configuración cambiados.
- En una futura entrega: cerrar nuevas admisiones v2 y comprobar estado in-flight/uncertain; mantener/cerrar el proveedor seleccionado según el protocolo R06. No conmutar automáticamente al directo después de una emisión incierta.
- Conservar columnas/tablas/historial y contadores agregados hasta que ningún binario/check/intent dependa de v2. Restaurar imagen antigua solo tras comprobar rechazo de bindings nuevos y operación directa compatible. No falsificar project ID para satisfacer v1.
- Reversa destructiva de esquema solo en ensayo o con autorización específica y precondiciones verificadas. No borrar candidatos/auditoría o poner saldos a cero para desbloquear la reversa.

## Controles que no sustituyen esta propuesta

La limitación Google interna no acredita saldo Composio; estado ACTIVE no acredita email ni grants; verified no habilita transporte; una autorización anterior de S00 o publicación no se traslada a este ensayo. Instantly permanece43/0 nuevas; sin envíos ni operaciones pagas.
