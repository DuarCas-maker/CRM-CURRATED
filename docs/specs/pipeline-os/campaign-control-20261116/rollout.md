# Promoción y reversa

Local primero: fixtures con brand_b2 instalado, pruebas negativas/transaccionales y concurrencia, regresión/compilación y capturas ficticias. Capturar catálogo y dependencias del claim vigente; comparar contra candidato antes de cualquier cambio remoto. Crear/verificar respaldo antes de SQL STRICT, con autorización específica del paquete final.

Expandir tablas/RPC y decorar claim sin cambiar worker/proveedor; backfill únicamente metadatos de agrupación de campañas, sin crear envíos. Publicar web después del SQL, smoke de lectura sin activar/verificar/reasignar datos reales. Mantener servicios y configuración actuales.

Rollback UI al commit anterior; restaurar claim original desde schema privado mediante reversa revisada. Conservar metadatos/historial que ya referencien operaciones; no deshacer reasignaciones ni reactivar mensajes cancelados mediante rollback automático. Si quedan grupos reales, preservar sus límites antes de retirar el decorador. No restaurar todo el respaldo sobre producción como reversa de UI.

## Candidato y destino

Propuesto, no ejecutado. Branch codex/campaign-control-20261116 sobre a881100. Cambios ejecutables listados y hasheados en manifest.json: API/cliente/UI Pipeline, composer compartido, SQL up/down y ensayos locales. CRM clásico conserva sus comandos/worker; dos triggers aditivos mantienen su representación en el panel.

Destino: crm.finlabinc.com; Supabase autoalojado supabase.finlabinc.com, recurso Coolify tzpxxufvp3zf6u7eyjdmxa4p. Web rv8rpfxhf0mbxprge6h6ki9c y worker vc4aybj4ucje7zstpsp3zboh. Push a main reconstruye ambos aunque el código del worker no cambia. No modificar variables, secretos, cupos, conexiones, infraestructura o servicios por este release.

## Secuencia propuesta después de aprobación

1. Contrastar origin/main y hashes del manifiesto contra el candidato final. Si hay cambios concurrentes, conciliar en checkout aislado y repetir checks afectados. Conservar WIP de todos los otros worktrees.
2. Repetir la captura acotada de catálogo/ACL/dependencias/eventos en transacción READ ONLY, compararla con catalog-preflight.json y ddl-preflight.json. Confirmar que no existe instalación parcial y que claim conserva su fuente esperada.
3. Crear/verificar respaldo reciente y accesible antes del DDL: inventario/tamaño/checksum y comprobación de legibilidad, con procedencia del recurso productivo. Conservar export de definiciones/ACL originales. Si respaldo no se comprueba, detener promoción. El respaldo anterior de otro release no basta por sí solo.
4. Ejecutar una sola transacción con migrations/up.sql bajo el rol dueño aprobado. Crea2 tablas RLS,2 triggers de compatibilidad,2 RPC públicos, helpers privados y decorador de claim que conserva su implementación original. Backfill solo metadatos; no altera enrollments/outbox existentes. Guardas CC_BASE_CHANGED/objetos ya existentes abortan la transacción. Recargar schema PostgREST mediante NOTIFY incluido.
5. Verificar por SELECT tablas/políticas/ACL/hash de funciones nuevas y función original privada. Confirmar que no aumentaron enrollments/outbox ni cambiaron estados de la campaña durante la migración atribuibles al delta. No llamar due_campaign_enrollments, claim_outbox, start_scheduled_campaigns, verify_contacts o comandos de envío durante smoke.
6. Crear commit del paquete validado e integrar/push a main según aprobación; observar builds web/worker de ese SHA en Coolify hasta healthy o fallo. Comandos de Git de promoción, SQL y despliegue aún no ejecutados.
7. Smoke de lectura autenticada con MFA: /pipeline-os campañas, GET /api/campaigns/control?mode=overview y details de la campaña existente. Mostrar métricas, datos y motivos. Revisar HTTP/console/logs acotados sin contenido de mensajes/contactos. Verificar origen rechazado sin mutación de campaña. Documentar SHA, migración/hash, health y resultado.

Criterio de éxito: fuente/ACL conciliadas, transacción completa, builds del SHA candidato saludables, lecturas con MFA y sin exposición de otra marca. El envío real no se considera probado por este smoke. El worker continúa operando las campañas que el usuario ya hubiera autorizado; no se amplían sus cuotas ni se activan nuevas campañas para validar el release.

## Fallo o reversa

- Antes de commit SQL: rollback transaccional y no publicar web.
- Después de SQL con fallo web: desplegar web/worker del SHA anterior a881100; mantener expansión SQL es la opción inicial segura. Preservar protección global para grupos nuevos.
- Solo si no existen grupos de varios miembros y el catálogo coincide, ejecutar migrations/down.sql tras revisión/autorización de reversa. Restaura la función original, retira RPC/helpers/triggers, conserva tablas de metadatos e historia. No es un instalador idempotente: una reinstalación posterior requiere un delta conciliado para las tablas conservadas.
- Si ya se usaron grupos múltiples: no forzar down ni eliminar miembros para eludir CC_KEEP_GROUP_LIMIT. Mantener decorador y preparar reversa compensatoria conservando límites e intenciones. Nunca reactivar outbox cancelado ni restaurar toda la base para una reversa de interfaz.

## Ensayos reproducibles

Con Node22 y dependencias existentes, sin .env real:

```text
node --import ./tests/offline.mjs --import tsx --test tests/campaign-control.test.ts tests/campaign-control-http.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --import ./tests/offline.mjs --import tsx tests/campaign-control-browser.mts
```

Harness UI en127.0.0.1:64831; solo datos sintéticos, sin worker ni proveedores. Detener con Ctrl+C al terminar. PostgreSQL15 nativo: definir CAMPAIGN_TEST_PG_BIN con el directorio bin de una instalación local confiable y ejecutar `node --import ./tests/offline.mjs --import tsx tests/campaign-control-native.mts`. Crea y detiene únicamente un clúster temporal propio, host loopback; no elimina directorios ni usa una base remota. Para Next build, usar env ficticio documentado en verification.md; no cargar el .env productivo.
