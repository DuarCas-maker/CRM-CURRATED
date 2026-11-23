# Diseño y ADR-REC001

Arquitectura: todos los lectores actuales consultan mail_conversations_visible; su función interna materializa un conjunto autorizado y redactado. Se conserva ese contrato y se reemplaza únicamente la implementación de visible_conversations(). No hay endpoint/RPC expuesto nuevo ni adaptación frontend.

Usar CTE MATERIALIZED con IDs distintos de expedientes y resultados de can_case, can_area para las tres áreas y la expresión original de can_reply. Consultar las tablas con el mismo propietario definer. La selección lateral de último mensaje usa las banderas del expediente, conserva ORDER BY sent_at DESC,id DESC LIMIT1 y las15 columnas originales. Incluir una conversación solo si can_case y existe mensaje visible, o está vacía y su área está autorizada. Esta condición es equivalente a can_conversation, sin volver a recorrer mensajes para determinar visibilidad. Los auxiliares originales permanecen intactos para todos los otros consumidores.

Concurrencia/consistencia: funciones STABLE y mismo snapshot de la sentencia; no caché entre usuarios/peticiones. NULL de área no es posible por constraints actuales; los CASE enumeran general/seller/closer explícitamente y no convierten un área desconocida en permiso. Los errores siguen propagándose.

Referencias primarias PostgreSQL15: [MATERIALIZED evita repetir evaluaciones](https://www.postgresql.org/docs/15/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION), [STABLE conserva resultados dentro de una sentencia](https://www.postgresql.org/docs/15/xfunc-volatility.html). La equivalencia concreta se comprueba con las funciones y los datos ficticios del fixture; no se deduce solo de la documentación.

Alternativas: nuevo índice no resuelve el filtro externo/repetición; RPC acotado requeriría cambiar múltiples lectores y sigue costando con catálogos completos; inlining al retirar SECURITY DEFINER rompe los privilegios de columnas/redacción. Se prefiere materialización interna para conservar el contrato de todos los consumidores. Si el benchmark no mejora, no aplicar esta alternativa.

Seguridad: sin nuevos grants/roles, sin cambio de decisiones de negocio ni access tokens. Preflight pin de prosrc observado, contrato, vista y ACL; backup privado de definición y catálogo antes de escribir. La migración debe preservar todos esos atributos. Sin datos de clientes en pruebas ni evidencia.

Pruebas: fixture PostgreSQL embebido sin red con definiciones diagnosticadas, datos ficticios y permisos del repo; comparación completa antes/después, plan/benchmark, negativos de MFA/anon/ajenos, apply/rollback/reapply y catálogo. PGlite no sustituye PostgreSQL15 productivo; documentar esa limitación y verificar el plan real tras aprobación. No aplica regenerar tipos: no cambia firma ni modelo.

Rollout: publicar la migración versionada propia después de verificar main actual; no editar049/050/055. Tras aprobación, respaldo privado de la única función, transacción corta, comprobar catálogo, GET y tres SSR. Si difiere la fuente o cambia un atributo de seguridad, abortar. Reversa: restaurar exclusivamente la definición respaldada si el hash nuevo sigue vigente; no revertir commits de terceros, datos o volúmenes.

Ubicación: release SQL059 y rollback en esta carpeta, siguiendo049/050/051 bajo docs/specs (prerrequisitos ya presentes en producción). No agregarlo a la cadena001–058 aislada, que no instala049/050 y aún se usa para caracterización histórica. La ejecución falla cerrada si falta la función; nunca registrar como aplicada una optimización omitida. El instalador completo debe ordenar049/050/055/059; no modificar ese instalador fuera del alcance.
