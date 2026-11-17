# Verificación

G0–G5: contexto, clarificación, diseño, implementación y verificación local completados. G6 pendiente de aprobación explícita de producción.

Diagnóstico de referencia: 73 últimas verificaciones técnicas con código 402, 11 válidas y una dudosa. Sin llamadas al proveedor, reintentos, compras, envíos ni activaciones. Fuente del significado de 402: https://docs.usebouncer.com/integration-guidelines#cases-to-handle-while-implementing-integration

## Evidencia ejecutada

| FR / AC | Resultado |
| --- | --- |
| 01 | SQL aislado: unicidad por contacto, dos lotes, búsqueda, filtros y páginas de 50; navegador: buscar, filtrar dudosos, estado vacío, error 503 y recuperación. |
| 02–03 | Siete grupos nuevos: aislamiento, atomicidad, replay canónico, payload alterado, selección ajena/incierta/suprimida/válida/duplicada, conflicto de cola que revierte todo, rol/MFA/actor inactivo, ACL heredada service_role revocada, reversa conservando fuentes e historial, HTTP estricto y 503 cerrado. |
| 04 | Compositor real en harness local: asunto/cuerpo ilustrativos siempre visibles, marca explícita, campos avanzados montados aun cerrados, revisión invalidada al editar, programación mediante entrada nativa cambia a Confirmar y programar, borrador preservado al abrir/cerrar revisión y protección al salir. |
| 05 | Capturas a 360,768,1280 y modo oscuro; sin overflow horizontal general ni del modal. Teclado Enter/Tab/Esc, foco visible, aviso de cambios. Consulta y reintento ficticio confirmado de dos contactos: un POST/recibo, cero creaciones/activaciones/proveedores reales y consola sin errores. |

Checks con Node 22.23.4 y entorno de proceso ficticio, sin leer .env reales:

- `node --import ./tests/offline.mjs --import tsx --test --test-concurrency=2 tests/campaign*.test.ts tests/manual-mail-{api,database,dispatcher}.test.ts tests/import-rich-text.test.ts`: **58/58**. El runner expandió explícitamente los archivos; bloqueó fetch externo.
- `tsc --noEmit --incremental false`: exit 0.
- `node scripts/prepare-pdf-viewer.mjs` + `next build --webpack`: exit 0. Build repetido tras el último ajuste CSS.
- `git diff --check`: sin errores.

Ensayos SQL en PGlite con todas las migraciones del repositorio y el paquete import existente, datos ficticios; no fue un ensayo Auth/PostgREST contra producción ni una carga de concurrencia nativa. El significado de 402 describe la última solicitud, no un saldo actual comprobado.

## Conciliación y límites

Catálogo productivo seleccionado en transacción repeatable-read read-only: PostgreSQL 15.8, cinco fuentes requeridas registradas en preflight.sql, dos nombres nuevos libres, columnas compatibles. Cero mutaciones remotas. Main avanzó de 69b2cfa a 5e644e5 con cambios Connect sin archivos solapados; no se hizo merge/push. Reconciliar nuevamente al promover.

Revisión propia del diff: conservadas las rutas de sesión/MFA/origen y el renderer seguro; modo clásico por defecto; sin cambios en worker, env, configuración ni funciones previas. Se corrigieron ancho del modal móvil, contraste de etiquetas/enlaces en oscuro y selección desactualizada al refrescar. No se identificaron bloqueos adicionales en el alcance revisado. No se ejecutó Bouncer real ni se crearon campañas reales.

Evidencia JSON y capturas en `evidence/`. La captura usa un harness de componentes reales con datos ficticios; no es una captura de la web ya publicada. Las capturas son del viewport porque la exportación fullPage del navegador recortaba el borde derecho.
