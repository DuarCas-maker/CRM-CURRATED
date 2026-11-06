# ABC-20261031-prep1 — candidato conjunto de fuentes

31/10/2026 · Planificación y verificación local SDD STRICT: permisos, SQL y despliegue coordinado. El usuario pidió preparar la versión A/B/C y concretar el cierre de QA tras C3. **Paquete revisable; todavía no publicable.** [Runbook y orden de trabajo](runbook.md), [manifiesto](manifest.json), [QA](verification.md).

## Alcance confirmado

Congelar por contenido S02-I01+A+B1+B2+C1/C2/C3 del coordinador sobre HEAD fb9f201. La base actual contiene todo el delta funcional en100 archivos declarados:63 aplicación,32 pruebas/fixtures y cinco candidatos SQL marcados para ensayo. El manifiesto reconcilia cada fuente con el último incremento que la modificó; no interpreta hashes históricos anteriores como drift cuando hubo una modificación posterior autorizada.

Se conservan las decisiones D01–D24/S01 y las autorizaciones locales anteriores. No hay decisión funcional nueva: Gmail directo sigue activo, Composio deshabilitado e Instantly43. El incremento presente prepara documentos, consulta de catálogo de solo lectura y contraste sintético. No crea commit/tag/imagen/migración definitiva, cambia producto, consulta remoto, publica, envía o habilita permisos reales. No se abre ni copia el checkout S01.

## Requisitos

| FR       | Resultado exigido                                                                                                                                                                      | AC       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| REL-FR01 | Manifiesto finito con archivos, procedencia, SHA/bytes/base Git, dependencias de build y exclusiones; todo delta src/worker/tests debe estar declarado.                                | REL-AC01 |
| REL-FR02 | Separar evidencia ya aceptada de checks nuevos y gates no superados; definir cierre visual/build/PostgreSQL/catálogo con criterio y responsable.                                       | REL-AC02 |
| REL-FR03 | Preparar catálogo de solo lectura sin PII/secretos/RPC de negocio y ensayarlo en base47 y baseABC; no promover SQL de sandbox o asumir ledger.                                         | REL-AC03 |
| REL-FR04 | Diseñar versión web/worker/SQL compatible, control verificable del worker durante cutover y bootstrap humano de marcas/cuentas/membresías, sin reanudar legacy/uncertain.              | REL-AC04 |
| REL-FR05 | Describir preservación y recuperación que mantengan permisos/IDs/historia/Message-ID; imagen anterior no equivale automáticamente a rollback seguro de permisos.                       | REL-AC05 |
| REL-FR06 | Preservar todas las fuentes,47 migraciones,49 registros operativos y HEAD;0 peticiones reales/envíos/costos/remoto. Solo nombres de variables, sin variables nuevas para este paquete. | REL-AC06 |

No funcionales: Node22.23.4/Next16.3.8/React19.3/TS7/pnpm11.19 existentes; sin dependencias nuevas. No rehacer pilotos S00 ni importación/adjuntos/verificación aceptados. Manifiesto de contenido distinto de commit/tag/digest de imagen; cualquier cambio posterior de fuente o SQL final exige nueva revisión del candidato.

## Exclusiones y gates

No se copian valores env, journals, adjuntos o datos reales; las cuatro constancias documentales S00 pendientes se enumeran solo por continuidad de enlaces del paquete, sin código/operaciones S00 nuevos. No se añade selector por cuenta, writer epoch, fuente productiva de evidencia C2, UI de verificación real o flags Composio. La prueba C de Instantly sigue diferida.

Los datos operativos actuales del recurso se tomarán del operador en un paso posterior de lectura autorizado: destino Supabase, versiones/imagen recuperable de web y worker, mecanismo de parada que sobreviva a autodeploy y estado del webhook. Se registran como desconocidos, no como supuestos ni preguntas de negocio pendientes para preparar este paquete. Las autorizaciones antiguas de fb9f201, SQL047 o smoke6 no se reutilizan.

G0–G3 de preparación son verificables en este incremento. G5 de promoción y G6 permanecen abiertos. La aplicación ya desplegada puede seguir operándose según sus capacidades aceptadas; este candidato no la modifica ni acredita todavía operación por Composio.
