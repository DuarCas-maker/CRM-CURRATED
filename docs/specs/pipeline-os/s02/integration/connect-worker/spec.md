# CW-I01 — integración local de T-002 y WC-I01

SDD STRICT, implementación local autorizada por la continuación del coordinador. Base 50d2f916788c73c831d6e0ebe1cf29a1e9d6340a. Se reutilizan las decisiones confirmadas; no hay nuevas decisiones de negocio. La primera versión solicitada incluye alta y operación Composio, todavía pendientes de completar.

| Requisito / aceptación | Resultado verificable                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR01 / AC01            | Incorporar únicamente los tres artefactos terminados T-002, comprobando los hashes de su recibo público; no editar el worktree F2 ni incorporar T-003 parcial.                                |
| FR02 / AC02            | Componer T-002 y WC-I01 en ambos órdenes en una base ficticia, preservando funciones/ACL existentes y aislamiento de tablas privadas.                                                         |
| FR03 / AC03            | Alta con sesión/MFA ficticia no activa cuenta, credenciales, trabajos ni entrega; el control WC conserva su destinatario y mensaje exactos.                                                   |
| FR04 / AC04            | La publicación de configuración debe ser monótona incluso si cambia la fila entre la comprobación inicial y el upsert. Un test debe fallar con la entrega original y pasar con la corrección. |
| FR05 / AC05            | Preservar Gmail directo, Composio deshabilitado, Instantly43, 048/049 y WIP anterior. Ninguna llamada real, servicio, SQL remoto, push ni despliegue por esta integración local.              |

No objetivos: rutas/retorno OAuth/panel aún en T-003 y siguientes; selector y activación por buzón R06; certificar concurrencia física PG15 con pruebas en memoria; repetir pilotos ya aceptados. ReadyForProduction permanece false.
