# Verificación y publicación

16/11/2026. Autorización directa de implementación y publicación productiva. Alcance y destino en runbook.md; fuentes/SQL sellados en manifest.json. El WIP del coordinador y del checkout original no se incorpora.

## Local

- `scripts/verify-connect-recovery.mjs`:106/106,0 fallos/omisiones; next typegen, TypeScript y build Webpack exit0. Credenciales ficticias, Composio deshabilitado, fetch externo bloqueado. Regresión previa del adaptador reproducida antes del parche; no se sustituyó OAuth por metadata ACTIVE.
- `scripts/run-connect-recovery-native.mjs`: clúster temporal PG15.19 propio,8 subgrupos/9 TAP tests, todos correctos y0 proveedores. Harness original fijado por SHA256, copia derivada declara bootstrap001–047 e inserta ensayo nuevo. Instalación/reversa vacía, duplicación concurrente, cuota única, continuación, ACL y preservación de origen comprobados. Clúster detenido al terminar.
- Tras los últimos bloqueos de contexto: nueve pruebas de conciliación y ensayo nativo repetidos, ambos correctos (reconcile-final.txt/native-tests.txt). Correcciones previas: fixture de fecha con2µs fuera del check y alias PL/pgSQL que colisionaba con variable `h`; resueltas antes de publicación.
- UI ficticia: consultar origen→conciliar→awaiting_brand,1 POST simulado,2 GET de estado y0 externos. Métricas/captura local-ui.json/jpg. No hay desbordamiento horizontal en los tamaños ensayados; el escalado de IAB se documenta con innerWidth real. Sin redirección Google.
- Revisión del diff: ningún flag, secreto, Dockerfile o worker modificado; no hay fallback de identidad ni retry de proveedor. La reserva usa política vigente y solo materializa tras verificar el correo; ACL se revoca explícitamente dentro de la transacción. `git diff --check` correcto.

## Producción hasta el SQL

- Preflight READ ONLY PostgreSQL15.8, target y seis helpers coincidentes, schema/RPC ausentes, política vigente. Un GET previo de metadata Auth Config confirma Gmail/OAuth2/ENABLED, sin perfil ni cambios.
- Dump privado57.497.801 bytes en servidor; `pg_restore` listado y decodificación completa, hash verificado. Primer recibo falló por newline del checksum; se inspeccionó el respaldo existente y normalizó el checksum, sin repetir pg_dump. No se acredita una restauración integral ni respaldo fuera del VPS.
- Primer intento SQL rechazado sin instalar schema/RPC. Causa en script de promoción: String.replace interpretó los delimitadores dólar de la guarda. Corregido con reemplazo mediante función; ensayos sin guarda y con guarda exacta terminan en ROLLBACK. Luego aplicación exitosa una vez; las pruebas no se cuentan como migraciones aplicadas.
- Postflight: cuatro funciones con cuerpos idénticos al candidato, search_path vacío y ACL exactas; ledger RLS y sin SELECT para anon/authenticated/service_role; seis helpers anteriores intactos. Cero conciliaciones ejecutadas hasta ese postflight. Evidencia en production-postflight.json.

Publicación web/worker y recuperación real se registrarán en production-result.md después de observar sus resultados. No están acreditadas por este documento previo al push. Rollback en runbook.md; no borrar evidencia usada.
