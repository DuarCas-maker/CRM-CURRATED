# Verificación del SQL final PRM1

01/11/2026 · SDD STRICT · preparación local PF-T01–04 completada. [Artefacto y alcance](README.md), [aplicación pendiente](protocol.md), [manifiesto](manifest.json).

## Evidencia nueva del delta final

**16/16 pruebas nuevas correctas**, sin omitidas: `tests/pipeline-os-permission-finalization.test.ts`, bajo el guard de red offline existente. PostgreSQL 180003 de PGlite 0.5.8, Node 22.23.4. El fixture parte de 001–047 y datos ficticios, reproduce las ACL/defaults/70 grants de servicio conocidos y normaliza únicamente MAINTAIN de PG18, ausente en el destino PG15. Ese privilegio se inyecta de nuevo como caso negativo y el final lo rechaza.

| FR/AC · tarea                       | Comprobación ejecutada                                                                                                                                                                                      | Resultado                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| FR01/02/06 · AC01/02/06 · PF-T01    | SQL con contrato SHA exacto, 28 objetivos/329 columnas, 048 reservado localmente y ausencia de bypass de fixture/GRANT/DML de negocio/CASCADE.                                                              | Correcto.                                                 |
| FR01/02/05 · AC01/02/05 · PF-T02/03 | Archivo final exacto aplicado y repetido en memoria; recibo before=after; conservación de todas las filas públicas ficticias/metadata; postflight independiente coincide y preserva los objetivos.          | Correcto.                                                 |
| FR02/03 · AC02/03 · PF-T02/03       | Pérdida de servicio, flag BYPASSRLS, schema ACL o columna de Storage se detectan aunque los objetivos humanos sigan bien. Grant humano extra no queda oculto por hash protegido igual.                      | Correcto.                                                 |
| FR02/04 · AC02/04 · PF-T02/03       | Columna inesperada, drift real de cada una de las tres vistas aceptadas, MAINTAIN no observado y nueva relación subyacente abortan antes de corregir/ampliar alcance.                                       | Correcto.                                                 |
| FR02/05 · AC02/05 · PF-T03          | Fallo inyectado tras revocar revierte el cambio y no entrega recibo exitoso. READ ONLY del postflight rechaza escritura ficticia y solo consulta catálogos.                                                 | Correcto.                                                 |
| FR02/05 · AC02/05 · PF-T02/03       | pg_locks de la sesión de prueba confirma **39 AccessExclusiveLock**, exactamente la clausura de dependencias; 28 reciben DCL, once son relaciones subyacentes adicionales.                                  | Correcto localmente. No prueba contención entre sesiones. |
| FR06 · AC06 · PF-T03                | Fuentes/payload 100, 47 migraciones, herramientas/pruebas previas/PD/VR1 y 49 hashes privados operativos intactos; HEAD/index sin mutar; solo archivos finales nuevos y referencias documentales previstas. | Auditoría por hashes en manifiesto.                       |

Comando ejecutado:

```powershell
& ./.local/toolchains/node-v22.23.4-win-x64/node.exe --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test --test-reporter=spec tests/pipeline-os-permission-finalization.test.ts
```

TypeScript completo con `tsc --noEmit --incremental false`, formato, JSON, enlaces, hashes del contrato/SQL, revisión de patrones de secretos y diff comprobados. No son auditoría de seguridad integral. Las 42 pruebas PRM/VR1 anteriores y los pilotos de producto aceptados se conservan **sin reejecutarlos ni sumarlos a estas 16**. No build de app: src/worker/modelos/dependencias no cambiaron.

## Derivación y revisión propia

El SQL final se materializó desde el candidato local aceptado, que sigue intacto. La derivación valida anclas únicas antes de sustituir la guarda de fixture, insertar el contrato de columnas/vistas/footprint, verificar USAGE/servicio y emitir recibo. El bloque DCL mantiene las mismas operaciones acotadas; no se añade creación de objetos/RPC/ledger. El postflight reutiliza la misma expresión de preservación, con un contexto de lectura independiente.

Las huellas protegidas incluyen ACL no humanas/propietarios/columnas/vistas, funciones, policies, defaults, membresías y flags de roles, ACL de esquemas y metadata de Storage (columnas, constraints, índices y triggers). Se excluyen estadísticas físicas volátiles de pg_class para no interpretar vacuum como cambio de contrato. Las huellas no contienen filas reales y solo son comparables dentro de la misma base entre recibo/postflight, no entre fixture y producción por OID.

Revisión con safe-code-review y production-deployment: alcance fijo, orden/timeout de locks, precondiciones frescas, seguridad de identificadores, límites PG15/18, separación recibo/COMMIT y preservación de roles/Storage. El recibo anterior a COMMIT se etiqueta expresamente y la aceptación exige éxito completo más postflight; una respuesta perdida no produce replay automático. La documentación explicita además un ROLLBACK condicional de limpieza, sin ocultarlo en el presupuesto normal de dos scripts.

El contrato no autentica el destino; su verificación es un gate operativo. El número 048 no prueba historial ni se añadió a autodiscovery. El artefacto queda listo para revisión del SQL/protocolo, no para autorizar una escritura ignorando controles pendientes.

## Límites antes de ejecutar realmente

- SQL final correctivo **no ejecutado en PostgreSQL15 real**. PD/VR1 acreditan sus consultas READ ONLY propias; no acreditan este DCL.
- Contención entre conexiones físicas independientes pendiente. Los locks reales observados en una sesión local no la sustituyen; no se instaló otro entorno ni se ensayó bloqueo en producción.
- Destino fresco/reserva global, respaldo/restauración, ventana y exclusión concurrente deben acreditarse conforme al protocolo. No se consultaron versiones/variables/colas actuales ni se creó backup.
- Publicación A/B/C, imagen/worker, bootstrap y activación continúan fuera de este incremento. No se copió 048 a supabase/migrations, ni se cambiaron los fixtures base47 para aparentar compatibilidad.

PF-T01–04 preparados/verificados localmente; G6 y aplicación real no autorizados, gates operativos de ejecución pendientes. **Instantly 43 consumidas/0 nuevas; 0 APIs, SQL remoto, cambios de configuración en vivo, envíos, verificaciones pagas, push o deploy.** Gmail directo y Composio conservan su estado de alcance; no se reconsultaron flags.

Siguiente paso: acreditar los controles operativos pendientes y revisar la autorización concreta del protocolo; no ejecutar todavía los archivos SQL.
