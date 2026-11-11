# Verificación QGR — preparación

Actualización posterior10/11: [I03 tokeninfo](i03-tokeninfo-verification.md) acredita
contrato y pruebas offline del adaptador. Sustituye el bloqueo anterior de falta de
fuente concreta; conserva el gate de compatibilidad real, comandos I04 y publicación.
Las constancias de preparación/I03 previo de abajo se mantienen como historia.

Actualización de implementación10/11: [I01 completado offline](i01-verification.md), con21/21 tests y TypeScript correcto. Las cifras de0 escenarios y ausencia de archivos de producto en la preparación que sigue son su evidencia histórica, no el estado actual de I01. La aceptación end-to-end y todos los pasos remotos siguen pendientes.

I02: ver [resultado de reservas/compatibilidad PG15](i02-verification.md). La autorización de clúster propio aislado es exclusiva de ese ensayo; no habilita el worker, el receptor webhook, Composio ni SQL remoto. I03–I06 siguen pendientes.

I03 implementado/probado offline: [evidencia y límites](i03-verification.md). No se marca
done ni habilitable en producción mientras falte el contrato acreditado de grants.
I04–I06, publicación y operaciones reales siguen pendientes.

10/11/2026 · STRICT · HEAD00b00937b8de7eea1966a6b2c3189bf1c9db8023. La evidencia de esta entrega es documental, no una implementación ni un resultado productivo.

## Fuentes y hallazgos comprobados

- Se leyeron las instrucciones raíz/skills SDD y las fuentes actuales de C1/C2, contratos Connect, fachada Gmail, transporte, snapshots y reserva SQL039. google_quota_project_id participa en identidad de configuración y en admisión local; no se envía en el body Proxy. Se corrige la explicación anterior que lo reducía a trazabilidad.
- C1 acepta owner externo exacto; no exige su prefijo crm-mail. Connect.start sí crea un enlace, por lo que no sirve como importador de una conexión ya existente. La ruta de asociación publicada no ejecuta por sí sola un adaptador C2 externo; los tests sintéticos no acreditan grants reales.
- Se usa el resultado histórico ya aceptado únicamente para identificar la conexión candidata del buzón objetivo. No se repite consulta de identidad, recepción o adjuntos. Capturas del Auth Config son evidencia declarativa; no se convierten en permisos efectivos.
- El cambio afecta esquema/políticas/contratos/UI/runtime y necesita versión nueva.049/050 selladas solo se leen y se protegen. F2 conserva su worktree y delta Connect T007-PD; no se escribe allí, envían mensajes ni integran sus fuentes parciales.
- Pregunta2 respondida A: el operador acepta grupo común conservador, incluyendo directo si puede compartir proyecto, con posible espera adicional. La decisión autoriza preparar, no implementar ni cambiar tráfico vivo.

## Gates y trazabilidad

| Gate | Estado de esta entrega                                                         |
| ---- | ------------------------------------------------------------------------------ |
| G0   | Contexto inspeccionado y fuentes inventariadas                                 |
| G1   | 10 FR,20 AC, decisiones/alcance claros; comportamiento todavía no implementado |
| G2   | Diseño/CR/ADR propuestos para revisión                                         |
| G3   | 6 tareas y primer incremento de2 archivos delimitados                          |
| G4   | Pendiente;0 escenarios nuevos de producto ejecutados                           |
| G5   | Solo validación documental y preservación; no acredita aceptación operativa    |
| G6   | Sin publicación, SQL remoto, API o activación autorizados                      |

FR01–10 → AC01–20 → QGR-T01–T06 en spec/acceptance/tasks. Cada tarea sigue pending. I01 puro no resuelve por sí solo SQL/concurrencia, adaptador real, saldo ni UI. La aceptación operativa completa permanece pendiente.

## Verificación de archivos

La línea base se capturó antes de escribir QGR:960 archivos tracked y15 archivos públicos untracked preexistentes, con SHA256 agregado en manifest.json. Además se inventariaron20 fuentes sensibles al cambio, incluidos039 y los paquetes049/050. El chequeo de cierre debe comparar esos valores, verificar que los2 archivos futuros no existen, leer los2 JSON, validar enlaces locales y traza, y comprobar que solo se agregó esta carpeta. Los resultados observados se anotan abajo al ejecutar; no se confunden con tests de producto.

No se abre ningún env real ni se copian registros privados entre worktrees. No se generaron secretos ni se modificó la plantilla privada preparada anteriormente. Cero llamadas Composio/Gmail/Instantly, mensajes, SQL remoto, instalaciones o servicios. Las lecturas de documentación pública de la revisión previa no son llamadas autenticadas a proveedores.

## Fuentes externas de referencia

[Proxy v3.1](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy), [conexiones](https://docs.composio.dev/docs/auth-configuration/connected-accounts), [Custom OAuth](https://docs.composio.dev/docs/auth-configuration/custom-auth-configs), [límites Gmail](https://developers.google.com/workspace/gmail/api/reference/quota) y [tarifas](https://landing.composio.dev/pricing). Son referencias consultadas en la revisión previa; no acreditan el saldo privado de esta organización. Los DTO de grants siguen siendo contratos internos hasta completar el adaptador con wire revisado.

## No ejecutado / riesgos

Sin unitarias nuevas, suites de producto repetidas, PG15, build, browser, Auth/PostgREST reales ni piloto proveedor: no hay implementación de QGR y no están autorizados. No se afirma que la política controle tráfico fuera de esta instalación o que los datos de cuota heredados equivalgan a un saldo comercial. La compatibilidad completa depende de conciliar la versión Connect finalmente recibida y conservar v1 mediante ensayo.

Siguiente paso propuesto: autorizar I01 offline, limitado a los2 archivos nuevos de política y pruebas de datos ficticios. Reversa de esta preparación: retirar solo esta carpeta, sin tocar WIP previo.

## Resultado observado del cierre documental

Validador local ejecutado con Node22.23.4:9 documentos legibles,10 FR y20 AC únicos con cobertura de todos los FR,8 enlaces locales válidos y20 fuentes con SHA256 intacto. Se conservaron los960 tracked y15 untracked preexistentes con sus hashes agregados y HEAD inicial. Los2 archivos de producto propuestos para I01 siguen ausentes;0 escenarios de producto ejecutados. JSON de presupuesto confirma3 normales+1 reserva=4 propuestos,0 enlaces y0 solicitudes autorizadas. Comprobación de whitespace y git diff --check correctas. git status muestra únicamente la carpeta QGR nueva además del WIP ya existente; no hay cambios de producto en esta entrega.
