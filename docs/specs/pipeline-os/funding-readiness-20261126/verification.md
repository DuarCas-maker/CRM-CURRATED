# Verificación

Discovery real: 4.040 contactos, 2.052 con ingreso; 4.030 leads, 2.052 con ingreso y 1.978 sin ingreso. La base no cambió durante la lectura. Catálogo capturado de forma privada; listado del pool no trae ingreso, el lector del funnel sí lo enriquece solo en sus páginas.

Implementación local terminada. Ocho pruebas específicas (SQL, HTTP, UI y funnel) y 35 de regresión pasaron, sin fallos. TypeScript, build Next.js con webpack y diff --check pasaron. No se consumieron verificaciones ni se enviaron correos.

El ensayo PostgreSQL 15 temporal verificó permisos/MFA, selección mixta, campos faltantes, filtros antes de paginar, conservación de funciones anteriores y reversa. Con 4.048 leads ficticios: pool 1.183 ms; funnel 1.415 ms. Evidencia: native-result.json. No fue un benchmark del servidor productivo.

Respaldo productivo del 26/11 a las 18:59 UTC: archivo de 121.615.329 bytes, listado y decodificación completos verificados; no se ensayó una restauración de desastre. Evidencia: backup.json.

A las 19:03 UTC se aplicaron las tres RPC aditivas de lectura, con guardia de hashes del catálogo y versión SQL igual al ensayo nativo. Las funciones previas quedaron intactas; permanecen 4.040 contactos, 4.030 leads, 2.052 contactos con ingreso y dos bloqueos de rebotes activos. Sin mutaciones de datos de clientes. Evidencia: application.json.

Pendiente: publicación web/worker y comprobación visual/autenticada del filtro y del lote en el CRM, sin activar campañas.
