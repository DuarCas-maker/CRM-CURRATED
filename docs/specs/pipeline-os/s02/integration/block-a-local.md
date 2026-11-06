# Bloque A — integración local autorizada

Resultado posterior: fuentes integradas,155 pruebas offline/TS/formato correctos. [Evidencia y limitación de build Windows](verification.md), [huellas finales](block-a-implementation.json). El plan siguiente describe el alcance ejecutado, no una ampliación a B/C o promoción remota.

31/10/2026 · SDD STRICT · Usuario autoriza integrar/probar A localmente; no B/C, proveedores, envíos, remoto, Git push o publicación. Se mantienen las decisiones y AC del paquete preparado; no hay nueva ambigüedad funcional.

Propiedad de esta ventana: coordinador sobre los28 existentes y siete nuevos de código/tests del manifiesto, únicamente en este checkout. Las39 fuentes públicas de S01 permanecen congeladas por huella; no se modifica ni se incorpora su rama completa. Base previa capturada localmente con561 archivos públicos,49 JSON operativos propios y HEAD fb9f201. S02-I01 ocho archivos protegidos. No leer env reales ni privados del otro checkout.

## Concreción técnica antes de implementar

El manifiesto preparado enumeró cuatro SQL de sandbox solo como referencias. Los tests entregados los leen desde un directorio S01 ausente en este checkout. Para entregar pruebas autocontenidas se materializan **solo como fixtures** en `tests/fixtures/pipeline-os-s01/` (mismos cuatro nombres/bytes); se ajustan sus referencias y la expectativa de45 a47 migraciones en el test importado. No son migraciones de aplicación ni instrucciones remotas.

Además se generan dos candidatos locales en `docs/specs/pipeline-os/s02/integration/migrations/`: `a-brand-foundation.local.sql` y `a-mail-permissions.local.sql`. Exigen marcador `pipeline_os.block_a_local=in_memory_test`; no están bajo supabase/migrations ni tienen número final. Se elimina captura temporal y reescritura dinámica de definiciones del candidato; las definiciones efectivas alteradas se materializan sobre001–047 y se contrastan con el resultado de los fixtures. No se modifica SQL histórico.

Nuevo test de composición `tests/pipeline-os-s02-block-a.test.ts` y, si requiere mocks aislados, `tests/pipeline-os-s02-block-a-api.test.ts`: candidato completo sobre001–047, conservación de IDs/Instantly, separación de área/fuente y guarda de despacho compuesta con la fachada Gmail real y transporte falso. Nunca ejecutar el worker como servicio. Ningún selector Composio o regla completa de marca se agrega a A.

## Verificación y salida

1. Revisar diff de28 archivos y helpers nuevos contra requisitos y llamadores; importar por contenido solo tras revalidar huellas.
2. Ensayar candidato estático y fixtures sobre bases en memoria distintas, comprobar equivalencia de catálogos/privilegios y comportamiento negativo. Reversa de sandbox únicamente en memoria; recuperación operativa futura continúa hacia adelante sin restaurar021.
3. Ejecutar tests integrados de S01 y regresión afectada por el nuevo conjunto; nuevas pruebas S01+S02-I01, TypeScript, formato y build aislado sin env/red. No repetir ensayos aceptados de proveedores, PRUEBA.csv o Bouncer.
4. Revisar diff, fuentes ajenas, contadores y evidencias. T03 solo cierra con resultados reales de estos checks. T04 remoto, B/C, SQL final y despliegue permanecen pendientes.

Un fallo de integración se corrige dentro de estos paths si está demostrado y se documenta; no se oculta con fallback de servicio o relajación de expectativas de permisos. Conservar los cambios actuales del usuario y fuentes de otros incrementos.
