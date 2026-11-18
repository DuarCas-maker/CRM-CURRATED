# Publicación Gmail directo — autorización y plan

17/11/2026 America/Bogota. El usuario autoriza publicar primero Gmail directo, SQL y despliegue coordinado web/worker; Composio queda deshabilitado mientras responde soporte. Autoriza continuar sin backup nuevo. Esta instrucción expresa sustituye el requisito de backup previo de las guías locales para esta entrega; se registra backup omitido y no se presenta un respaldo histórico como reciente. Se conserva reversa de flags/código y SQL solo sin uso; no se promete restauración de datos sin backup.

SDD STRICT. Destino verificado: CRM https://crm.finlabinc.com, Supabase https://supabase.finlabinc.com, entorno production de Coolify gzbzm9radjjsrbgtufhi7x53/xldygmbiax9prff0pgldqu5a; web rv8rpfxhf0mbxprge6h6ki9c y worker vc4aybj4ucje7zstpsp3zboh. No cambios en DNS, infraestructura Supabase, credenciales Google, plan/créditos, campañas o proveedores ajenos.

## Delta de alcance

GMAIL-AC01: habilitar alta, permisos y sincronización directa Gmail manteniendo roles/MFA/origen. GMAIL-AC02: Composio cerrado explícitamente en HTTP, UI y runtime, aunque exista una configuración previa o un saldo ficticio. Nuevo flag `SIMPLE_MAIL_COMPOSIO_ENABLED=false` por defecto, independiente del flag general. GMAIL-AC03: no reactivar campañas ni enviar mensajes durante despliegue. GMAIL-AC04: SQL aditivo guardado y mismo commit web/worker, salud, flags efectivos y lecturas con sesión real después del corte.

## Orden

1. Conciliar main y catálogo nuevamente. Base 17cbbd6 incorporada por fast-forward sobre el worktree propio: dos archivos de campañas ajenos al payload. No se descarta WIP. Ensayar el flag de cierre y repetir regresión/compilación.
2. Revisar hashes, reservar migración 058 solo tras confirmar que está libre; colocar candidato y reversa en el repo con procedencia. Captura SQL READ ONLY antes del cambio y guard MD5 post052 intacto. No cargar fixtures.
3. Configurar web/worker con `SIMPLE_MAIL_ENABLED=false` durante el corte; `SIMPLE_MAIL_COMPOSIO_ENABLED=false`, `SIMPLE_MAIL_ORGANIZATION=curated`. Composio Connect/binding/checks/verifier setup en false, sin borrar claves ni contextos existentes. Routing global cerrado. QGR se habilita coordinadamente con Gmail y su política generation 1 conservadora, sin subir límites.
4. Aplicar SQL expand compatible en transacción con lock_timeout; verificar funciones/ACL/esquema y tabla included vacía. El usuario ha omitido explícitamente el backup nuevo. Abortará ante drift del guard o errores.
5. Commit y push no forzado del release a main conforme pipeline existente autorizado. Seguir ambos despliegues, resolver errores y verificar commit/digest/salud. No declarar publicación por un push o un build.
6. Habilitar `SIMPLE_MAIL_ENABLED=true` y `MAIL_QUOTA_POLICY_ENABLED=true` en web/worker con el mismo release, manteniendo Composio y routing global en false. Verificar por allowlist de runtime sin mostrar secretos.
7. Smoke health público; rutas sin sesión y con sesión superadmin/MFA, cierre Composio, pantalla Connections, permisos y ausencia de envíos/onboards implícitos. No completar consentimientos ni crear nuevas conexiones; el usuario probará la autorización Google si hace falta. Envío de prueba real queda fuera hasta acordar remitente/destinatario/contenido.

## Reversa

Ante salud/ACL/runtime inválidos: cerrar SIMPLE_MAIL_ENABLED en web/worker, volver al commit/imagen previos registrados, conservar SQL y recibos si hubo uso. Reversa SQL únicamente sin filas/dependencias, con guard propio; no borrar evidencia ni reintentar envíos inciertos. Composio sigue false. SQL transaccional abortado no necesita una restauración. La omisión del backup reduce la recuperación frente a errores de datos y queda aceptada expresamente por el usuario.

Resultados, autorización, hashes, commit, despliegues, smoke y límites reales se guardarán aquí. No crear una tarea de seguimiento automático ni contactar otros chats.
