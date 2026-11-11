# Paquete I05 / 052

Preparado localmente. **No aplicado ni publicado.** Ver [runbook](runbook.md) y
[verificación](verification.md) antes de proponer cualquier ejecución remota.

| Archivo                                              | Uso posterior                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `preflight.sql`                                      | Una lectura de catálogo/cola en el CRM correcto, con autorización                             |
| `052_integrate_mail_quota_and_existing_bindings.sql` | Aplicación única completa, BEGIN→COMMIT, solo después de preflight coincidente y autorización |
| `postflight.sql`                                     | Lectura independiente que acredita el catálogo persistido                                     |
| `cleanup.sql`                                        | Solo ROLLBACK de la sesión fallida; no aplica cambios                                         |
| `rollback-disabled-unused.sql`                       | Reversa conservadora sin borrar datos; se niega si el incremento fue utilizado                |
| `contract.json`                                      | Contrato y hashes sellados; no reformatear tras generar SQL                                   |
| `sources.json`, `manifest.json`                      | Fuentes comunes y evidencia; no son un commit o despliegue                                    |

Los archivos `prepare.mjs`, `run-prepare.mjs` y `bundle-build.mjs` son herramientas
locales de preparación/ensayo. No se pegan en SQL Editor ni se ejecutan en el VPS.
La 052 incluye únicamente I02/I03/I04-A/R. No se vuelve a ejecutar048–051.

Gmail directo se conserva, el worker continúa pausado, la política no se publica,
los flags nuevos quedan apagados y Composio operativo sigue en false. Instantly43;
ninguna petición de proveedor, envío, verificación paga o token real usado.
