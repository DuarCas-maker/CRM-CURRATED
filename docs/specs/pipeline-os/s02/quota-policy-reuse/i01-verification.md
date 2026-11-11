# I01 — resultado offline

10/11/2026 · SDD STRICT · HEAD00b00937b8de7eea1966a6b2c3189bf1c9db8023. Alcance autorizado: dos archivos nuevos más documentación QGR de su implementación. Las decisiones de negocio se conservan; no surgieron nuevas preguntas.

## Resultado y archivos

- `src/lib/mail-quota-policy.ts`: contrato estricto v2, metadato Google opcional sin procedencia inventada, techos locales, estado explícito y resolución pura de grupo/cuenta. No importa módulos de producto, IO ni env.
- `tests/pipeline-os-s02-quota-policy.test.ts`:21 casos con datos ficticios; fetch bloqueado antes de importar el módulo, contador0 al cerrar.
- Documentación: contrato concreto previo a código, esta evidencia y actualización acotada de spec/design/tasks/manifest/verification. Sin cambios en presupuestos o configuración privada.

El módulo no reserva consumo, aplica ventanas en DB, verifica identidad/permisos, habilita un writer o conecta un buzón. No hay caller en src/worker. Resolver un scope no constituye autorización de cuenta ni prueba de saldo.

## Comprobaciones ejecutadas

Runtime local Node22.23.4, dependencias ya instaladas. Comandos desde raíz, invocados con el ejecutable local de Node, sin cargar env:

| Check | Comando después del ejecutable Node | Resultado |
| --- | --- | --- |
| Pruebas nuevas | `--import tsx --test tests/pipeline-os-s02-quota-policy.test.ts` |21/21,0 fallos,0 omitidas;0 fetch |
| TypeScript | `node_modules/typescript/bin/tsc --noEmit --incremental false` | exit0, sin errores |
| Formato | `node_modules/prettier/bin/prettier.cjs --check src/lib/mail-quota-policy.ts tests/pipeline-os-s02-quota-policy.test.ts` | ambos correctos |
| Preservación | SHA256 contra baseline y protectedSources de manifest.json |960 tracked,15 untracked previos y20 fuentes específicas intactos |
| Integración accidental | búsqueda en fuentes src/worker, excluyendo el propio módulo |0 referencias de producto |
| Diff | `git diff --check` y revisión de los archivos nuevos | exit0; sin hallazgos confirmados en este alcance |

Se aplicó safe-code-review al cambio: entradas inválidas/estados, exposición de errores, coherencia de límites, claves estables, mutabilidad, compatibilidad y alcance de imports. No hay nuevos endpoints, autorización, SQL o concurrencia que certificar en I01. La inspección de fuentes protegidas acredita preservación; no es una repetición de pilotos aceptados.

## Trazabilidad y límites de cobertura

| FR / AC | Evidencia pura I01 | Pendiente |
| --- | --- | --- |
| FR01 / AC01 | v2 admite ausencia/null/unknown; procedencia revisada requiere identificador explícito | registro candidato y UI v2 |
| FR01/07 / AC02,14 | rechaza v1, discriminante falso/campos heredados y no muta inputs | migración y compatibilidad DB/lector legado |
| FR02 / AC03,04 | grupo literal común a proveedores/Auth Configs/cuentas; cuenta canónica diferenciada | reserva compartida multiconexión |
| FR03 / AC05 | disabled es configuración válida pero resolver la rechaza; no hay caller nuevo | transición/habilitación y regresión de fachada |
| FR03 / AC06 | grupo estable al reemplazar política/generación/metadato; ventana fija sin coerción | continuidad real de uso histórico en SQL |
| FR03 / AC07 | snapshot de referencias/límites inmutable, resolución determinista, errores saneados | deadline, replay y revalidación después de esperas |
| FR08 / AC16,17 | fuentes protegidas conservadas, solo2 archivos de producto nuevos,0 callers | integración futura con F2 |

No se marca completo ninguno de los20 AC end-to-end por estas pruebas unitarias. FR04/05/06/09/10 y AC08–13,15,18–20 no se ejecutaron operativamente. I02–I06 siguen pending.

## Invariantes y siguiente paso

Gmail directo y su módulo de cuotas actual intactos; Composio productivo siguefalse; Instantly43/0 nuevas. Sin llamadas de proveedor, mensajes, instalaciones, servicios, SQL local/remoto, cambios en Coolify, push o deploy. No se leyeron env reales ni se tocaron otros worktrees.

Pendientes: reserva/contadores/rollback PG15, adaptador C2 con grants efectivos documentados, conciliación Connect F2, UI y presupuesto/cupo real. No se ejecutaron build o suites aceptadas del producto porque el módulo está aislado y no cambia sus callers.

Siguiente alcance: preparar/implementar I02 por autorización propia, con SQL aditivo y pruebas PG15 de reservas/compatibilidad/carreras. Ninguna migración debe ejecutarse en producción para completar I01. Rollback local de I01: retirar solo estos dos archivos nuevos y su registro documental, sin tocar WIP ni datos existentes.
