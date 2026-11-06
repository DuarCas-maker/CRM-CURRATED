# Diseño SQL final A/B/C

**Revisión AF-EOL-r1:** [ADR y alcance](line-endings/spec.md). El snapshot mantiene MD5 crudo. El comparador final admite solo117 pares exactos LF/CRLF por firma; la huella de preservación proyecta exclusivamente2 pares conocidos, dejando el resto de metadata y fuentes no admitidas intactos. No normalización genérica o modificación de prosrc/literales. Las reglas de preservación y abortos siguientes siguen vigentes con esa excepción explícita de serialización verificada.

## ABC-F-ADR01 — una migración coherente

Se propone 049 para A foundation → A permisos → B1 → B2 → C1/C2 dentro de BEGIN SERIALIZABLE/COMMIT. Las cinco transacciones de fixture se sustituyen por una envoltura de release; los cuerpos y el orden se mantienen. Evita commits intermedios con permisos nuevos y consumidores incompatibles. La alternativa de cinco migraciones reduce el tamaño de cada script, pero permite estados intermedios productivos; se descarta para este corte coordinado. No hace compatible al worker viejo: requiere pausa operativa acreditada antes de aplicar.

## Derivación y contrato

Partir de base001–047 + SQL048 exacto, únicamente en memoria para QA. Fuente de permisos deseados: los mismos cinco candidatos con defaults de creador limpios. Fuente de prueba adversa: owner supabase_admin/defaults amplios y grants service_role observados, conservando el modelo de roles reales. La comparación identifica funciones, relaciones, columnas, policies, triggers, índices, constraints y esquemas del delta. Las definiciones se fijan en contrato lógico, sin OIDs o filas/cuerpos reales en la salida.

La normalización de ACL se limita a objetos nuevos/modificados del delta y PUBLIC/anon/authenticated/service_role, con tabla/columna/EXECUTE/USAGE explícitos. Mantener grants de otros roles y objetos fuera del delta; no ALTER DEFAULT PRIVILEGES global. Los derechos service_role heredados en funciones existentes se conservan salvo los cierres explícitos aceptados de B/C. Inventariar la intersección con las 70 diferencias, no inferir falta de uso por ausencia de caller literal.

Las precondiciones se contrastan antes de DDL y bajo locks ordenados de las relaciones base afectadas. Abortar ante objeto previo, drift, actor/contexto incorrectos o estado parcial. Lock timeout 2s y statement timeout 15s; no aumentar en producción por un fallo. Los locks implícitos/FK y contención independiente siguen necesitando ensayo; la lista explícita no se presenta como todo el footprint real.

La instantánea SERIALIZABLE no se refresca al tomar locks: esto no detecta por sí solo todo DDL concurrente confirmado después del snapshot. La exclusión externa de DDL/DCL es condición obligatoria, no sustituida por el segundo contraste. La resolución temporal de tipos históricos usa pg_catalog,public,pg_temp tras rechazar CREATE en public para los roles de aplicación; las consultas de comprobación vuelven a pg_catalog,pg_temp.

La instantánea de metadata lógica permite huellas de preservación fuera de objetos modificados, roles/membresías/defaults y metadata Storage excepto las dos policies de acceso de A expresamente incluidas. No se recrea Storage ni se leen blobs. Las huellas no certifican filas, respaldo o identidad de destino. Los hashes de funciones base pueden aceptar las variantes crudas de fuente de PD-R1 ya revisadas y las del fixture, sin normalizar/reemplazar literales durante aplicación. Si un deparser PG15 difiere de la referencia PG18 en otra huella, abortar; no relajar el contrato para forzar producción.

Postflight independiente READ ONLY compara contrato final completo y huella de preservación con el recibo de aplicación. No invoca RPC de negocio, no devuelve correos/credenciales/IDs de clientes o fuentes de funciones. Un script completo con Success y postflight conforme son evidencias distintas. Sin replay automático; recuperación hacia adelante y servicios controlados.

No se modifican app/worker, 001–047, 048, candidatos, fixtures previos o manifiestos históricos. El soporte de instalación/autodiscovery de 048/049 se prepara posteriormente; copiar archivos a supabase/migrations ahora rompería presupuestos base47 de fixtures y sería otro incremento.
