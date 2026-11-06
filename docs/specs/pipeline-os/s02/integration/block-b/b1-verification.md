# B1 — implementación y verificación local

31/10/2026 · SDD STRICT · Autorización del usuario: implementar/probar B1 local, sin APIs/envíos/cambios remotos. Alcance previo en [b1-local](b1-local.md); seis existentes y ocho nuevos, sin dependencia nueva. B1 funcional implementado; **aceptación visual y promoción pendientes**. B2 no se implementó.

Entregado: siete comandos administrativos, GET por colección/cursor, Configuración ES/EN y dos formularios OAuth directos con intención explícita. Marcas con código estable/revisión, membresías sin roles/permisos implícitos, propuesta/evidencia/conflicto antes de confirmar cuenta. CAS, recibos canónicos y auditoría transaccionales; autorización antes del replay. Cambiar estado o asociación no altera cola/campañas ni recatalogación histórica.

SQL candidato [b-brand-management.local.sql](migrations/b-brand-management.local.sql), **solo en memoria**, sobre001–047+A, con marcador explícito y sin número final. Helpers privados/search_path vacío; humanos sin DML de configuración, servicio sin DML comercial de marca/cuenta. Se preserva la capacidad previa del servicio para llamar los comandos CRM heredados; `brand_*` vuelve a exigir superadmin activo/AAL2. Fallos de SQL no disparan fallback y devuelven503 cerrado.

OAuth begin usa cliente firmado; state10 minutos y cookie existente. Claim/finish son RPC de servicio acotadas; Google sigue verificando scopes, audiencia, organización e identidad. Finish revalida actor/marca/cuenta y confirma cuenta/credencial cifrada/propuesta/trabajos técnicos en una sola transacción. Nueva cuenta queda sin marca vigente hasta revisión; reconexión exige identidad exacta y conserva ID/marca. No membresía, reanudación o transporte Composio implícitos. SDK, cookies y respuestas externos fueron falsos en pruebas.

## Trazabilidad y pruebas

| FR / AC B1         | Evidencia ejecutada                                                                                                                                                                                                 | Resultado y límite                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| FR01/02, AC01/02   | Administración SQL: cinco roles; anon/AAL1/inactivo; código estable; CAS/replay; membresía en dos marcas/revocar/reactivar sin cambiar rol/remitente.                                                               | Correcto local. Sin habilitación de despacho B2.                                              |
| FR03/04, AC03/04   | Evidencia obligatoria, conflicto/ack, revisión de marca/cuenta/impacto, confirmado inmutable, rollback; Origin ajeno, payload adulterado, SQL ausente y privilegios.                                                | Correcto. CAS secuencial y locks lógicos; no certifica concurrencia multiconexión PostgreSQL. |
| FR05, AC05         | Catálogo propio/admin, cursor compuesto,200 marcas por páginas; SSR0/1/200, ES/EN, carga/vacío/error/solo lectura, selección OAuth no automática, clave de retry.                                                   | Correcto SSR/SQL/API. Visual/teclado360/768/1280 pendientes.                                  |
| FR06, AC06         | Rutas reales y Google/cookies falsos: nueva, reconexión correcta/otra identidad, coincidencia nueva→existente, replay/expiración/cookie, cambio de actor/marca/cuenta durante OAuth, fallo transaccional posterior. | Correcto offline, sin Google/API real.                                                        |
| FR12, AC12 parcial | Candidato sobre47+A, guardas/grants,046/047 funciones y ACL iguales, huellas A/I01/SQL históricos/privados.                                                                                                         | Correcto local; catálogo real, build completo y release siguen pendientes.                    |

Pruebas nuevas: **30/30** según Node (incluye dos grupos padre): [administración](../../../../../../tests/pipeline-os-s02-block-b-admin.test.ts), [API/OAuth](../../../../../../tests/pipeline-os-s02-block-b-api.test.ts), [UI](../../../../../../tests/pipeline-os-s02-block-b-ui.test.ts). Comando desde raíz:

```powershell
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --experimental-test-module-mocks --import './.local/pipeline-os/s02-i01/offline.mjs' --import tsx --test tests/pipeline-os-s02-block-b-admin.test.ts tests/pipeline-os-s02-block-b-api.test.ts tests/pipeline-os-s02-block-b-ui.test.ts
```

El preload ignorado de QA bloquea fetch/http/https/socket/TLS/DNS; PGlite en memoria, fixtures y mocks de módulos. El archivo público API también admite el runner normal del proyecto: inicia su proceso aislado de mocks sin depender de rutas privadas para funcionar. No se arrancaron web/worker reales.

Regresión seleccionada **31/31**: request-origin, unsaved-changes, gmail-history, gmail-refresh, campaign-center y campaign-readiness. Se eligió por las superficies formulario/envelope/configuración afectadas; no se repitió A155 completo ni pilotos de correo/adjuntos/importación/Bouncer. Cada paquete conserva su propia evidencia.

`tsc --noEmit --incremental false`: correcto, con preload offline. Prettier de los13 TS/TSX/tests y documentos nuevos/actualizados, `git diff --check`: correctos. No hay script lint configurado. SQL no tiene formatter instalado; su sintaxis y permisos se comprobaron ejecutándolo en PGlite, no por formato.

## Revisión, preservación y pendientes

Revisión propia: diff de las seis superficies y nuevos módulos/candidato, permisos/errores/replay/identidad/compatibilidad. Ajustes verificados: conservar grant CRM de servicio previo; quitar huella interna del DTO público; validar cursor por colección y payload en cliente antes del POST. No hallazgos confirmados abiertos dentro del comportamiento probado. Validación visual y contención real siguen fuera de lo demostrado.

Se intentó ver fixture local sin red (CSP sin conexiones, datos ficticios y fetch simulado). Navegador integrado: timeout30s; Chrome headless con perfil aislado: fallo Crashpad/TransactNamedPipe al arrancar. No capturas aceptadas ni afirmación de teclado/responsive/contraste verificados. Fixture de QA preparado en `.local/pipeline-os/s02-b1/visual.html`; no contiene datos reales. No se alteraron permisos de Windows o sandbox para forzarlo.

Build standalone completo sigue pendiente por la limitación EPERM documentada en A. No se repitió ese empaquetado ni se cambió next.config/entorno por este incremento. TypeScript y compilación del fixture de navegador con esbuild existente sí pasan; eso no equivale a `next build` aprobado.

Huellas finales e inventario en [b1-implementation.json](b1-implementation.json): A43/I018,47 SQL001–047 y49 JSON operativos anteriores intactos; HEAD fb9f201 conservado. No env reales leídos, APIs/envíos/costos/migración remota, commit/push/despliegue. Instantly **43 consumidas/0 nuevas**; Gmail directo único camino activo y Composio sin selector productivo.

Siguiente incremento: B2 sobre B1, previa autorización y revalidación de paths compartidos. Cerrar snapshots y guardas antes de preparar despacho; después C de asociación Composio. Antes de promoción: QA visual/teclado, build completo, locks PostgreSQL multiconexión, catálogo/Storage/legado y asignaciones reales. **No publicar B1 aislado.**
