# Verificación — candidato local, 16/11/2026

STRICT, G0–G5 completos. G6 pendiente: no se ejecutaron push, merge, migración remota ni publicación. Base a881100, rama codex/lender-composer-20261116. Se preservó el WIP del coordinador mediante worktree aislado.

## Resultado ejecutado

**62 pruebas únicas aprobadas**, sin fallos ni skips en la selección ejecutada. [Resultados por archivo](evidence/checks.json). No se cuenta dos veces la repetición posterior de 12 pruebas para la regresión de reenvíos. `tsc --noEmit --incremental false` y `next build --webpack` aprobados en Node 22.23.5 / Next 16.3.8, con configuración pública ficticia y fetch externo bloqueado. Se preparó el visor PDF con el script existente. `git diff --check` sin errores. Revisión de diff y escaneo de claves privadas en archivos del incremento sin hallazgos abiertos.

| AC / FR | Evidencia realmente observada | Resultado |
|---|---|---|
| AC-001 / FR-001 | CUA con componentes reales: viewport CSS 360/768/1280; ancho de documento igual al viewport; diálogo 329/329 y 705/705 client/scroll en móvil/tableta. Tab permanece en el editor y Escape muestra protección de borrador. | Aprobado |
| AC-002 / FR-002 | Validador acepta 172 targets, catálogo activo incluye 173 con uno sin correo. Browser selecciona 73 y muestra el problema; permite quitarlo dejando 72. | Aprobado |
| AC-003 / FR-003 | PGlite: lote real de 73 filas outbox ficticias, To/CC/asunto/HTML separados; contacto inválido número 73 revierte outbox y submissions; retry retorna mismos IDs; reutilizar clave con datos distintos falla. Respeta send_retry_at y RLS de selección personal. | Aprobado |
| AC-004 / FR-004 | SQL: vendedor no escribe, admin aal1 no escribe, anon no lee; SELECT activo permitido; UPDATE directo denegado. CAS, receipt, historial y rollback conservan versiones. PG15 nativo: dos administradores concurrentes, una escritura aceptada y otra en conflicto. Browser crea plantilla desde el mensaje y la nueva opción aparece sin perder el borrador. | Aprobado |
| AC-005 / FR-005 | Aplicación copia asunto/mensaje inicial; schemas omiten assets/steps. Browser detecta unsubscribe_url de plantilla de campaña y bloquea revisión. | Aprobado |
| AC-006 / FR-006 | Resolver compartido: empresa/contacto/monto/lender; faltantes explícitos; claves desconocidas y llaves mal formadas; CR/LF y longitud de asunto; HTML/Markdown de valores no introduce markup. Prueba MIME conserva el cuerpo renderizado y evita firma duplicada. | Aprobado |
| AC-007 / FR-007 | Mock de BD verifica digest estable y cambios de monto, contenido, proceso, archivos y firma; contacto cambiado rechaza. Prueba de contrato del código confirma comparación antes de queue y guardas de origen/sesión/body acotado. RLS/MFA reales se ejercen en SQL, no se simula una sesión productiva. | Aprobado local |
| Regresión | Correo, adjuntos, canales, checklist, campañas, import flow, Pipeline OS y workspace: 15 archivos de tests más PG15. Reenvío conserva ejemplos de variables como texto literal. | Aprobado |

## Prueba visual e interacción

[Escritorio 1280](evidence/desktop-1280.jpg), [móvil 360](evidence/mobile-360.jpg), [tableta 768](evidence/tablet-768.jpg). Capturas de datos ficticios exclusivamente.

Browser: selección completa y exclusión explícita del lender inválido; preview con valores del expediente y firma; CC aparece solo en el lender correcto; plantilla de campaña con campo no disponible bloquea; creación, guardado y reaplicación de plantilla; confirmación de 72 mensajes **simulados** mediante puerto falso de acción. Contador observado: 72 simulados, 0 reales. Estados vacío, carga con selector deshabilitado, error y reintento observados. Pestañas temporales cerradas y viewport restaurado.

El navegador usa HTTP simulado, no Supabase ni proveedores. La transacción de 73 correos con aplicación y cuatro extractos aprobados se prueba separadamente en SQL local, sin worker. No se presenta esta combinación como envío real extremo a extremo ni como verificación en producción.

## PostgreSQL nativo

Instalación desde 001–047 + payload aceptado 049 + 055 + candidata 056 sobre PG15 local, sin datos reales. Se comprobó que la función ampliada conserva `s01_i02.assert_sources` y `can_area`; reversa idéntica a la definición anterior y versiones intactas. Cluster temporal detenido en finally. Ninguna migración remota.

## Reproducción

Usar Node 22 soportado y dependencias existentes. `node scripts/lender-composer-qa.cjs` ejecuta la selección base offline. Para PG15: establecer `LENDER_COMPOSER_PGROOT` con el directorio que contiene `pgsql/bin` y pasar `lender-composer-pg15.test.ts` al runner. `LENDER_QA_OUTPUT` permite fijar evidencia local no sensible.

`node scripts/lender-composer-browser-qa.cjs` sirve únicamente fixtures en `127.0.0.1:3282`; no iniciar el worker. `node scripts/lender-composer-build-qa.cjs` exige LENDER_QA_OUTPUT, rechaza env reales en este checkout y usa configuración sintética. Scripts no leen .env, privados ni proveedores.

## Revisión y pendientes

Se aplicó safe-code-review al diff y sus consumidores: permisos, datos, transacción, idempotencia, compatibilidad y UX. Se corrigieron foco del diálogo inicial, refresco del selector, etiqueta/disabled/required del editor y conservación literal de reenvíos. Sin hallazgos confirmados pendientes en el incremento revisado.

Pendiente antes de uso productivo: revisión/integración del candidato contra el head compartido, confirmar reserva de 056, autorización explícita de migración/publicación, backup restringido y smoke productivo read-only. No se verificaron cuotas actuales, firmas reales ni entrega Gmail/Composio. Esos proveedores y las bases productivas no se tocaron en esta tarea. Rollback documentado en [rollout.md](rollout.md) y [rollback.sql](rollback.sql).
