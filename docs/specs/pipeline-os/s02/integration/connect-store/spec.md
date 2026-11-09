# CW-I03 — store durable y recepción R06

08/11/2026 · STRICT · implementación local autorizada por «Hazlo» después de CW-I02. Integrar T-009 terminado y comprobar su composición con CW/R06 antes de continuar HTTP/UI. Reutiliza las siete decisiones de F2 y D01–D24: misma sesión superadmin/MFA, Gmail esperado previamente, cuenta nueva/existente, una por intento, TTL máximo10min, cancelar/reconectar explícitamente. Sin nueva decisión de negocio.

| FR / AC         | Resultado                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CW3-FR01 / AC01 | Seis fuentes y recibo final T-009 cotejados contra F2 ya terminado; cero escritura en su checkout ni copia de privados/cluster/dependencias                  |
| CW3-FR02 / AC02 | Store/cifrado y tests unitarios originales pasan en root; el runner nativo permanece opt-in y no inicia PostgreSQL sin permiso/runtime propio                |
| CW3-FR03 / AC03 | Ensayar T-009 sobre la composición CW/R06 en memoria: tickets humanos/servicio, cifrado, callback, marca revisada y candidato sin permisos/transporte        |
| CW3-FR04 / AC04 | Candidato T-009 nuevo puede recibir evidencia C2 válida simulada y seleccionarse en R06 bajo guards explícitas; nunca marcarlo operativo por completar OAuth |
| CW3-FR05 / AC05 | Verificar ACL/reversa/compatibilidad de funciones existentes y cierre de entradas R05 antiguas; conservar fuentes previas,049, flags y43 de Instantly        |

No SQL remoto, proveedor real, OAuth, env reales, instalación, mensajes, push o deploy. La evidencia PG15 de F2 es de su entrega, no de esta composición. Aquí se usa PGlite y no se afirma concurrencia física PostgreSQL15.
