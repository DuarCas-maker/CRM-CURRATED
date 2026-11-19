# Índice del agregado de Reportes — STRICT

La web7dde2e8 está publicada y la navegación comercial está verificada. Reportes conserva un statement timeout. El usuario autorizó exclusivamente diagnóstico SQL de lectura usando credenciales existentes; este documento no autoriza ejecutar DDL remoto.

Actualización: después del diagnóstico y ensayo local, el usuario autorizó por separado «A) Autorizar respaldo, índice y verificación en producción (recomendado)». Aplicación y postflight correctos; ver verification.md. El párrafo anterior conserva el alcance inicial, no el estado final.

FR-DB-001: acelerar EXISTS(import_rows.contact_id=filtered.contact_id AND result='imported') sin cambiar su resultado. AC-DB-001: índice parcial por contacto con ese predicado, usado en un plan local representativo.

FR-DB-002: preservar funciones, políticas, grants y filas. AC-DB-002: agregados idénticos antes/después con admin, seller, otro seller y MFA insuficiente; anon conserva denegación. No crear unicidad nueva.

FR-DB-003: operación reversible y comprobada. AC-DB-003: preflight de identidad/huellas, respaldo verificado, índice válido/ready tras aplicación; reversa solo del índice nuevo y nueva prueba de Reportes real.

Evidencia: funciones productivas con huellas8e058cf7c9f791cd708c4509bb2c1be7 y2d22ca1953b8a8072abd161c29486ec8. Import_rows tiene~2697 filas y solo PK(batch_id,row_number). EXPLAIN sin ANALYZE, como authenticated sin JWT, muestra Seq Scan import_rows con costo estimado24066.02; es evidencia de plan y ausencia de índice, no tiempo real ni una sesión humana. Los tiempos reales del RPC son7118–7440ms y Reportes devolvió timeout.

No objetivos: modificar cálculos financieros, RPC, RLS, roles, datos de clientes, transportes, worker ni infraestructura.
