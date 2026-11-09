# Verificación — CB-20261106-r1

06/11/2026 · planificación SDD STRICT. Base Git50d2f916788c73c831d6e0ebe1cf29a1e9d6340a, rama codex/s00-auto-receive. La preparación no es una construcción ni un despliegue.

## Evidencia y trazabilidad

| FR / AC | Tarea     | Revisión local                                                                                             | Estado remoto                                                             |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 01/02   | CB-T01/06 | Cotejo SHA de payload100, soporte10, archivo sellado, operativos49 y fuentes públicas anteriores.          | Sin traslado ni comprobación independiente del servidor.                  |
| 03/04   | CB-T02/04 | Documentación oficial y revisión del presupuesto, flags de driver, solver1, umbrales y cancelación propia. | Plugin/cgroup/egress no acreditados; snapshot RAM2.4GiB no pasa gate3GiB. |
| 05      | CB-T03    | Plan sin env reales ni keys de integración, fuentes públicas y requisitos de salidas/configuración.        | Sin credenciales leídas, filtros creados o descargas ejecutadas en VPS.   |
| 06      | CB-T05/06 | Contrato de IID/metadata/logs e inspección sin procesos de app; separación de gates.                       | Cero imágenes nuevas, inspecciones de imágenes o arranques.               |

## Checks de la documentación

La preparación usa la evidencia de Docker/arquitectura/memoria/disco pegada por el operador y los Dockerfiles/manifests actuales. No es una lectura remota nueva. Consulta pública a documentación oficial Docker06/11/2026; no usa credenciales ni cuenta como API de Instantly/Gmail/Composio.

El verificador local de preparación comprueba enlaces locales, formato de documentos nuevos, manifiestos de hashes, integridad del payload/soporte/archivo/operativos, preservación de archivos previos fuera del techo documental y HEAD/índice. Resultado exacto y conteos se registran en manifest.json tras ejecutar ese chequeo. No se certifican límites efectivos o comandos shell remotos por una revisión estática.

No se repiten tests funcionales, build Windows fallido, 048/049, recepción/adjuntos/importación o consultas de catálogos. Sin modificaciones de producto ni instalación que justifiquen esa regresión. `git diff --check` se utiliza como comprobación documental; no hay script lint específico.

## Revisión de aceptación y pendientes

AC01–06 cubiertos como protocolo revisable, no como resultados ejecutados. G0–G3 documentales preparados. G4/G5 de build y G6 de ejecución/promoción siguen pendientes. No es readyForExecution, readyForPush o readyForDeployment.

Pendientes de admisión: ventana reciente de capacidad; plugin Buildx compatible; digest BuildKit y base Node acreditados; límites/cgroups efectivos; verificación de fuente trasladada; control de egress propio demostrado; dos variables públicas reales revisadas por operador; presupuesto de descargas/recursos temporales/inspección y ejecución autorizados. No se elimina un gate para poder iniciar.

## Preservación, riesgos y reversa

Gmail directo permanece en el escritor conservado; Composio deshabilitado y webhook Instantly sin activar.43 consumidas/0 nuevas. No se consultan flags reales. La limitación es que el VPS comparte recursos y que2GiB no garantizan compilar Next; daemon/E/S/exportación tampoco quedan totalmente sujetos al límite del builder. El control manual no es un watchdog automático.

Archivos nuevos únicamente en controlled-build; el runbook y manifiestos padres cambian como referencias/huellas. Los cambios documentales anteriores y de otros chats se preservan. Sin SQL remoto, push/commit, despliegue, servidor/worker, creación de builder, instalación, copia de secretos o imágenes construidas.

Reversa documental: retirar solo este delta bajo revisión, conservando trabajo previo. Reversa operativa futura: cancelar y detener únicamente el builder propio, sin rollback SQL/app o limpieza global. No se ejecuta ninguna reversa hoy.

Siguiente paso: revisar el protocolo concreto y resolver los gates de admisión antes de solicitar una ejecución limitada. El permiso de planificar no se convierte en aprobación de creación del builder ni de construcción.
