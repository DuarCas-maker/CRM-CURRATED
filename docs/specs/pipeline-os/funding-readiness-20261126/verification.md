# Verificación

Discovery real: 4.040 contactos, 2.052 con ingreso; 4.030 leads, 2.052 con ingreso y 1.978 sin ingreso. La base no cambió durante la lectura. Catálogo capturado de forma privada; listado del pool no trae ingreso, el lector del funnel sí lo enriquece solo en sus páginas.

Implementación local terminada. Ocho pruebas específicas (SQL, HTTP, UI y funnel) y 35 de regresión pasaron, sin fallos. TypeScript, build Next.js con webpack y diff --check pasaron. No se consumieron verificaciones ni se enviaron correos.

El ensayo PostgreSQL 15 temporal verificó permisos/MFA, selección mixta, campos faltantes, filtros antes de paginar, conservación de funciones anteriores y reversa. Con 4.048 leads ficticios: pool 1.183 ms; funnel 1.415 ms. Evidencia: native-result.json. No fue un benchmark del servidor productivo.

Respaldo productivo del 26/11 a las 18:59 UTC: archivo de 121.615.329 bytes, listado y decodificación completos verificados; no se ensayó una restauración de desastre. Evidencia: backup.json.

A las 19:03 UTC se aplicaron las tres RPC aditivas de lectura, con guardia de hashes del catálogo y versión SQL igual al ensayo nativo. Las funciones previas quedaron intactas; permanecen 4.040 contactos, 4.030 leads, 2.052 contactos con ingreso y dos bloqueos de rebotes activos. Sin mutaciones de datos de clientes. Evidencia: application.json.

Publicado en crm.finlabinc.com: commit 4fd31a37e1c42ed297720d7bebb37470c43bbeea. Coolify mostró Success para web y worker, ambos Running. No se modificaron configuración, límites, proveedores ni firmas.

Postflight desde sesión humana existente: el funnel mostró 4.030 leads y 518 disponibles. El resumen de ingreso mostró 2.052/1.978 con/sin ingreso en el total y 373/145 en los disponibles. El filtro Sin ingreso mensual funcionó en Total y Disponibles; mostró solo filas sin ingreso, sin alterar los totales del funnel. Inspección visual en el viewport existente: resumen compacto y selector legibles, sin solapamiento.

Se seleccionó un lote nuevo de 50 disponibles sin ingreso, solo en la interfaz. La revisión de la plantilla Monthly Income mostró exactamente 50 revisados, cero listos y 50 por revisar, con 50 identidades y motivo Ingreso mensual; Enviar campaña permaneció deshabilitado. Al cambiar a OFFER SBA 7(a), que no exige ingreso, los mismos 50 quedaron listos y el botón se habilitó. Se salió sin guardar y se dejó el filtro Sin ingreso mensual en Disponibles. No se pulsó Enviar campaña ni se consumió Bouncer. La selección original de la captura del usuario no está persistida y no se afirma que sea este lote nuevo.

Lectura agregada final, 19:12 UTC: 4.040 contactos, 4.030 leads, 2.052 leads con ingreso, 1.978 sin ingreso y dos bloqueos de rebotes. Los ingresos antiguos faltantes no se inventaron ni rellenaron: permanecen disponibles para otras plantillas. Los datos de ejemplo de la vista previa no se confunden con la revisión del lote real. Evidencia sin identidades de clientes: postflight.json.
