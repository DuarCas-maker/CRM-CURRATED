# R06 — selección de transporte por buzón

Actualización I02: [fachada/store/scope de envío y rutas guardadas implementados offline](i02-verification.md). 34 casos/grupos nuevos y180 de regresión correctos; Composio continúa bloqueado por código y routing=false por defecto. I03/alta real F2/operación y QA productiva siguen pendientes; las constancias I01/preparación siguientes son históricas.

Actualización08/11: el usuario autorizó implementar I01 y se completó offline en seis archivos nuevos. [Resultado y límites](i01-verification.md), [contrato concreto](i01-design.md). No se conectó a producto ni se activó ningún transporte. La preparación original siguiente conserva su alcance histórico; I02/I03 siguen pendientes.

08/11/2026 · SDD STRICT · modo **preparación**, autorizado por «perfecto, hazlo» después de proponer preparar R06. Base local 50d2f916788c73c831d6e0ebe1cf29a1e9d6340a más WC-I01/CW-I01. Este paquete especifica el siguiente trabajo; no modifica producto ni instala SQL.

## Objetivo y aclaraciones cerradas

El usuario eligió alta y operación Composio antes de lanzar. Se reutilizan D01–D24, RF27, las decisiones S01/A/B/C y el piloto de un buzón, un envío y una respuesta manual. No hay una nueva decisión funcional que requiera repetir preguntas: migración gradual por cuenta, identidad estable, administración superadmin/MFA, permisos separados del expediente, sin fallback de envío y conservación de recepción/adjuntos/importación aceptadas.

R05 crea/verifica una conexión y registra un candidato. R06 selecciona qué transporte puede usar **esa cuenta CRM**, para lecturas y escrituras. Ni completar Google ni tener un binding verified habilitan operación por sí solos. Las cuentas restantes conservan Gmail directo.

## Requisitos

| FR / AC         | Requisito comprobable                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R06-FR01 / AC01 | Selección durable y versionada por account_id, nunca por dominio, orden de lista, env global o alias M1/M2. Preservar cuenta, marca, permisos y todos los IDs Gmail.                                                                  |
| R06-FR02 / AC02 | Resolver antes de adquirir token. Composio no lee/renueva credenciales directas; directo no llama al proxy. Binding/proyecto/contexto inválidos bloquean; no fallback ni retries de envío.                                            |
| R06-FR03 / AC03 | Cambio/pausa solo con sesión superadmin activa y MFA, revisiones CAS, recibo idempotente, revisión comercial y evidencia de identidad/permisos/configuración vigentes. Servicio solo resuelve/admite/finaliza, sin aprobar al humano. |
| R06-FR04 / AC04 | Un único proveedor de escritura por cuenta. Drenar admisiones y conciliar sending/uncertain antes de cambiar o volver atrás; un permiso vencido/crash no demuestra que un HTTP haya terminado.                                        |
| R06-FR05 / AC05 | Conservar cuota/pacing/hook B2 y WC, y validar transporte/revisiones después de las esperas y justo antes del wire. Cambio de contexto o presupuesto rechaza nuevas salidas.                                                          |
| R06-FR06 / AC06 | Recepción de cuentas Composio sin token Google ficticio: separar cursor de la credencial y programar polling por cuenta. Mantener independientes el histórico y el cursor vivo, sin reset/reimportación.                              |
| R06-FR07 / AC07 | Cubrir cuentas nuevas R05 disconnected sin abrir indiscriminadamente las guardas C2; verificar identidad/scopes y revisar humano antes de habilitar operación. Reconectar/revocar/configurar invalida resolución previa.              |
| R06-FR08 / AC08 | Proteger callbacks OAuth directos, push/watch antiguo, productores y jobs pendientes frente a la transición; no reactivar campañas/notificaciones o permisos por activar el transporte.                                               |
| R06-FR09 / AC09 | UX de estado por cuenta, errores saneados, reanudación explícita y reversa sin replay; QA solo del delta de transporte, con presupuesto privado propio antes de tráfico real.                                                         |
| R06-FR10 / AC10 | Conservar WIP,049 aceptada, Gmail directo actual, Composio apagado e Instantly43. No editar F2/F3 ni copiar privados, generar enlaces, llamar APIs, aplicar SQL o desplegar durante esta preparación.                                 |

NFR: mismo Node22/TypeScript/Zod/PostgreSQL y gestores; sin nueva dependencia. Secretos solo servidor, ninguna clave/token en DTO/log/browser. RLS y mínimos privilegios, sin cambiar service_role en privilegio humano. Un intento HTTP por transporte; resultados ambiguos conservados. No cachear una selección como autorización permanente.

## Alcance y límites

Tres incrementos locales propuestos en [tasks.md](tasks.md), con diseño/ADR y pruebas de aceptación. No se redacta ni reserva una migración050; el SQL final se concilia con el alta F2 y WC cuando esté completo. El despliegue usará el Coolify existente y su build normal; no exige otro VPS ni un umbral arbitrario de memoria.

La autorización productiva general ya recibida se conserva. Esta preparación no inventa un presupuesto de proveedor, una cuenta real, una ventana, permisos de envío o una publicación terminada. El piloto Composio y la reanudación normal se cierran después de los incrementos y sus verificaciones.
