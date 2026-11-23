# Evidencia

22/11/2026. Diagnóstico real autenticado: Pipeline OS cae en su error boundary; Board→statement timeout; Workspace→JSON correcto. Registros del servidor: pipeline_os.mail_metadata, SQLSTATE57014, dos ocurrencias. Captura original del usuario y reproducción coinciden; no se almacenan datos de clientes.

Pendiente: regresión roja/verde, suite relacionada, typecheck/build, publicación y recuperación real. Métricas previas del18/19 no se usan como evidencia de disponibilidad actual.

Regresión: Board y Master fallaron en2d4c6fa con el mismo message, operation pipeline_os.mail_metadata y code57014 del log productivo. Tras retirar el sondeo,22/22 pruebas iniciales correctas, incluida Tareas que conserva un único conjunto interno de correo por lotes y los351 casos ficticios. No se atrapó el error para devolver ceros; se eliminó la consulta amplia.

Regresión ampliada:124 pruebas correctas de la suite principal; el único fallo fue la invocación del test de adjuntos sin activar mock.module (no una aserción del producto). Repetido ese archivo con su comando documentado --experimental-test-module-mocks y simple-mail-register:10/10 correctas, cero omisiones. Son134 checks correctos entre ambas ejecuciones sobre el mismo candidato. Se preservan cuentas/correos únicos y autorización/cuotas de adjuntos de main actual.

TypeScript correcto. Build Next16.3.8 aislado con Node22.23.4 correcto,60/60 páginas; sin env reales ni dependencias nuevas. Revisión del diff/whitespace correcta: únicamente retiro del helper/callers y regresiones; no cambian columnas, reglas financieras, permisos, funciones SQL, worker ni fuentes posteriores de correo/adjuntos. Main2d4c6fa comprobado antes de publicar. Cierre productivo aún pendiente.

Publicación7972157 completada (Coolify Finished, healthy al primer intento, rolling update completo). Postflight no aceptado: dos GET Board devuelven57014, aproximadamente10093ms y9746ms incluyendo navegador. SSR también cae; log nuevo workspace_read registra8695ms, mail_conversations_visible8074ms/57014. La eliminación del sondeo no basta: la función que implementa la vista sigue procesando el conjunto completo detrás de los filtros. No se declara recuperado. Preparado diagnóstico exclusivamente de catálogo y EXPLAIN sin ANALYZE, pendiente de autorización específica para reutilizar credenciales del env real.
