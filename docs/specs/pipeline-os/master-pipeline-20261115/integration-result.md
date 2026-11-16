# Master Pipeline · integración y preflight productivo

16/11/2026 UTC, correspondiente a la noche del15/11/2026 en Bogotá. El usuario autorizó integrar el candidato y validar las lecturas con permisos reales antes de publicarlo. Se integraron sus13 archivos en `codex/master-pipeline-release-20261115`, partiendo de01b6d3f y conciliando después `70c1efb65f541d53fcaca7ea7a37c967c54afa46`, sin incluir WIP de otros frentes. El único cambio nuevo de esa base es Referrer-Policy same-origin en next.config.ts: se conserva y no forma parte del delta Master.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Huellas del candidato/parche/base | Los13 archivos coinciden con el manifiesto revisado; se conserva el checklist y la recuperación Connect de la base. |
| Regresión integrada | 85/85 pasan, cero fallos/omisiones: Master, módulo existente, checklist, revisión de correo y recuperación Connect. |
| Tipos y build | Build Next16.3.8 webpack exit0, TypeScript completo correcto, 51 páginas estáticas y nuevo GET compilado. Variables ficticias y guard offline; sin instalar dependencias. |
| Catálogo productivo | 15 relaciones, todas las columnas seleccionadas presentes y con SELECT para authenticated; metadatos de políticas y funciones capturados sin cuerpos de clientes. |
| Sesión HTTP real | `/api/workspace` responde con workspace real, perfil activo superadmin. Su `requireUser()` vigente exige usuario validado y aal2. No se extrajeron cookies/JWT ni se guardaron registros. |
| Control de MFA en SQL | Con sujeto existente y rol authenticated, pero sin aal, el rol de aplicación fue nulo. No se trató como lectura positiva ni se relajó el guard. |
| Proyecciones con RLS productivo | 15 consultas válidas bajo rol SQL authenticated y el contexto del único perfil activo, reproduciendo aal2 ya validado por separado. Transacción READ ONLY y ROLLBACK, máximo una fila por proyección y solo su conteo como resultado. |
| Volumen del alcance | Conteos agregados para el alcance actual/default30d por debajo del límite100000. No se descargaron filas de clientes para este ensayo. |

Evidencia: `evidence/catalog-readonly.json`, `auth-preflight.json`, `rls-readonly.json`, `scope-counts.json`, `integrated-tests.log`, `integrated-build.log` y `release-readiness.json`. Las plantillas SQL públicas sustituyen el UUID del perfil por ceros; no son tokens ni scripts para crear identidades.

## Qué acredita cada prueba

La sesión HTTP es una sesión real del usuario. La comprobación SQL utiliza las políticas/grants reales y una reproducción temporal de ese contexto de autorización dentro de la transacción; **no es una segunda sesión JWT ni una autenticación de otro usuario**. No se fabricó un token, no se creó/verificó un factor MFA y no se cambiaron usuarios, permisos, tablas o funciones.

El catálogo contiene un solo perfil activo, superadmin. Por tanto no se acreditan sesiones reales de seller/closer ni aislamiento entre dos usuarios productivos. Esos escenarios siguen cubiertos por las pruebas offline con fixtures; no se activaron perfiles para fabricar evidencia. Ofertas y revisiones de ofertas tienen cero filas visibles en el catálogo actual: esa ausencia es dato válido, no un fallo que se complete importando el HTML.

La primera consulta de ensayo no devolvió la selección final porque postgres-meta reporta el primer SELECT; se corrigió la composición del ensayo usando SET LOCAL. El ensayo siguiente, sin aal, confirmó el cierre de la política MFA. La comprobación positiva posterior reprodujo explícitamente el contexto aal2 de la sesión HTTP ya validada. Los ocho pedidos SQL de catálogo/identidad/ensayo/conteos fueron de solo lectura; ningún RPC de negocio ni operación Auth administrativa.

## Pendiente de publicación

El GET nuevo de Master todavía no está publicado. Su HTTP autenticado completo y la UI real se comprobarán como postflight del despliegue autorizado; no se da esa verificación por realizada mediante los tests simulados o las consultas SQL.

La integración no cambia SQL, variables, worker, proveedores, cuotas o envíos. La versión web anterior70c1efb es la referencia de recuperación. El modo normal del worker pertenece a otro frente y se conserva. El runbook de promoción concreta está en `publication-runbook.md`.
