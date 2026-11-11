# I04 — verificación

Estado actual: A/R implementado y probado offline; [aceptación y diseño](i04-implementation.md).
248 pruebas/subpruebas reportadas entre los tres grupos (236+1+11),0 fallos.
El manifiesto registra huellas, salidas, revisión de TypeScript/formato y límites.
Los resultados históricos de preparación se conservan a continuación como antecedentes.

## Registro histórico: preparación

10/11/2026 · STRICT · modo planificación. [Plan/FR/AC/T/ADR](i04-plan.md),
[manifiesto](i04-manifest.json). No constituye evidencia de implementación I04.

## Qué se revisó

DTO/comandos/página v1, componente de asociaciones, ruta GET/POST, servicio C2,
provider/verificador I03/tokeninfo, restricciones SQL local I02, cuotas/admisión I03,
contratos/snapshot/ticket/runtime/proxy y scheduler/worker. Se inspeccionaron archivos
públicos del coordinador; no env reales, contadores/adjuntos o datos de otro checkout.

Hallazgos que determinan el alcance:

1. La UI registra/revoca, pero no expone comprobación y confirmación del verificador
   v2. La ruta actual tampoco compone ese check.
2. La constraint local v2 bloquea verified y los check/receipt/DTO v1 no se pueden
   reinterpretar. Requiere evolución versionada con evidencia/autorización, no solo UI.
3. Los readers runtime/proxy todavía requieren quotaProjectId. I04-R debe adaptar
   ese contrato sin inventar Google para que el binding futuro pueda usarse.
4. El scheduler ya omite watch Composio y agenda sync; se reutiliza, no se diseña
   otro sistema de recepción. La firma GET sendAs admite readonly en la referencia
   Google consultada; no añadir permisos por confundir GET con creación de filtros.
5. Fuente tokeninfo implementada offline, compatibilidad real pendiente. Presupuesto
   vigente propuesto4 normales/5 con diagnóstico, autorizadas0; no prueba saldo Hobby.
6. Alta nueva con UUID reservado todavía no tiene account FK para cuota. Se conserva
   explícita en I04-B; no debe retrasar reutilización de cuenta existente confirmada.

## Verificación de esta preparación

- Documentos/JSON revisados y formateados con Prettier.
- Huellas de las19 fuentes inspeccionadas conservadas frente al manifiesto I04.
- Cuatro fuentes de código/test TI03 siguen coincidiendo con su manifiesto anterior.
- git diff --check y comparación de listas de archivos: solo docs QGR de este turno.
- Constante Composio product-disabled y flag cuota false por defecto observados en
  fuentes; no se verificaron variables o estado actuales de producción.

No se ejecutan suites de producto nuevas: solo cambió documentación de planificación.
Las81 focalizadas/137 de regresión de TI03 son evidencia previa, no reejecución I04.
No build, SQL local/remoto, servidor, APIs de negocio, piloto ni QA visual en este turno.
FR/AC de I04 son criterios previstos, no pruebas aprobadas por escribir el plan.

## Salida y límites

Plan contiene seis requisitos/12 AC, tareas A1–A4/R1–R2 y B posterior; propiedad,
errores, versionado, presupuesto, recepción, despliegue/reversa y ruta crítica.
G0–G3 preparados documentalmente para A/R; G4/G5 de implementación siguen pendientes.
No consta snapshot final actual de F2 fuera del checkout; no se declara que otro chat
terminó ni se transfiere propiedad por inferencia. A/R parte de las fuentes del
coordinador; tocar Connect requiere conciliación explícita posterior.

Estimación15–30 horas (2–4 jornadas técnicas) es orientativa y condicional, no un
plazo garantizado ni disponibilidad observada del VPS. El riesgo externo mayor es
tokeninfo por proxy; no se promueve una prueba offline a aceptación real.

Siguiente paso: implementar A1–A4/R1–R2 con sus pruebas locales como paquete acotado,
manteniendo proveedor apagado. Después I05 y comprobación/corte autorizados. No hay
migración que ejecutar por esta preparación. Reversa de documentos: retirar solo
el delta I04, preservando el WIP y las fuentes/constancias anteriores.

# Actualización de implementación

La planificación histórica de este archivo se conserva arriba. El paquete A/R
fue autorizado e implementado después: [diseño y aceptación](i04-implementation.md).
Resultado local:236 pruebas seleccionadas de integración/regresión,1 prueba SSR y
11 pruebas/subpruebas PG15; todas pasan. TypeScript, formato y revisión del delta
se registran en `i04-manifest.json`. Sin aceptación externa, build o publicación.

## Reproducción local

Node22 y dependencias ya existentes, sin instalación. Desde la raíz del checkout:

```powershell
$node = '.local/toolchains/node-v22.23.4-win-x64/node.exe'
& $node node_modules/typescript/bin/tsc --noEmit
$tests = Get-ChildItem tests/pipeline-os-s02-quota-i04*.test.ts | ForEach-Object FullName
& $node --import ./.local/pipeline-os/s02-i01/offline.mjs --import tsx --test --test-concurrency=1 $tests
```

La prueba nativa está apagada en ejecuciones ordinarias. Para ensayarla se requiere
`PIPELINE_OS_QGR_I04_NATIVE=1` y `PIPELINE_OS_QGR_PG_BIN` apuntando únicamente a
los binarios PG15 existentes autorizados. El ejecutor crea datos ficticios en su
propio `.local/pipeline-os/qgr-i04/runs`, valida loopback/directorio y detiene el
clúster en `finally`. La última ejecución registra PostgreSQL150019,10 escenarios
más el test padre,0 fallos y `clusterStopped:true`.

Regresiones seleccionadas ejecutadas con red Node bloqueada: cuota policy/facade/
integration/connect; existing-verification/tokeninfo; C1 API/UI/composition/verifier;
transport, selection, runtime y runtime-api; I04 servicio/HTTP. Salida:236/236,
sin omisiones. SSR I04:1/1. La cadena A3 nativa usa RPC reales del fixture y cuatro
respuestas HTTP ficticias; reserva una operación Gmail de perfil (tokeninfo no
consume unidades de Gmail) y cuatro admisiones Composio del presupuesto simulado.

Revisión final con safe-code-review: acceso, idempotencia, caducidad, compatibilidad,
mutaciones y límites comprobados sobre el delta; corregidos los defectos detectados
por tests antes del cierre. No se revisó la configuración privada ni el catálogo
remoto. El riesgo externo de tokeninfo permanece pendiente de la prueba autorizada.
