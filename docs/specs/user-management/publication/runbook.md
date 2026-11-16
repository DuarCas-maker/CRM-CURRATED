# Publicación autorizada — Usuarios 054

2026-11-16 · SDD STRICT. Autorización del usuario: aplicar 054, publicar Usuarios en producción y verificar funcionamiento/exclusividad superadmin; ratificada la ejecución por API. No requiere una nueva aprobación del mismo alcance.

## Destino y alcance

- CRM `https://crm.finlabinc.com`, Supabase `https://supabase.finlabinc.com`, base `postgres`, SQL como `supabase_admin`, PG15.8. Identidad verificada por `/pg/query`, TLS validado, sin redirecciones, API key solo en memoria del proceso. Primera lectura: 054 ausente y siete funciones nuevas ausentes; roles esperados y tablas core presentes.
- Coolify existente: web `rv8rpfxhf0mbxprge6h6ki9c`, worker `vc4aybj4ucje7zstpsp3zboh`, Supabase `tzpxxufvp3zf6u7eyjdmxa4p`. No modificar variables, transportes, modos ni proveedores. Publicación por fast-forward de main/webhook existente; no redeploy duplicado.
- Main remoto observado primero en `90a95ce139f3454e6dd33fb4d8b4b2a7c26d08ed` y posteriormente en `2ef0826` (campañas desde archivos). Conservar ambos incrementos. Preparar un release aislado que contenga únicamente el delta Usuarios, pruebas y documentación propia, excluyendo el WIP ajeno.
- No se leen/visualizan secretos o datos reales de clientes en evidencia. La configuración privada ya existente se carga únicamente para ejecutar las llamadas autorizadas; nunca se imprime ni se versiona. No se reutilizan ejecutores/contadores de Instantly ni sus presupuestos históricos.

## Secuencia

1. Congelar fuentes, revisar SHA y pruebas locales anteriores. Actualizar 054 con `NOTIFY pgrst` para refrescar esquema después del DDL; repetir DB/contratos pertinentes. Ensayar contra la base vigente local y, si está disponible, PG15 nativo.
2. Crear respaldo completo en el volumen persistente PostgreSQL con permisos 700/600; validar índice y decodificación de pg_restore sin exportar filas. Guardar solo ruta/huella/tamaño/resultado. Si la respuesta de backup es incierta, inspeccionar antes de repetir.
3. Aplicar solo 054 íntegro, en transacción, con lock timeout 5s y statement timeout 30s. Ningún SQL histórico se repite. Antes de enviar comprobar que no existe tabla/funciones nuevas. No reintentar una respuesta incierta sin inspección de catálogo.
4. Postflight: una nueva tabla vacía con RLS, siete funciones nuevas con propietario/search_path esperados; sin acceso directo anon/authenticated a texto cifrado y helpers solo servicio. Comparar huella de funciones existentes antes/después, sin imprimir sus cuerpos. Verificar rol/MFA mediante pruebas SQL controladas, diferenciándolas de sesiones JWT reales.
5. Integrar/publicar únicamente las fuentes propias en main preservando 90a95ce y cualquier avance posterior. Esperar pipeline existente, commit exacto, build Linux, health web y worker si se reconstruye por su webhook. No iniciar trabajos manuales.
6. Smoke público: health 200, API de usuarios exige sesión y no-store; origen ajeno rechazado. Con una sesión superadmin existente, lectura del módulo y metadatos. Los flujos de contraseña/roles no alteran cuentas reales para fabricar evidencia. Si no hay sesión de otro rol, registrar el límite y comprobar guardas con fixtures/contexto SQL sin persistir cambios.
7. Registrar commit, despliegues, postflight y pendientes. No declarar publicado hasta comprobar el recurso efectivo y sus permisos.

## Rollback

Preferir imagen web anterior conservando 054 instalado, compatible con el código previo. No revertir automáticamente contraseñas ni usuarios ni restaurar toda la base. La reversa SQL propia elimina únicamente objetos nuevos y se ejecutaría con datos respaldados y autorización específica si fuera necesaria; está prohibida como reacción automática a un fallo de red. No forzar main, resetear WIP o modificar DNS/env/infraestructura.
