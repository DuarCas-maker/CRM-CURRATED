# Verificación

18/11/2026 · rama codex/s00-auto-receive · STANDARD.

## Línea base

- `node --import ./tests/offline.mjs --import tsx --test tests/workspace-mail.test.ts tests/workspace-mail-files.test.ts tests/opportunity-signals.test.ts`: 10/10 correctas.
- Regresión previa de Pipeline OS, Master, financiación, leads y readiness: 58/58 correctas.
- `pnpm exec tsc --noEmit`: correcto antes del cambio.
- Lectura sintética de 200 conversaciones con 25 ms por consulta: 247 ms, 8 consultas, máximo una simultánea, 200 mensajes/200 adjuntos. Son datos ficticios y latencia simulada, no producción.
- Runtime disponible: Node 24.22.1 y pnpm 11.25.0; package.json solicita Node 22 y pnpm 11.19.0. Informar esta diferencia; no instalar runtimes por esta tarea.

## Resultado del incremento

### Trazabilidad

| Requisito | Evidencia | Resultado |
|---|---|---|
| FR-001 / AC-001 / T-001 | workspace-performance: solapamiento de lecturas, filtros, bandeja vacía, directorios, dashboards, compatibilidad con migración opcional y propagación de errores. | Correcto: 4 casos. |
| FR-002 / AC-002 / T-002 | workspace-mail: concurrencia máxima cuatro, orden global, 3000 conversaciones, tope de 1000 mensajes/adjuntos y errores. | Correcto: 4 casos. La regresión nueva falló antes de la corrección y pasó después. |
| FR-003 / AC-003 / T-003 | workspace-reader: comparte lecturas idénticas, descarta respuestas anteriores, reemplazo tras acción. Revisión de integración: useRef inicial reutiliza SSR; efectos usan un coordinador por instancia y cancelación al desmontar. | Correcto en pruebas y revisión de código; comportamiento autenticado en navegador real pendiente de publicación. |
| FR-004 / AC-004 / T-003 | workspace-reader: transporte bloqueado termina por timeout, siguiente lectura recupera, cancelación y HTTP 401 visibles. CRM usa setTimeout tras completar. Pipeline separa efecto demo/red y protege parámetros/expediente vigente. | Correcto en pruebas y revisión de código. |

### Checks

- `pnpm typecheck`: generación de rutas y TypeScript correctos. Además `pnpm exec tsc --noEmit` correcto tras añadir el escenario de overview.
- Suite offline: **83 pruebas correctas, cero fallos y cero omisiones** (17 archivos). Comando:

```powershell
node --import ./tests/offline.mjs --import tsx --test --test-concurrency=2 tests/workspace-performance.test.ts tests/workspace-reader.test.ts tests/workspace-mail.test.ts tests/workspace-mail-files.test.ts tests/opportunity-signals.test.ts tests/pipeline-os-module.test.ts tests/pipeline-os-module-ui.test.ts tests/pipeline-os-module-pagination.test.ts tests/pipeline-os-module-http.test.ts tests/pipeline-master.test.ts tests/pipeline-master-reader.test.ts tests/pipeline-master-ui.test.ts tests/pipeline-master-http.test.ts tests/financing-control.test.ts tests/lead-tabs.test.ts tests/crm-readiness.test.ts tests/user-management-ui.test.tsx
```

- `node docs/specs/application-performance-20261118/verify-build.mjs`: compilación Next de producción correcta en una copia de fuentes públicas con entorno sin credenciales. Repetición sobre el delta final también correcta: compilación 6,5 s, tipos correctos y 51/51 páginas generadas.
- `git diff --check`: correcto.
- Revisión con safe-code-review: se conservan payloads, RLS/MFA y acciones; sin caché compartida ni reintentos de POST. Se corrigió durante la revisión la posible respuesta de refresh de una vista/expediente anterior al separar los efectos de Pipeline.
- QA visual local en IAB, copia aislada en loopback: `/demo`, navegación a Oportunidades, búsqueda de empresa ficticia y `/pipeline-os/demo` → Expedientes operativos. Sin entradas error/warn en la consola de las vistas observadas. No se cambiaron estilos; móvil/teclado completo no se revisaron. Estas comprobaciones fueron anteriores al último ajuste de coordinación de Pipeline, cubierto por types y regresión; no se atribuye QA autenticada a una demo.
- El servidor temporal de QA fue detenido al terminar.

### Comparación sintética reproducible

`node --import ./tests/offline.mjs --import tsx docs/specs/application-performance-20261118/benchmark.mjs`

Fuente anterior fijada en a34a089; mismo cliente ficticio, 25 ms de espera por consulta. El script no usa cuentas, red externa ni datos reales.

| Escenario | Antes | Después | Consultas antes/después | Resultados iguales |
|---|---:|---:|---:|---|
| Workspace de tareas | 223 ms | 98 ms | 22 / 22 | Sí |
| 200 conversaciones | 268 ms | 164 ms | 8 / 8 | 200 mensajes y 200 adjuntos |
| 3000 conversaciones | 2670 ms | 1148 ms | 80 / 80 | 1000 mensajes y 1000 adjuntos |

Esta ejecución muestra ~56 % menos espera en la carga común y ~57 % en el caso de correo grande. No son p50/p95 ni tiempos de producción y pueden variar entre ejecuciones.

## Pendientes y riesgos

- No se ha publicado ni medido la aplicación autenticada real. No se promete que cada carga fallida del usuario esté resuelta.
- Medir después de publicar: duración y tamaño de `/api/workspace`, `/api/pipeline-os` y `/api/pipeline-os/master`, errores por estado y consultas lentas con EXPLAIN en un entorno autorizado. Evitar cuerpos/identidades en logs. Evaluar índices solo a partir de esos planes.
- Persisten consultas por expediente para mailAccess; se conserva el contrato de permisos. Un RPC por lote requiere diseño y pruebas de permisos aparte.
- La concurrencia de mensajes se limita a cuatro; sigue compartiendo recursos del servidor/BD con otros usuarios. La lectura de adjuntos mantiene su presupuesto y orden anteriores.
- Engine disponible distinto del fijado: pruebas y build aquí usan Node 24; validar el candidato en el runtime Node 22 del proyecto durante la preparación de publicación.
- Sin migraciones, proveedores, worker, push, commit o despliegue. Los cambios previos de usuarios/configuración permanecen; este incremento no autoriza publicarlos conjuntamente.

## Archivos del incremento y reversa

Producto: `src/lib/server/workspace.ts`, `src/lib/server/workspace-mail.ts`, `src/lib/workspace-reader.ts`, y los efectos/refresh de `src/components/crm.tsx` y `src/components/pipeline-os/workspace.tsx`. Pruebas: workspace-performance, workspace-reader y ampliación de workspace-mail. Contratos y scripts reproducibles en esta carpeta.

Reversa: retirar solo estos bloques y archivos nuevos del incremento, preservando las modificaciones previas de Usuarios en crm.tsx y cualquier WIP ajeno. No restaurar archivos completos con git restore/reset. No hay cambios de datos que revertir.

## Preflight de publicación autorizado

Rama aislada codex/application-performance-release-20261118 sobre main dadf98b. La base principal a34a089 se conserva con su WIP. Incorporadas únicamente las optimizaciones propias mediante conciliación de tres vías; imports de Usuarios/Conexiones y campañas recientes preservados.

- Build aislado final con **Node22.23.4** correcto: 60/60 páginas, sin env/credenciales; TypeScript sin errores.
- **84/84 pruebas**, cero fallos/omisiones, con guardia offline y `--import ./docs/specs/application-performance-20261118/css-test-loader.mjs`. Es el comando de17 archivos anterior más tests/crm-hydration.test.tsx y el loader.
- Primer intento de esa regresión sobre main actual falló únicamente por import de case-flow-controls.css desde crm-readiness. Esas fuentes y prueba son idénticas a HEAD; el loader permite comprobar la misma aserción, sin cambiar producto ni desactivar pruebas. La suite original sin loader queda documentada como 82 correctas/1 fallo del cargador.
- FR-005: la prueba nueva falla antes y pasa después para español/inglés, UTC/Bogotá. Contexto global mantiene fecha local tras hidratación, sin suppressHydrationWarning ni cambios de permisos.
- Baseline real en production-baseline.json; falló una recarga del Resumen, digest4193365490. Las tres lecturas GET completadas se registran solo con duración/tamaño/conteo; no se guardaron filas, cookies o cuerpos.
- Smoke anónimo previo: health/login200; Workspace/Pipeline/Master401/no-store; todavía no se observa el nuevo asset de fechas.

Runbook, autorización y reversa en publication-runbook.md. Publicación y postflight se registrarán después de ejecutarlos.

### Continuación por hallazgo real de base de datos

70cee99: web17bksuzs1ibhji8ekm96qthf finalizada y healthy, rolling update completo; worker actualizado automáticamente y Running. Asset de fechas nuevo confirmado. Desaparece React418 en la entrada posterior observada, pero un GET Pipeline devuelve statement timeout y overview sigue en16,8s. No se cerró el objetivo con esa evidencia parcial.

9cfdcc1: diagnóstico seguro de lecturas lentas publicado. El build/check Node22 y cuatro tests de Workspace pasaron. Cuatro registros de producción identifican workspace_stats7118–7440ms y jobs1800–2243ms; ver slow-read-diagnosis.json. No se escribieron datos ni se ejecutó SQL remoto.

Corrección siguiente, FR-006/007: no leer estadísticas legacy cuando no se renderizan; mantenerlas completas en reports y fallback del overview. Leer colas/revisiones administrativas solo en settings/connections, conservando la restricción superadmin. **86/86 pruebas correctas**, TypeScript y build aislado Node22 correctos,60/60 páginas. Tests incluyen nueve vistas sin estadísticas, fallback con migración ausente, reportes con su agregado y seller sin lectura jobs/outbox. Revisión del diff y whitespace correctos.

8866e84: web8jvfclxnseoxzwrvoxporib1 finalizada, healthy y rolling update completo. GET autenticados overview11881ms, pipeline7102ms, leads3947ms, sin error y sin estadísticas legacy/revisiones administrativas; comparables al baseline observado. Tres entradas SSR10555/9393/9411ms sin errores ni React418. La navegación reveló Illegal invocation en WorkspaceReader, por receptor incorrecto de fetch; no se marcó el postflight de UI como aprobado.

Corrección del receptor: regresión nueva falla antes y pasa después. Fixture real `preview-fetch.mjs`, en loopback3219 y sin mock de window.fetch, muestra Lectura correcta y consola vacía. Servidor temporal detenido. **87/87 pruebas correctas**, typecheck y nuevo build Node22 completos correctos. La siguiente publicación debe confirmar la navegación real, no solo GET directos.

## Cierre productivo y base de datos

7dde2e8 fue publicado y verificado: navegación real a Oportunidades/Leads sin carga bloqueada, alertas ni errores nuevos. Índice de Reportes autorizado posteriormente, respaldado y aplicado concurrentemente con huellas de funciones/políticas/grants intactas. Tres GET reales con stats presentes, sin timeout, y pantalla Indicadores completa. Detalle en production-results.md y database/verification.md.

Integrado por fast-forward el avance remoto fed1e49, sin editar sus fuentes de Tareas. La migración canónica058 queda versionada junto al SQL concurrente aplicado. Suite final: **98/98 correctas**, cero fallos/omisiones,23 archivos, Node22.23.4, guardia offline y loader CSS indicado. TypeScript correcto. No se necesita repetir build local por documentos/SQL/test; el pipeline existente compilará el mismo producto que main al publicar la evidencia. Los límites históricos “no publicado/no SQL autorizado” de secciones anteriores quedan superados por las autorizaciones explícitas y evidencias posteriores.
