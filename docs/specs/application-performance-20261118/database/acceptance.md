# Aceptación

- AC-DB-001: dado el lookup real por contacto/imported, antes falta el acceso específico y después el plan local usa el índice parcial; no aumentar statement_timeout para ocultar el problema.
- AC-DB-002: dado el mismo estado y reloj transaccional, los JSON de workspace_stats son iguales para cada rol/MFA antes y después. Las políticas y las funciones conservan sus huellas; anon continúa sin ejecutar el RPC.
- AC-DB-003: dada aprobación explícita, comprobar respaldo y target; crear solo el índice propio. Reportes debe terminar sin timeout en pruebas reales posteriores. Si no mejora, informar y continuar el diagnóstico; no declarar la consulta arreglada solo porque el índice existe.
