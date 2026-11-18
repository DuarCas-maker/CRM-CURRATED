# Verificación de la implementación local

Cierre vigente: [preflight/closure.md](preflight/closure.md), rama `codex/simple-mail-ready-20261118` sobre `544b835`. Fallo de adjuntos resuelto sin cambiar políticas; seis pruebas de adjuntos/Case Flow pasan. Los resultados actuales de regresión/compilación se fijan en `preflight/promotion-manifest.json`. Los estados y conteos b861486/9d28d5a que siguen son históricos.

Actualización de promoción del 18/11 UTC: el estado vigente está en [preflight/release-plan.md](preflight/release-plan.md) y [preflight/promotion-manifest.json](preflight/promotion-manifest.json). Sobre main `b861486`, con marca productiva corregida: 42/42 focalizados, 14/14 nativos, regresión 536 correctos/1 fallo heredado/6 omitidos, compilación correcta. OAuth y contratos seleccionados comprobados en producción; presupuesto gratuito de proxy sin acreditar. Los párrafos siguientes conservan el cierre original sobre `9d28d5a`.

Autorizada el 2026-11-17 (America/Bogota), rama aislada `codex/simple-mail-20261117`, base `9d28d5a257ef26c618d1884f4dc90eb7c0701530`. No hay publicación, push, migración remota, consentimiento ni mensajes reales. No se abrieron env reales ni se instalaron dependencias.

## Evidencia reproducible

Cierre: **42/42** resultados de pruebas focalizadas; **14/14** nativos; regresión **517 correctos, 1 fallo heredado y 6 omitidos por condiciones existentes**. Typegen, TypeScript y build webpack correctos. Estos conteos incluyen los contenedores TAP del ensayo. No hay ensayo de proveedor real.

- `scripts/verify-simple-mail.mjs`: regresión offline de 79 archivos de campañas, correo, Connections, Connect, C1, QGR y transporte; typegen, TypeScript y build Next con webpack. Configuración ficticia y cierre por defecto. Resultados exactos en `local-checks.json`, `regression.txt`, `types.txt`, `typecheck.txt` y `build-webpack.txt`.
- Pruebas nuevas `mail-connections-http`, `mail-connections-db`, `mail-connections-sync` y `mail-fallback`; también UI Connections. Ver `core-tests.txt`. Cubren identidad/MFA/sesión/origen, ACL, diez buzones, recuperación sin repetir Google, alta Composio-first, cursores por lote/CAS, salud, permisos revocados, desconexión obsoleta, presupuesto y fallback antes de emisión.
- `scripts/run-simple-mail-native.mjs`: clúster PostgreSQL 15.19 temporal propio, detenido en finally; `native-tests.txt`. Siete controles Connect heredados y seis nuevos: forward/reversa/reapply, MFA/identidad, concurrencia por última unidad gratuita, ACL/reversa usada, dos callbacks disputando un intercambio y dos conexiones disputando un cursor con checkpoint final atómico.
- El harness nativo original permanece intacto y se verifica por SHA-256. Las fixtures usan migraciones hasta 047 y declaraciones canónicas post052. Es un catálogo sintético local: no demuestra equivalencia con el catálogo vivo ni ejecuta el protocolo productivo 052.
- QA visual local con datos ficticios, anchos CSS 360/768/1280 y teclado entre proveedores/selector de asesor. `visual-checks.json`, `gmail-desktop.jpg`, `gmail-mobile.jpg`, `composio-tablet.jpg`. Servidor loopback detenido y pestaña cerrada. Sin Google ni Composio reales.

## Fallo heredado registrado

`tests/gmail-attachments.test.ts:235` espera total 3 y recibe 4. Reproducido en un checkout limpio de `9d28d5a`, sin este cambio: `baseline-attachments.txt`. No se relajó ni omitió esa prueba; el runner mantiene su salida distinta de cero. Los errores CSS de la primera ejecución Node se resolvieron con un hook exclusivo de markup; QA visual y build cargan el CSS real.

## Revisión y límites

Revisión propia de permisos, payloads, idempotencia, locks, cuotas, compartidos e incertidumbre. Se corrigieron el calificador post052 reproducido en PostgreSQL, recepción periódica Composio-only, carga inicial por lotes, persistencia entre sesiones, CAS al desconectar y renovación de remitentes en el CRM. Archivos/hashes en `implementation-manifest.json`; revisión de whitespace con `git diff --check`.

No se presenta un candidato como cuenta lista ni un build como prueba de entrega. Proveedores y consentimientos simulados. No se comprobó OAuth real, configuración efectiva/cap/saldo global de Composio, deliverability, volumen diario, containers ni permisos productivos. Antes de promover: conciliar main/catálogo, numerar migración, verificar backup/configuración, revisar el fallo heredado y autorizar publicación. La reversa solo retira instalaciones sin recibos; una instalación usada conserva evidencia y se deshabilita por flag.
