# Alcance y requisitos — AF-PG15-r1

**Continuación autorizada PG-EXEC-r1:** [implementación del ejecutor y AC offline](executor-spec.md), [verificación](executor-verification.md). Se implementa PG-T03 sin adquirir/arrancar el motor o ejecutar el ensayo nativo. Las restricciones de la planificación inicial posterior conservan ese alcance histórico, extendido únicamente por esta instrucción humana de implementación offline.

04/11/2026 · SDD STRICT por DDL/permisos/recuperación sobre datos existentes. **Modo: planificación/preparación**, sin implementación del ejecutor ni ejecución de bases. Solicitud confirmada: preparar el ensayo de049 y postflight en PG15 aislado; conservar43/Gmail directo/Composio deshabilitado y no hacer llamadas reales, cambios remotos o deploy.

## Clarificación cerrada para esta preparación

No hay nuevas reglas de negocio: D01–D24 y A/B/C siguen aceptadas. El preflight del operador ya es conforme. El análisis del repositorio demuestra que el fixture actual depende de PGlite18 y que el motor nativo no está disponible en las rutas examinadas. Se propone un cluster local desechable; disponibilidad/procedencia del paquete y ejecución quedan como requisitos previos, sin asumir permiso para instalar/descargar o usar otro host. La elección técnica portable evita introducir ahora un proveedor/entorno remoto o dependencias de producto. No se pide repetir preguntas contestadas.

| FR      | Requisito                                                                                                                                                                                                           | AC                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| PG-FR01 | Entorno nativo15.x exclusivo, datos sintéticos, conexiones locales explícitas y dos sesiones físicas para concurrencia. Rechazar cualquier destino no acreditado antes de escribir.                                 | PG-AC01/02          |
| PG-FR02 | Ejecutar049 y postflight exactos, vinculados al contrato y fuentes aceptadas, sobre base001–047 +048 reproducida. Abortar ante incompatibilidad, sin relajar hashes o regenerar el artefacto para obtener un verde. | PG-AC03/04          |
| PG-FR03 | Comprobar preservación, permisos/RLS/MFA y negativas de drift/sending/parcial/replay en clones ficticios. No reanudar legacy/uncertain ni inferir marcas por dominio.                                               | PG-AC05/06/07/08/09 |
| PG-FR04 | Comprobar rollback ante fallo tardío, bloqueos/timeout entre backends y recuperación de un respaldo sintético, preservando identidad e intentos.                                                                    | PG-AC10/11/12/13    |
| PG-FR05 | Registrar versiones/collation, hashes, códigos SQLSTATE, filas preservadas mediante huellas y evidencia entre sesiones; separar DDL PG15 de compatibilidad de binarios.                                             | PG-AC14/15          |
| PG-FR06 | Mantener las43 peticiones, Gmail directo activo y Composio deshabilitado. No APIs, datos/credenciales productivos, app/worker, SQL remoto, publicación o instalación por esta preparación.                          | PG-AC16             |

## Límites y riesgos

- PG15.x y minor fijados antes de ejecutar; referencia productiva recibida150008. Si la versión menor/OS/collation difieren, declararlo en resultados y no afirmar paridad exacta con Linux/producción. No instalar extensiones de red ni iniciar schedulers o servicios del CRM.
- Timeout del artefacto15s/locks2s intactos. Esperas del controlador con plazo propio y cierre dirigido de sus backends; no sleeps indefinidos, kill global o retry automático.
- Preservación de datos del ensayo verificable; no prueba volumen/carga o restauración de backup productivo. Auth/Storage mínimos simulan contratos SQL y no equivalen al stack Supabase completo.
- Preflight aceptado no se repite remoto. Su reloj/estado de cola no acredita frescura futura o pausa persistente del worker.
- Compatible con esta preparación: leer archivos y escribir documentos/hashes propios. Ejecutor/SQL de soporte nuevo, runtime, cluster, descarga, prueba nativa y controles externos requieren su siguiente alcance explícito. Las migraciones049/048 y postflight quedan sin cambios.

No objetivos: corregir producto durante el ensayo, actualizar defaults globales, crear marcas/relaciones reales, hacer bootstrap remoto, agotar remanentes S00, desplegar o declarar cerrados visual/build/instalador/cutover. Una desviación PG15 se registra y pasa a un incremento acotado antes de modificar contrato/comparador.
