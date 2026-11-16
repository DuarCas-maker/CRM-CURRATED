# Publicación y reversa — ML-FAST-v1

Propuesto, no ejecutado. Destino: proyecto CRM - CURRATED / production, web crm.finlabinc.com, curated-worker y Supabase self-hosted del mismo CRM. El delta son los archivos del manifiesto; no incluye WIP ajeno ni cambios de proveedor. La instrucción del usuario autoriza la implementación local; este release de SQL/web/worker necesita su aprobación explícita.

## Preparación y aplicación

1. Revisar el patch/manifiesto y cotejarlo con el HEAD actual del coordinador. Integrar únicamente los archivos seleccionados, sin reset/stash/clean y conservando publicaciones posteriores a la base. Revisar conflictos y ejecutar checks del código final antes del push.
2. En el contenedor supabase-db correcto, psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 con migrations/preflight.sql. Requerir versión PG15, dueño=operador, claim hash 0aec6d3a26c490d986324f2f1fc7d50f y fast_already_installed=false. Si hay drift, detener; no repetir 048–053. Conciliar identificación/ordinal con las entregas de conexión ya instaladas.
3. Crear backup completo privado en el volumen persistente con directorio 700/archivo 600. Validar pg_restore -l y decodificación completa a /dev/null, y guardar tamaño/hash sin mostrar datos. El respaldo permanece en el servidor; una copia local al VPS no protege contra pérdida del VPS. Conservar la restauración como operación separada; este delta no reescribe datos.
4. Aplicar migrations/manual-mail-latency.sql íntegro con ON_ERROR_STOP como el mismo dueño. Incluye transacción, lock timeout 5 s y statement timeout 30 s. Ejecutar migrations/postflight.sql y exigir RPC presentes, solo servicio con EXECUTE, dueño común y search_path vacío.
5. Publicar código revisado con flag aún falso. Push a main dispara web/worker en este proyecto: autorizarlo como despliegue conjunto, observar ambos healthchecks. No cambiar secretos o configuración de Supabase.
6. Añadir MANUAL_MAIL_FAST_SEND_ENABLED=true en Production/Runtime de curated-worker, buildtime desactivado; mantener WORKER_EXECUTION_MODE=normal. Aplicar mediante reinicio y verificar que el código/flag efectivos son los previstos. No activar un segundo servicio emisor.
7. Observar modo, salud, errores genéricos MANUAL_MAIL_DISCOVERY_FAILED/MANUAL_MAIL_SEND_FAILED y tiempos created/sending/sent por cuenta sin cuerpos/direcciones en logs. Comprobar todas las cuentas conectadas actuales y el descubrimiento de nuevas. Texto/destinatario/presupuesto de mensajes reales se aprueban antes del ensayo; no usar silenciosamente correos de clientes como benchmarks.

## Éxito y reversa

Éxito: envíos manuales no esperan al job de lectura, sin solapamiento por buzón, campañas conservan 30/60 s y controles vigentes. Meta 2–5 s en condiciones normales se mide después, con excepciones de cuotas, adjuntos, fallos o latencia del proveedor.

Para detener la vía rápida: flag=false y reiniciar el worker conservando el SQL compatible. Esto deja el sender general operativo y el pacing manual de 1 s instalado. Para volver también al ritmo anterior, con el dispatcher detenido y sin operaciones en vuelo ejecutar la reversa SQL revisada como el dueño original y comprobar restitución de claim/RPC/ACL. No borrar, reencolar o reenviar sending/uncertain. Un apagado total urgente se realiza con WORKER_EXECUTION_MODE=paused y reinicio bajo autorización operativa; no es necesario para instalar el delta sano.
