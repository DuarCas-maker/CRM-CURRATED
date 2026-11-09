# Verificación WC-I01

08/11/2026 · SDD STRICT · implementación local completada. Base50d2f916788c73c831d6e0ebe1cf29a1e9d6340a, rama codex/s00-auto-receive. [Manifiesto del delta](manifest.json), [operación futura](runbook.md).

## Resultado

**87/87 casos/grupos reportados por Node correctos:27 nuevos y60 de regresión seleccionada.** Cero fallos/omitidos. Node22.23.4, módulos simulados y preload que bloquea fetch/HTTP/HTTPS/socket/TLS/DNS reales. TypeScript `--noEmit --incremental false` y diff-check correctos. Wrapper de tests sin flag experimental también pasa; no se suma de nuevo a la cobertura.

| FR/AC | Tarea        | Evidencia                                                                                                                                                                                      |
| ----- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WC01  | WC-T01/03/04 | Modos normal/paused/pilot, configuración rechazada y separación previa a scheduler/sender/claim global. Entrada pausada compilada produce heartbeat con DB sin configurar y red bloqueada.     |
| WC02  | WC-T02/03/04 | Claim SQL solo de outbox/cuenta/manual exactos, sin fallback de notificación; conserva guardas B2. Sender real con DB/HTTP falsos confirma claim específico y no pausa correos ajenos ante401. |
| WC03  | WC-T02/04    | Lease adquirida una vez, siguiente adquisición/claim/reinicio rechazados; send reservado una vez, contadores/estado en SQL. Tabla RLS sin DML directo, RPC de servicio.                        |
| WC04  | WC-T03/04    | Otra cuenta/recurso/proveedor y cupo agotado detienen antes de token/SDK/wire; OAuth sin retry, token válido sin HTTP ficticio, proxy con reserva y fallos conservados.                        |
| WC05  | WC-T03/04    | Runtime solo consulta thread_id persistido del mensaje sent; guarda rechaza otros hilos, formatos, history/messages/watch. No ejecuta productores o jobs derivados.                            |
| WC06  | WC-T02/03/04 | Revocación/vencimiento/OAuth agotado/lease incorrecta y parada durante admisión; revalidación de B2 antes de reserva send y cierre sin replay.                                                 |
| WC07  | WC-T04/05    | DDL aplicado/revertido en memoria, permisos negativos, preservación por hashes y sin operación real. SQL fuera de migraciones numeradas.                                                       |

Selección: worker-pilot-control.test.ts, worker-pilot-database.test.ts, worker-pilot-api.test.ts; regresión de transporte S02, dispatch B2, composición C3 y Gmail sending usage. El TAP final privado y su huella se identifican en manifest.json; no contiene credenciales reales.

## Hallazgos corregidos

- La regresión intermedia83/84 detectó una alteración de temporización de cancelación en el proxy por await adicional fuera del piloto. El guard asíncrono ahora solo se invoca en contexto pilot y revalida abort después de la admisión. El caso anterior y el nuevo de cancelación durante admisión pasan.
- Parar mientras se esperaba la admisión durable podía devolver un permiso viejo: se comprueba la señal antes y después del await y antes de tomar otra operación.
- El catch normal de Gmail401/403/429 pausaba todos los correos de la cuenta. El camino pilot conserva el resultado del mensaje propio y no realiza esa mutación global; normal conserva su comportamiento.
- La reserva de send exige la admisión B2 vigente y revisa su contexto; el contador no reemplaza esa autorización.

## Alcance del entorno y límites

La prueba de entrada pausada usa una copia compilada con esbuild del código de producción, dependencias externas instaladas y resolución explícita de next/headers en la fixture. El primer intento con loader TSX bajo bloqueo de red no obtuvo heartbeat; el primer bundle nativo necesitó esa resolución ESM. No se parcheó Next ni cambió el Dockerfile. Esta prueba no acredita arranque de la imagen Linux ni de la CLI tsx del despliegue.

PGlite prueba lógica/DDL/ACL y las transacciones con bloqueo de filas, **no contención física PostgreSQL15 multiconexión**. Esa comprobación y el SQL final/ordinal/postflight deben coordinarse con F2 antes de promover. No se reejecutó048/049 remota. No se aplicó esta adición al CRM.

Una lease controla las réplicas pilot participantes; no cancela binarios normales/antiguos o emisores web/externos. Deben detenerse/drenarse antes del ensayo. Un request en vuelo no puede retirarse mediante revocar: conserva consumo/resultado y se concilia. Ingestión puede encolar jobs/notificaciones; este modo no los ejecuta y su reanudación debe revisarse.

## Preservación y entrega

Seis existentes cambian por el delta explícito: worker/index.ts, worker/gmail.ts, google.ts, ambos adaptadores de transporte y .env.example. Dos módulos nuevos y tres tests nuevos. Los demás archivos del payload100/soporte10 y las47 migraciones históricas conservan sus huellas; sus diferencias previstas se enumeran en el manifiesto. El archivo histórico ABC-WW-20261105 permanece intacto y no se presenta como paquete de estas fuentes nuevas.49 hashes operativos iguales; Instantly43/0 nuevas.

No se editaron worktrees F2/F3, secretos/env reales, package/lock,049 o sus contratos; no hay API real, SQL remoto, piloto de correo, instalación, commit/push o despliegue. Se inició solo una fixture pausada de la entrada con DB vacía/red bloqueada y se retiró al terminar.

WC-T01–05 completadas para implementación/QA local y documentación, no para operación productiva. Próximo paso: integrar las entregas terminadas de F2, conciliar el SQL aditivo y el corte R06 y publicar el conjunto inicialmente controlado en el Coolify existente. El control queda sin activar hasta ese paso y el presupuesto real propio; la autorización productiva general ya recibida se conserva.
