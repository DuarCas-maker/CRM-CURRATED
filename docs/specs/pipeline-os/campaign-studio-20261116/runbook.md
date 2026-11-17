# Campaign Studio → producción

Autorización recibida: «Sí, autorizo integrar y publicar el paquete en crm.finlabinc.com y aplicar las dos funciones». Candidato de 28 archivos, parche SHA256 `4a97e0676801d3576fb0f2a40b20355426a5a43fdcf6603f318fb0b960bc7293`. Integración aislada sobre main `5e644e5bf2303fab8e722ec414d3937715873e9e`, sin reemplazar trabajo ajeno.

## Destino y controles

- Web https://crm.finlabinc.com, Coolify 4.7.5, aplicación `rv8rpfxhf0mbxprge6h6ki9c`, worker `vc4aybj4ucje7zstpsp3zboh`, servidor `oe9yj6hkhjemykexwndtcxn3`.
- Supabase autoalojado https://supabase.finlabinc.com, recurso `tzpxxufvp3zf6u7eyjdmxa4p`, PostgreSQL 15.8. SQL por la conexión API existente, sin copiar/exponer claves.
- Dockerfiles y package/lock/configuración sin cambios; Node22, web no-root, healthcheck `/api/health`, volúmenes existentes. No se instala engine local ni se modifica infraestructura. Build local Next verificado con entorno ficticio; imagen Linux se verifica en Coolify.

## Secuencia

1. Verificar integridad canónica del candidato y aplicar parche en worktree nuevo basado en main. Ejecutar 58 pruebas relacionadas, TypeScript y build: completados exit0 en la integración.
2. Capturar fuentes seleccionadas y catálogo completo de funciones antes de SQL. Comprobar que los dos nombres nuevos estén libres. Crear respaldo en el contenedor mediante `pg_dump -U supabase_admin -d postgres --lock-wait-timeout=5s -Fc`, umask077; verificar `pg_restore --list` y decodificación completa `pg_restore --file=/dev/null`. Evidencia en `evidence/backup.json`; sin ensayo de restauración completa sobre servidor de desastre.
3. Ejecutar `migrations/up.sql` en una transacción, con timeouts20s/5s y guardas de las cinco fuentes de preflight. Reconciliar todo el catálogo: exactamente dos funciones nuevas, 313 funciones previas sin cambios de fuente/ACL/configuración. Authenticated habilitado, anon/service_role denegados. Completado; evidencia en `evidence/sql-application.json`.
4. Registrar commit del paquete revisado, fetch main y push fast-forward; si avanzó main, conciliar primero en aislamiento. El push dispara web y worker en Coolify. No forzar push, detener servicios ni modificar variables.
5. Seguir ambos despliegues hasta estado final, verificar imagen del commit y contenedores healthy, conservar worker normal y envío rápido manual. Leer health, API anónima cerrada, campaña y panel de revisión con sesión existente. Sin POST verify/retry/create/activate/schedule, consumo Bouncer ni envíos de prueba.

## Criterios y reversa

Éxito: commit exacto sano, UI nueva visible, lista del lote y motivos accesibles, controles manuales conservados y cero llamadas al proveedor durante el smoke. Si falla web, volver al commit previo `5e644e5` mediante rollback de Coolify o revert Git revisado; restaurar también el worker si su nuevo despliegue falló. Las funciones aditivas pueden permanecer sin uso durante rollback web. Retirarlas solo con `migrations/down.sql` tras revisar dependencias, conservando contactos, verificaciones, trabajos y recibos. El respaldo no se restaura sobre producción como parte de un rollback de UI.
