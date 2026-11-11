# Aceptación QGR

10/11/2026. Escenarios **planificados, no ejecutados**. Alias ficticios: CRM-A/CRM-B, owner-legacy, conexión-X/Y, configuración-X/Y, política-P. Ningún dato real en fixtures.

Estado posterior: [I01](i01-verification.md) cubre contratos puros; [I02](i02-verification.md) cubre las partes SQL de reservas, compatibilidad, permisos, carreras y reversa. La tabla es el plan end-to-end original: esos AC completos no se marcan aceptados por el fixture aislado ni por una reserva sin proveedor.

[I03](i03-verification.md) cubre las partes de admisión integrada y verificador v2,
manteniendo cerrado el adaptador real por permisos no acreditados. Los casos positivos
de grants son sintéticos; no completan AC10/11 operativamente.

| AC       | FR   | Given / When / Then                                                                                                                                                                                   | Verificación prevista      |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| QGR-AC01 | FR01 | Dado contrato v2 con política válida y Google desconocido, al preparar candidato se admite sin campo Google y sin afirmar procedencia OAuth revisada.                                                 | unidad + DB                |
| QGR-AC02 | FR01 | Dado campo ficticio heredado o versión desconocida, al intentar validar se rechaza; no se copia un UUID de grupo dentro del campo Google v1.                                                          | negativo de contrato       |
| QGR-AC03 | FR02 | Dadas dos cuentas/owners/Auth Configs distintos con proyecto desconocido, al reservar ambas usan el mismo agregado y cada cuenta su límite propio.                                                    | unidad + PG multiconexión  |
| QGR-AC04 | FR02 | Dadas cuenta directa y Composio que podrían compartir proyecto, al habilitar política ambas convergen al agregado; ninguna recibe capacidad independiente por cambiar proveedor.                      | integración + PG           |
| QGR-AC05 | FR03 | Dada política disabled y Composio apagado, las operaciones directas conservan comportamiento y credenciales previos; habilitación futura añade la protección aceptada sin cambiar writer.             | regresión de fachada       |
| QGR-AC06 | FR03 | Dadas reservas previas y cambio de generación/credencial, al habilitar o actualizar no se reinicia la ventana; consumo anterior se incorpora conservadoramente.                                       | PG migración/transición    |
| QGR-AC07 | FR03 | Dada espera de cuota y después sesión/revisión/deadline inválidos, se cancela antes del proveedor; replay no debita ni emite dos veces.                                                               | carreras + reloj inyectado |
| QGR-AC08 | FR04 | Dada cuenta CRM-A y conexión-X original activa del owner-legacy, al asociar se conserva owner/ID Gmail/credencial directa/marca/contenido; no se llama link/revoke/refresh/complete_auth.             | puertos falsos + DB        |
| QGR-AC09 | FR04 | Dada conexión ya asociada a CRM-B, al intentar CRM-A se rechaza sin filtrar datos de B y sin crear otra conexión como alternativa.                                                                    | unicidad + negativo        |
| QGR-AC10 | FR05 | Dados identidad primaria exacta, owner/config/proyecto/estado y grants efectivos vigentes, al comprobar y confirmar explícitamente queda verified, con transporte directo.                            | verificador + composición  |
| QGR-AC11 | FR05 | Dados scopes solo declarados, evidencia antigua, perfil de otra cuenta o datos incompletos, al comprobar queda bloqueado/incompleto; no se fabrica permiso de envío ni se manda un mensaje de prueba. | negativos de permisos      |
| QGR-AC12 | FR06 | Dado actor ajeno/inactivo/sin MFA/Origin inválido, al leer o mutar se rechaza antes de replay, servicio o proveedor; service no aprueba al humano.                                                    | HTTP + RLS/RPC             |
| QGR-AC13 | FR06 | Dados comandos duplicados e intentos concurrentes, solo una revisión vigente se confirma; otra tuple produce conflicto sin auditoría o evidencia parcial.                                             | idempotencia + PG carreras |
| QGR-AC14 | FR07 | Dados datos/checks v1 y contrato v2, al ampliar esquema se preservan; no se reutiliza su hash/aprobación como v2; binario legado no opera binding nuevo.                                              | migración + regresión      |
| QGR-AC15 | FR07 | Dada política/contexto cambiado durante comprobación, al finalizar se rechaza como stale y exige otra revisión; no se pierde evidencia histórica.                                                     | CAS + PG                   |
| QGR-AC16 | FR08 | Dadas fuentes F2 en trabajo, la preparación/implementación aislada no las toca ni importa WIP; integración futura falla ante hashes incompatibles.                                                    | preservación/manifiesto    |
| QGR-AC17 | FR08 | Dado el alcance actual de planificación, al cerrar solo hay docs nuevos de QGR; Gmail directo/Composio apagado/Instantly43 y fuentes privadas históricas conservados.                                 | inventario/huellas         |
| QGR-AC18 | FR09 | Dado presupuesto provisional, toda llamada intentada cuenta incluso si falla; sin cupo/autorización no se llama proveedor, ni se usa remanente S00.                                                   | ledger falso + gate        |
| QGR-AC19 | FR09 | Dado desconocimiento de consumo Proxy/otros clientes Google, la UI/protocolo no certifican saldo o costo por pasar cuota local; presupuesto4 no autoriza fuente adicional de grants.                  | contrato/documental        |
| QGR-AC20 | FR10 | Dada pantalla v2, se muestran estados y política comprensibles ES/EN con teclado, sin Google obligatorio ni campos técnicos falsamente verificados; guardar candidato no activa Composio.             | UI/SSR + browser posterior |

## Fuera de estos criterios

CR-TI01 concreta AC10/11/18/19: evidencia de grants desde tokeninfo por proxy,
cuatro llamadas normales y reserva diagnóstica opcional de una. Sustituye la antigua
estimación sin tokeninfo; no autoriza ejecución. [AC TI](i03-tokeninfo.md) y su
evidencia distinguen compatibilidad de contrato, mocks y conexión real.

Los escenarios no acreditan tarifas/saldo real, recepción/envíos históricos ya aceptados, OAuth real de diez cuentas ni operación productiva. Los tests sintéticos no demuestran que el wire externo exponga los grants que necesitamos; esa fuente debe documentarse antes del ensayo real.
