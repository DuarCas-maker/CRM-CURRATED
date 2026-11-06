# Bloque C — asociación técnica de cuentas Composio

Versión conjunta ABC-20261031-prep1 preparada31/10/2026: [runbook y cierre de QA](../../release/runbook.md).100 fuentes conciliadas (63 aplicación/32 pruebas/5 SQL de ensayo),5 comprobaciones nuevas del catálogo READ ONLY en memoria;139/139 C3 heredadas con las mismas fuentes, no reejecutadas. No publicable aún: catálogo/QA visual/build/PostgreSQL/migraciones finales/control del worker pendientes. Próximo paso REL-T03: lectura autorizada del catálogo y metadatos, no SQL de cambio o deploy. Producto/47 SQL/49 registros operativos/HEAD intactos; Gmail directo activo, Composio deshabilitado e Instantly43/0 nuevas. Las constancias previas conservan su alcance histórico.

31/10/2026 · SDD STRICT · **C1/C2/C3 funcionales y probados localmente; promoción y QA pendiente explícita.** Base: S02-I01+A+B1+B2 locales; [B2 y sus límites](../block-b/b2-verification.md). Gmail directo permanece como único transporte activo. Composio deshabilitado e Instantly43; presupuesto externo de esta preparación y del primer incremento offline: **0 peticiones**.

El objetivo es guardar dentro del CRM qué conexión Composio corresponde a cada cuenta existente, con identidad comprobable y revisión. Los buzones ya conectados en Composio no necesitan otra autorización de Google para preparar este bloque. Asociar no crea una cuenta duplicada, cambia marca/permisos, inicia sync o selecciona un transporte.

| Incremento                 | Entregable verificable                                                                                                               | Límite                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| C1 — registro y revisión   | Persistencia aditiva, comandos superadmin/MFA, API de cuenta y sección en Configuración; candidatos, revisiones y errores claros.    | Solo fixtures/SQL en memoria; sin evidencia válida no puede quedar verificado.            |
| C2 — verificador offline   | Comprobador de conexión/configuración/identidad con dependencias falsas, evidencia ligada a versiones y aprobación humana posterior. | Sin lector de claves, fetch global, ruta de ejecución real o conversión a binding activo. |
| C3 — composición y entrega | Matriz de permisos, carreras, recuperación local y preservación de A/B/I01/Instantly.                                                | No repite pilotos aceptados; no publica ni activa nada.                                   |

**Siguiente paso concreto:** preparar la versión conjunta A/B/C y el plan de cierre de gates INT-T04/T00-02-I, sin publicar automáticamente. [Entrega C3](c3-verification.md):14 nuevas/125 regresión/TS correctos; producto/SQL C1/C2 intactos. C no está desplegado. Verificación real, fuente productiva de configuración y corte siguen requiriendo sus protocolos/autorización.

Documentos C3: [concreciones](c3-local.md), [verificación](c3-verification.md), [huellas](c3-implementation.json).

Documentos C2: [concreciones](c2-local.md), [verificación](c2-verification.md), [huellas](c2-implementation.json).

Documentos: [alcance](spec.md), [diseño](design.md), [aceptación](acceptance.md), [tareas](tasks.md), [decisión](adr-004-evidencia-sin-selector.md), [promoción y recuperación](rollout.md), [verificación de esta preparación](verification.md), [metadatos de preparación](preparation-report.json), [resultado C1](c1-verification.md), [huellas C1](c1-implementation.json).

Pendientes heredados de promoción: catálogo/RLS/Storage/legado/versiones T00-02-I, QA visual/teclado, build standalone completo y contención PostgreSQL multiconexión. Preparar o implementar C offline no acredita esos gates ni cierra S00/S02.
