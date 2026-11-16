# Verificación local · Master Pipeline

Candidato STRICT de solo lectura. Base original5f38ec6, conciliada con `01b6d3f8c2f61ba09ef60ff07a7ef4a17b9c681b`, 1209 archivos, para conservar el nuevo checklist. El HTML se inspeccionó sin ejecutar sus scripts y sus registros históricos no se incorporaron. Fuentes de producto aisladas en el snapshot propio indicado por implementation-manifest.json.

## Evidencia ejecutada

| Check | Resultado | Evidencia |
| --- | --- | --- |
| Modelo, HTTP, lector SDK simulado y render de seis vistas; regresión del módulo y checklist existentes | 65/65 pasan; 0 fallos, 0 omitidas | evidence/master-tests.log |
| TypeScript | `tsc --noEmit`, exit0; también compilación Next completa | evidence/master-build.log |
| Formato | Prettier comprueba los 13 archivos del candidato | Ejecución local, sin dependencias nuevas |
| Build optimizado | Next16.3.8, webpack, exit0; ruta dinámica `/api/pipeline-os/master` incluida | evidence/master-build.log |
| HTTP real local | Filtro inválido400; petición sin sesión401 | Servidor temporal con valores ficticios y guard offline |
| QA visual | Seis pestañas, tabla por asesor, filtros/búsqueda, ofertas desplegables, teclado, carga/vacío, temas, apertura de expediente y lector ficticio | evidence/ui-observations.json y JPG |
| Responsive | 360,768,1280px reales de página, sin desbordamiento horizontal del documento | evidence/mobile-360.jpg, tablet-768.jpg, desktop-light.jpg, desktop-dark.jpg |
| Auditoría de fuentes e integración | 1209 fuentes base comparadas; solo 2 existentes modificadas + 11 altas; `git apply --check` correcto | evidence/source-audit.json, implementation-manifest.json |

Runtime Node22.23.4 ya disponible en el worktree. No se instalaron dependencias. La demo y el build usan Supabase inválido/clave ficticia, Composio cerrado, telemetría desactivada y `tests/offline.mjs`. Se detuvo el servidor temporal al terminar la revisión.

Comando de pruebas ejecutado con el Node local:

```text
node --import ./tests/offline.mjs --import ../master-css-loader.mjs --import tsx --test --test-concurrency=2 tests/pipeline-master.test.ts tests/pipeline-master-http.test.ts tests/pipeline-master-reader.test.ts tests/pipeline-master-ui.test.ts tests/pipeline-os-module.test.ts tests/pipeline-os-module-http.test.ts tests/pipeline-os-module-pagination.test.ts tests/pipeline-os-module-ui.test.ts tests/pipeline-os-case-progress.test.ts tests/pipeline-os-case-progress-http.test.ts tests/pipeline-os-case-progress-ui.test.tsx
```

## Trazabilidad y revisión

- FR01/AC01: acceso en inicio/navegación, lectura directa `?view=master`; regresión del workspace y QA.
- FR02/AC02: tarea individual/owner/ID, P1 heredada, asesores sin exclusiones por nombre; filtro de asesor compartido.
- FR03/AC03: seis pestañas, búsqueda, página50 después de agregar y estados; lector con cap REST simulado2 y 73 casos.
- FR04/AC04: proceso vigente/renovación, retirado distinto de rechazo, firma de aplicación no acredita contrato ni desembolso; etapa CRM original visible cuando no existe equivalencia segura.
- FR05/AC05: UTC con offsets, fechas inválidas excluidas, oferta histórica distinta de vigente, desembolso legado fechado sin duplicar evento.
- FR06/AC06: negativas de sesión/MFA en contrato HTTP, scope por caso/área, seller sin importes ni tablas financieras, payload ajeno excluido y cuerpos solo para la página visible. Son pruebas con fixtures, no un ensayo RLS real.
- FR07/AC07: solo GET, ninguna mutación/proveedor; evidencia incompleta produce error o nulo. Revisión de oferta pendiente no acredita respuesta. Correo físico deduplicado.
- FR08/AC08: render español/inglés, texto escapado, tablas semánticas, flechas/Home/End, Escape, temas y breakpoints observados. Error de red visual no forzado; su rama se revisó y el contrato negativo se probó.

La revisión corrigió la atribución del correo recibido de una tarea, el guard de revisión aprobada, la separación de actividad histórica/ofertas vigentes, el conteo legado de desembolso y la acción «Ver todos». La conciliación detectó dos hermanos del drawer con la misma clave; MP-INT01 en bugfix.md documenta su corrección y comprobación en navegador. No quedan hallazgos locales conocidos que bloqueen la revisión del candidato.

## Límites y pendientes

No se consultó Supabase remoto, no se probaron sesiones/roles reales, ni se ejecutó SQL, OAuth, worker, envíos, importación, push o despliegue para este cambio. El contrato de `mail_archive_visible` y `mail_conversations_visible` se contrastó con el código existente y su SQL público; las revisiones de ofertas usan la estructura de la053 existente. La publicación deberá confirmar esas capacidades en su entorno, sin proponer migraciones por defecto.

Las lecturas de diferentes tablas no constituyen una transacción de reporte; actividad concurrente puede requerir actualizar. Fuentes sin fecha/evidencia o fuera del permiso muestran «—»/advertencias, no se completan con datos del HTML. El build fue Windows/webpack; no se ensayó una imagen Linux/Coolify para este candidato.

La rama coordinadora avanzó durante el trabajo a5e27ed0 (recuperación Connect) y después01b6d3f (checklist). Se capturó una nueva base pública comprometida y se aplicó únicamente el delta Master en otro snapshot propio. El checklist del drawer permanece y se probó al abrir un expediente desde Master. La comprobación del parche contra01b6d3f fue de solo lectura; el checkout coordinador y su WIP se conservaron. Véase rollout.md para la integración y recuperación propuestas.

La suite ampliada encontró inicialmente que el test JSX existente del checklist necesita un preload para CSS en Node. Se usó el adaptador SSR de evidence/ssr-css-loader.mjs, sin modificar ese test ni saltar aserciones. Los estilos reales se compilaron y se observaron en navegador. El snapshot conciliado tiene su propio `.git`: Next advierte que ignora el pnpm-workspace.yaml del directorio padre; no se cambió next.config.ts ni se trasladó ese aviso al despliegue real. La compilación y el chequeo completo finalizan correctamente.
