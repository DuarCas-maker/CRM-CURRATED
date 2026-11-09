# Verificación CW-I01

08/11/2026 · SDD STRICT. Integración local, sin activación. [Manifiesto](manifest.json), [corrección](bugfix.md), [conciliación F3](f3-handoff.md).

**101 pruebas/casos y grupos correctos, cero fallos, una prueba nativa omitida deliberadamente (102 enumeradas por Node).** De las ejecutadas, 14 pertenecen a la composición nueva y 87 a WC-I01/transporte/B2/C3/uso Gmail. No sumar de nuevo el ensayo previo de 14 ni los 18 de F2. Node22.23.4, red real bloqueada por preload, dobles de DB/proveedor en los tests que los requieren. TypeScript --noEmit --incremental false correcto tras tipar explícitamente el catálogo de la fixture.

| Tarea / aceptación | Evidencia                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T01 / AC01         | Tres archivos T-002 cotejados y copiados por SHA256/bytes; recibo público de origen conservado. Dos permanecen exactos; la SQL recibe exclusivamente CW-FIX01. Ningún archivo parcial T-003 incorporado.                                                                                                                       |
| T02 / AC02–03      | worker-onboarding-composition.test.ts, seis escenarios en cada orden de instalación y dos grupos: reversión DDL conjunta, funciones/ACL base intactas, ausencia de DML directo para anon/authenticated/service_role, alta observada/materializada inactiva, revocación de sesión, claim exacto WC y rotación de configuración. |
| T03 / AC04         | Regresión falla con la versión original; pasa con el predicado atómico. Instrumentación solo en memoria y definición restaurada, con alcance explícito en bugfix.md.                                                                                                                                                           |
| T04 / AC05         | Selección de nueve archivos, TAP/registros privados y huellas en manifest.json. Conservación de fuentes históricas, SQL aceptada, privados operativos y archivo de fuentes; checks de formato/diff.                                                                                                                            |
| T05                | F3 revisado; T-007-R1 asignado como revisión documental del control existente y sus huecos, sin duplicar implementación. No se envió respuesta a ese chat.                                                                                                                                                                     |

## Límites de la evidencia

La entrega original F2 reporta 18/18 en PostgreSQL15.19 con concurrencia física y rollback aditivo. Se conserva su recibo **como evidencia de origen**, no una nueva ejecución del coordinador. Su harness nativo se incorpora intacto y queda omitido por defecto; no se inicia PostgreSQL, instala herramienta o accede al runtime privado F2. El overlay CW-FIX01 y la composición WC aún requieren comprobación nativa combinada.

La fixture usa PGlite y Auth/sesiones/JWT ficticios; adapta solo la guarda de host en memoria, sin editar la guarda nativa de disco. No valida firma JWT ni compatibilidad del Auth real. No acredita HTTP/OAuth, rutas, panel, flujo T-003, selección productiva R06, imagen Linux, QA visual o un piloto real. Las tablas nuevas y RPC son candidatos de ensayo, no SQL para pegar en producción.

Gmail directo conservado, Composio deshabilitado, Instantly43/0 nuevas. Sin llamadas reales, mensajes, cambios de configuración viva, SQL remoto, commit/push o deploy. No se repitieron048/049 ni pilotos aceptados.

Siguiente integración: incorporar la orquestación terminada de F2 cuando se entregue y conectar adaptador/rutas/panel; después resolver R06 por buzón y preparar SQL final/QA del delta. La autorización general de producción del usuario permanece vigente; este paquete todavía no está completo para publicarse como versión operable.

Último snapshot de F2 al cierre: T-003 está planificado y el chat permanece idle esperando autorización de sus cuatro archivos nuevos. No se incorpora como implementación ni se responde por el usuario. T-002 permanece terminado.
