# CW-I02 — integrar motor y adaptador de alta terminados

08/11/2026 · SDD STRICT · implementación local al continuar la versión conjunta. Reutiliza las decisiones de identidad, sesión/MFA, marca, aprobación independiente y escritor único ya confirmadas. Gmail directo activo, Composio bloqueado e Instantly43. No hay ambigüedad funcional nueva que requiera repetir las preguntas de F2/R06.

| FR / AC         | Resultado comprobable                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CW2-FR01 / AC01 | Recibir únicamente siete fuentes terminadas T-003/T-004, cotejadas byte a byte con los recibos F2, sin modificar su worktree ni copiar privados/dependencias                                                                        |
| CW2-FR02 / AC02 | Motor y adaptador compilan y pasan sus49 casos en la base del coordinador con red real bloqueada. Los tests de origen siguen intactos                                                                                               |
| CW2-FR03 / AC03 | Comprobar compatibilidad del descriptor/contexto C2-R06 y la distinción entre identidad de alta y evidencia operativa: completar alta nunca autoriza transporte ni envío                                                            |
| CW2-FR04 / AC04 | Probar la composición del motor con el adaptador de proveedor mediante un store explícitamente simulado: happy path, identidad equivocada, incertidumbre y rotación de configuración. No certificar persistencia real por ese store |
| CW2-FR05 / AC05 | Conservar fuentes previas,049, contadores/privados, HEAD/índice y flags. Registrar el delta y dejar T-009 en su chat mientras continúa implementándose                                                                              |

No incluye T-009 parcial, rutas HTTP, cookies, UI de alta, lector de env, credenciales/OAuth reales, llamadas de proveedor, worker, SQL remoto, commit/push ni despliegue. Los componentes de recepción y transporte R06 se conservan; no repetir pruebas operativas aceptadas de correo/adjuntos/importación.

Esta entrega incorpora módulos desacoplados; la aplicación todavía no tiene caller de alta Composio utilizable. El cierre operativo requiere store/persistencia, configuración acreditada, rutas/UI, SQL final, corte y piloto propios.
