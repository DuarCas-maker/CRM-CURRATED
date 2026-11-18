# Publicación y reversa del conjunto

Estado y payload vigentes: [preflight/closure.md](preflight/closure.md) y su `promotion-manifest.json`, sobre `544b835`, 42 archivos públicos. Adjuntos resuelto; habilitación Composio pendiente de acreditar periodo/saldo global de proxy. La configuración se conserva en el plan anterior como propuesta, sin aplicarla. El backup inmediato y la autorización concreta se verifican al publicar.

Plan concreto actualizado: [preflight/release-plan.md](preflight/release-plan.md), con manifest sobre `b861486`, propuesta local 058, metadatos de runtime y gates pendientes. Las referencias a la rama/base de implementación que siguen son antecedentes; no publicar desde ese checkout antiguo.

Destino previsto: CRM `https://crm.finlabinc.com`, Supabase self-hosted `https://supabase.finlabinc.com`, web y worker existentes en Coolify. No se ejecuta publicación ni mutación remota al preparar este plan. No usar producción para fixtures ni ensayos destructivos.

## Antes de implementar e integrar

La implementación está aislada en `codex/simple-mail-20261117`. El usuario autorizó compartidos, rutas, pantalla, worker y SQL local. Antes de promover, comparar main contra `9d28d5a257ef26c618d1884f4dc90eb7c0701530` y preservar el WIP de campañas/correo. Manifest y hashes en `implementation-manifest.json`. No reset/stash/clean/rebase de fuentes ajenas ni usar autorizaciones históricas para pagos, envíos o este nuevo despliegue.

## Preflight técnico

Confirmar por referencias/metadata, sin exponer secretos: una configuración OAuth Workspace de la organización admitida, callback autorizado, scopes efectivos y estado de publicación interna; marca Curated Financial activa; asignación a asesores activos; plan Composio/medidores/cap sin pago/uso global; flags y catálogo completo post migraciones/deltas. Captura solo lectura acotada, sin Auth ni SQL de cambios.

La API SQL existente no prueba configuración Google ni saldo Composio. Si el cupo gratuito no se puede verificar/limitar, el respaldo permanece indisponible con motivo visible; no se sustituye por crédito pagado ni se solicita compra como requisito de Gmail directo.

Variables documentadas en `.env.example`: `SIMPLE_MAIL_ENABLED=false` por defecto y `SIMPLE_MAIL_ORGANIZATION` opcional. Habilitación coordinada web/worker después del SQL conciliado. Mantener flags/descriptor QGR y Connect existentes conforme su preflight; no basta cambiar el flag nuevo. Composio requiere registro privado de cap/periodo/proyecto y medidores gratuitos comprobados: no cargar cantidades estimadas ni marcar hard_cap_free sin evidencia del proveedor y del consumo global.

Revisar la corrección guardada de `mail_runtime.command_v1`. El candidato exige el cuerpo canónico normalizado post052 y guarda su definición para la reversa sin uso. Si el catálogo vivo difiere, detener y preparar la adaptación exacta; no saltarse el guard. El fallo heredado de adjuntos figura en `baseline-attachments.txt` y debe evaluarse antes de promover; no se ha ocultado para obtener checks verdes.

## G5

Pruebas FR/AC completas, ensayos de concurrencia y crash; PostgreSQL temporal nativo, forward/rollback/reapply; fixtures realistas sin datos privados; tests de regresión, typegen/TypeScript/build y QA visual/teclado. Revisar permisos y diff, y registrar errores/limitaciones. Revisión de las guías Next instaladas antes de cambiar rutas/componentes. No copiar env ni dependencias de otros checkouts.

## Release

Preparar un commit/payload revisable, migración con ordinal conciliado, backup reciente verificado y reversa antes de cualquier SQL remoto. Registrar autorización del entorno y objetivo para esta publicación. Desplegar SQL expand compatible y web/worker como conjunto; guard de runtime evita que un binario anterior use esquema nuevo parcialmente habilitado. Verificar commit/digest y salud de ambos. Habilitación solo de cuentas con preflight válido; sin reactivar campañas antiguas, colas pausadas ni proveedores ajenos.

Smoke: leer resumen con permisos reales, conectar/reutilizar cuenta autorizada, progresión de setup, status y sync; comprobar que ningún mensaje se emitió por onboarding. Consentimiento Google lo completa el usuario. Prueba real de envío únicamente con buzón, destinatario y contenido concretos acordados; no seleccionar clientes de campañas para el ensayo. Probar respaldo real requiere dos conexiones válidas y fallo inducido acotado antes de emisión, nunca bloquear Google en toda la infraestructura.

## Rollback

Desactivar nuevos onboards/respaldo impide nuevas reservas, sin reintentar los mensajes inciertos. Drenar/conciliar tickets en curso y verificar receipts. Volver a imagen web/worker previa compatible, manteniendo SQL aditivo y datos de autorización/histórico. No reactivar automáticamente credenciales revocadas o campañas pausadas. SQL inverso solo si demuestra ausencia de recibos/referencias dependientes; no borrar tokens/ledgers ni restaurar backup sobre mensajes nuevos para ocultar fallos. Los pendientes quedan visibles y conciliables.

## No implica

No cambia Instantly/TextTorrent, APIs pagas, dominio, DNS o plan contratado. No da acceso general a todos los asesores ni elimina organizaciones del modelo completo. No considera un build correcto como prueba de entrega real del correo.
