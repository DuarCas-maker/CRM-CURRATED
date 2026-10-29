# S00-A: observador y pruebas offline

Estado: implementado, probado offline y **ensayo real completado el 26 de octubre de 2026**, con dos respuestas detectadas automáticamente y 23 peticiones nuevas (60 acumuladas). [Contrato, aceptación y presupuesto](composio-auto-receive.md), [evidencia](../verification.md).

## Archivos y alcance

- [s00-composio-observer.ts](../../../../scripts/pipeline-os/s00-composio-observer.ts): ciclo acotado de metadata, baseline, tiempos, relectura, reporte y presupuesto.
- [s00-composio-observer-files.ts](../../../../scripts/pipeline-os/s00-composio-observer-files.ts): validación de JSON, lock de origen y observación, escritura atómica sin sobrescribir temporales huérfanos.
- [s00-composio-observer-cli.ts](../../../../scripts/pipeline-os/s00-composio-observer-cli.ts): estado offline por defecto; ejecución futura solo con flags explícitos y permisos humanos correspondientes.
- [s00-composio-common.ts](../../../../scripts/pipeline-os/s00-composio-common.ts): helpers reutilizados por runner/observador, sin lector env o SDK.
- [tests](../../../../tests/pipeline-os-s00-composio-observer.test.ts): escenarios sintéticos de recepción, reloj, fallos, límites, privacidad, persistencia y CLI.

Los scripts pertenecen al diagnóstico S00. No están importados por Next, el worker o las campañas. No crean conversaciones CRM, suscripciones o tareas periódicas de Codex. No incorporan paquetes nuevos.

## Comandos seguros para repetir localmente

Desde la raíz del proyecto, usando Node22 portable ya instalado:

```powershell
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import tsx --test tests/pipeline-os-s00-composio-observer.test.ts
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' node_modules/typescript/bin/tsc --noEmit
```

Las pruebas inyectan fetch y reloj, usan datos ficticios y no cargan env reales. Los tests de filesystem crean carpetas únicas bajo `.local/s00-observer-test-*`, nunca en el directorio real de credenciales, y limpian solo esas carpetas. Los procesos hijos del nuevo CLI se prueban con fetch deshabilitado.

Consulta de estado offline por defecto:

```powershell
& '.local/toolchains/node-v22.23.4-win-x64/node.exe' --import tsx scripts/pipeline-os/s00-composio-observer-cli.ts
```

Este comando no carga env ni crea carpetas o temporizadores; si existe observación, lee solo ese journal y publica un informe sin IDs/correos. Si no existe, indica `not_started`, base histórica37 y cero llamadas nuevas. No valida las conexiones de proveedores.

## Activación futura y límites

La implementación admite `--execute`, `--authorized-total=77` y `--included-calls-confirmed` únicamente cuando se autoricen ejecución y presupuesto real y se compruebe el cupo incluido. **El usuario autorizó ese alcance y el ensayo se ejecutó una vez: 23 nuevas, 60 acumuladas.** Los flags reflejan una decisión humana previa, no la reemplazan; no se incluye aquí un comando que inicie red.

`--clock-synchronized` y `--clock-uncertainty-ms` documentan una verificación previa del reloj por el operador; no sincronizan Windows. Sin evidencia de incertidumbre máxima2s el resultado de latencia es indeterminado. T04 contrastó el reloj con una referencia UTC independiente (incertidumbre inicial estimada802ms) y observó uso Instant0 antes/después. El saldo mensual restante no está expuesto por la API.

La fuente debe ser el run final anterior (33+4=37, ambos buzones completados) y coincidir con configuración y destino. El archivo de origen permanece sin modificar. El registro nuevo de observación mantiene base37 y como máximo40 nuevas; el CLI anterior impide red cuando existe dicho registro. No renombrarlo o borrarlo para recuperar saldo. Una segunda prueba requiere otro plan y contabilidad, no volver a ejecutar el mismo comando esperando reset.

Ante interrupción, conservar journal/temporal/locks para revisión. No borrar automáticamente un lock ajeno o temporal huérfano; comprobar que el proceso propietario terminó antes de una recuperación manual. El replay de estado terminal es offline; una fase activa recuperada se marca interrumpida sin rearmar el reloj. No se promete continuar una medición cortada como si fuera continua.

Las pruebas offline mantienen fixtures de internalDate; el ensayo real posterior midió llegada SMTP→persistencia local: 25.078ms y 21.757ms, dos muestras descriptivas. CRM, reconexión/revocación, Bouncer, Instantly y TextTorrent quedan fuera de este módulo.

El journal terminal real ya existe; repetir ejecución devuelve su resultado sin nuevas llamadas, no inicia otra ventana. Quedan17 peticiones del techo77 sin usar. No borrar ni reiniciar el registro para aprovechar ese saldo. No se mantiene un proceso observador en segundo plano después del cierre.
