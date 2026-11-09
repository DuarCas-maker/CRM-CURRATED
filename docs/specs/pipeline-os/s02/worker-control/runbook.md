# WC-I01 — integración y operación futura

08/11/2026. Código local probado; **no se ha activado ni desplegado**. El permiso general de producción del usuario se conserva. Este documento concreta los efectos para la integración; no autoriza un mensaje o presupuesto real por contener ejemplos.

## Configuración y compatibilidad

- `WORKER_EXECUTION_MODE=normal` (default compatible): recorrido anterior, sin usar las RPC nuevas.
- `WORKER_EXECUTION_MODE=paused`: solo heartbeat/log de estado; no crea cliente DB, programa tareas o llama proveedores. También se prueba la entrada real en un subproceso con DB vacía y red bloqueada.
- `WORKER_EXECUTION_MODE=pilot` más `WORKER_PILOT_ID`: requiere el ensayo previamente preparado y las RPC compatibles; cualquier ausencia/error/adquisición repetida falla cerrado. La lease se genera en el proceso, no se copia a env ni logs.

La salud del contenedor indica vida del proceso, no ejecución de trabajos. Al cerrar el ensayo conserva heartbeat y registra WORKER_PILOT_CLOSED una vez; no vuelve automáticamente a normal. Una señal de parada impide permisos futuros incluso si llega durante la admisión; una petición ya iniciada se contabiliza y se concilia.

## Integración con el release y F2

1. Mantener los cambios propios y los worktrees separados. Solo integrar entregas terminadas, no copiar el trabajo parcial de F2.
2. Coordinar SQL/ordinal del conjunto con el alta Composio. `migrations/worker-control.local.sql` es un **candidato de ensayo con marcador obligatorio**, no un archivo para pegar en producción. No ejecutar048/049 de nuevo. Preparar final/preflight/postflight del delta aditivo cuando se concilie la versión.
3. El claim específico conserva la fuente B2 y verifica su MD5 normalizado LF antes de instalar. Si no coincide, detener y revisar, sin retirar la guarda.
4. Validar PostgreSQL15 multiconexión/contención y DDL final; las pruebas aquí usan PGlite y demuestran lógica/ACL/atomicidad de las funciones en ese motor, no una ejecución física multiconexión. La fixture aplica/revierte DDL y prueba el cierre.
5. Publicar el conjunto compatible en el Coolify existente con recursos afectados inicialmente paused; coordinar autodeploy/autoarranque. La migración nueva no se ejecuta por los CMD actuales. Gmail directo sigue seleccionado hasta el corte de R06.

## Antes de un ensayo real

- Confirmar identidades/marca/roles/caso/remitente por MFA y el destinatario controlado. Preparar una intención manual nueva mediante los comandos normales de la app; no fabricar outbox ni saltar B2.
- Detener/drenar workers antiguos, replicas normales y emisores manuales ajenos al ensayo; registrar recursos/versiones reales. Una lease no controla binarios viejos ni llamadas de otros servicios. No asumir que Composio apagado detiene el resto.
- Decidir límites exactos por Gmail/OAuth/Composio, deadline, DB/Storage/UI y observación; no reutilizar20+1 del diseño directo ni peticiones de Instantly. Los cupos son parámetros obligatorios, no defaults aprobados. Configuración desconocida falla cerrado.
- Operador de servicio prepara el ensayo mediante worker_pilot_prepare con cuenta/outbox/destinatario exactos. La preparación impide copiar CC/BCC/campañas/notificaciones y retiene ese outbox frente al claim normal. No hay UI nueva de preparación en WC-I01.
- Cambiar solo el recurso previsto a pilot. Primera adquisición única, sin takeover automático. Réplica/reinicio no pueden adquirir una lease ya usada ni hacer otro claim.
- El camino Composio debe integrarse con el resolvedor/corte R06 antes de operar con ese provider. Hoy la fachada sigue en gmail_oauth: un ensayo marcado composio se rechaza antes de OAuth directo. El proxy tiene admisión conectada y probada con dobles, no activación real.

## Ejecución y cierre

El modo pilot reclama solo la intención elegida, conserva cuota/elegibilidad/snapshot/admisión B2 y limita send a una reserva. No usa claim_job, notificaciones, campañas, histórico, watches, uso externo o sincronización global. Después de sent consulta solo el gmail_thread_id persistido de esa intención, usando la ingestión existente e idempotente.

La ingestión puede escribir asociaciones/evidencia y **encolar** jobs/notificaciones internos; este modo no los ejecuta. Inventariarlos y revisarlos antes de reanudar normal. El contador del ensayo cubre las reservas HTTP de estos caminos de transporte, no DB/Storage ni otros procesos/cuentas externas al contexto.

Para detener: worker_pilot_revoke por operador o parada del proceso; se bloquean nuevas admisiones. No se retira una petición en vuelo ni se libera el cupo por timeout. Ante sending/uncertain o lease perdida, conservar evidencia y conciliar; no crear otra intención para repetir el mismo mensaje sin comprobar su resultado. Cerrar/revocar pausa únicamente el outbox seleccionado si seguía queued.

No recuperar automáticamente la lease, borrar trials, ampliar presupuestos o poner el mensaje de vuelta en cola. Reanudación normal, nuevas cuentas, llamadas y cualquier envío posterior tienen alcance propio. Instantly permanece43.

Reversa del incremento: seleccionar paused, impedir autoarranque, conciliar inflight y conservar el esquema aditivo/histórico; preferir corrección hacia delante. No bajar049 ni volver a un binario sin guardas B2 por este runbook. No limpieza de volúmenes ni restauración remota ejecutadas aquí.
