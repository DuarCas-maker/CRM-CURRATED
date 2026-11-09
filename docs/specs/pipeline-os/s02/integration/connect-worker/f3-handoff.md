# Conciliación F3 y encargo T-007-R1

08/11/2026. El coordinador recibió la entrega F3-OPS-PILOT-20261108-v1.1 y revisó integration-manifest.json/control-review.md del worktree ef2d. No editó ni ejecutó su checkout. Esta asignación queda visible al usuario; no se ha enviado un mensaje de respuesta a F3.

## Alcance asignado

T-007-R1 es **revisión de la evidencia y los huecos del control ya implementado**, no una segunda implementación. WC-I01 es propiedad del coordinador. F3 conserva escritura exclusivamente en docs/specs/pipeline-os/operations-pilot/** de su propio worktree. Sin transferencia de producto, SQL, worker, rutas, manifests compartidos o propiedad de archivos. Base Git 50d2f916788c73c831d6e0ebe1cf29a1e9d6340a más delta CW-I01 identificado por manifest.json de esta carpeta; no igualar ramas ni copiar .local/env/node_modules.

Leer las fuentes públicas identificadas por ese manifiesto y WC-I01; contrastar CTRL-001–011 con sus tests y evidencia. Entregar una matriz: cubierto localmente, cubierto parcialmente, no probado, requisito operativo. Citar test/ruta exactos y formular únicamente las pruebas faltantes. El recibo nativo T-002 de F2 es evidencia de otro incremento; no atribuir a WC concurrencia física PG15.

El techo es documental: no iniciar web/worker/DB, instalar dependencias, generar OAuth, ejecutar APIs/SQL remoto, enviar mensajes, editar producción, commit/push/deploy o reanudar operaciones. Cualquier runtime/QA visual futuro requiere su alcance concreto; esta revisión no obliga a repetir las pruebas aceptadas de recepción, adjuntos o importación.

## Conciliación de propuestas

| Propuesta F3            | Delta disponible                                                                                                                       | Hueco que debe conservarse explícito                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-001 ejecución         | WC modo pilot excluye productores generales, claim exacto, lease único y barrera sobre outbox reservado.                               | Un proceso antiguo/normal o escritor web no queda detenido por esa variable. Pausa/drenado, réplicas y autoarranque reales aún requieren evidencia operativa. |
| P-002 presupuesto/OAuth | Guardas antes del token, reserva durable antes del wire, renovación OAuth piloto sin retries ocultos, pruebas de agotamiento y cierre. | Concurrencia física de reservas WC y sobre real Composio no acreditados. No heredar propuesta Gmail20+1.                                                      |
| P-003 visual            | Sin reconstruir módulos aceptados; revisión del delta A/B/C y luego alta/operación nueva.                                              | QA visual/teclado ES/EN a360/768/1280, build Linux y compatibilidad del despliegue siguen pendientes.                                                         |

La elección BUZON-01 + un envío CRM + una respuesta manual se conserva como alcance documental. El usuario eligió alta **y operación Composio** para lanzar: adaptar el protocolo a R05/R06 una vez exista el selector. No dar por ejecutado un piloto directo ni por aprobado tráfico Composio. R02 asignaciones reales, R03 microensayo y R04 reanudación continúan siendo etapas diferentes.

Salida esperada: revisión T-007-R1 en su carpeta, manifiesto de cambios documentales y pendientes priorizados; sin declarar piloto o producción aceptados. Los controles desarrollados por el coordinador no deben duplicarse.
