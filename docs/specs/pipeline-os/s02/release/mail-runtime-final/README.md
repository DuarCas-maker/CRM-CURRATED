# SQL y fuentes de correo — MR-FINAL-r1

Revisión vigente **MR-AUTH-r1**: el diagnóstico real detectó refreshed_at sin zona; la050 anterior se detuvo antes delDDL. [Causa/corrección](auth-session-bugfix.md) y [resultado recibido](auth-context-result.json). La copia corregida admite ambos tipos con cálculo UTC y hashes nuevos. Puede revisarse su preflight como lectura diagnóstica; no reintentar050 ni interpretar esto como ensayo PG15 o autorización de aplicación.

**Preparado y probado offline; sin aplicar ni publicar.** Instantly43, Gmail directo conservado y Composio apagado.

- [Protocolo y variables por recurso](runbook.md): orden de pausa, ensayo, preflight, aplicación completa, postflight y publicación web/worker.
- [Preflight solo lectura](preflight.sql).
- [Candidato050 completo](050_integrate_mail_runtime_and_connect.sql): nuevo delta WC/CW/R06/alta; no repetir048/049.
- [Postflight solo lectura](postflight.sql).
- [Contrato](contract.json), [manifiesto y hashes](manifest.json), [inventario del paquete](sources.json).
- [Verificación y límites](verification.md), [aceptación](acceptance.md).

Antes de ejecutar el candidato falta cerrar el ensayo PG15 físico y el corte del runbook. El paquete de fuentes local es contexto de build para los dos recursos existentes de Coolify; no es una imagen Linux ni un despliegue. La compilación Next y el heartbeat del worker paused se comprobaron en una copia aislada de fuentes, sin claves ni red.
