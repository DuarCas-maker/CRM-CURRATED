# I05 — paquete definitivo de cuotas y asociación existente

SDD STRICT · preparación autorizada. Se reutiliza el alcance confirmado de I04-A/R:
Gmail directo activo, Composio operativo apagado, worker pausado, Instantly43,
sin proveedores, SQL remoto, push ni despliegue. No hay decisiones de negocio
nuevas; no se vuelve a preguntar por proveedor, buzón, marca o alcance conjunto.

| Requisito | Aceptación                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| I05-FR01  | Un SQL052 reúne I02/I03/I04-A/R, sin repetir048–051 ni incluir I04-B. Fuentes selladas por SHA256.                                |
| I05-FR02  | Preflight independiente y aplicación transaccional comprueban PG15, rol, dependencias, catálogo y ausencia de trabajo en vuelo.   |
| I05-FR03  | Postflight compara el catálogo final, RLS/ACL y configuración inicial sin políticas, presupuestos, bindings v2 o rutas activadas. |
| I05-FR04  | La misma transacción preserva datos operativos, credenciales, bindings previos y contadores; fallo implica ROLLBACK.              |
| I05-FR05  | Ensayo del SQL definitivo en PG15 propio con datos ficticios, negativos de drift/repetición y reversa conservadora con datos.     |
| I05-FR06  | Manifiesto de fuentes comunes web/worker, variables, orden, smoke y reversa sobre Coolify existente; publicación aún pendiente.   |

No objetivos: comprobar tokeninfo real, conceder cupo, emitir enlaces OAuth,
activar política/routing/Composio, iniciar worker, enviar mensajes o completar
Instantly C/D. Ningún resultado local certifica el estado remoto actual.

Ordinal052 reservado solo por el coordinador en este paquete local tras revisar
que no existe otro052 en las fuentes. Confirmar de nuevo antes de publicar; no
equivale a una fila de historial remoto ni autoriza la aplicación.
