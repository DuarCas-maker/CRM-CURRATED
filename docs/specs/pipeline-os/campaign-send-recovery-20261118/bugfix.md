# Recuperación de campaña programada — STRICT

Autorización: el usuario pide proceder con la corrección tras el diagnóstico de campaña bloqueada. Comprende corregir/publicar el worker y recuperar los destinatarios ya programados; no recrear campaña, ampliar permisos, desactivar cuotas ni usar pruebas con destinatarios reales. Se conserva el flujo de cuatro recordatorios y la asignación vigente.

## Evidencia y causa

Campaña de50 destinatarios activada el18/11 a05:30 America/Bogota. Cola creada a05:30:02, cero IDs Gmail y cero admisiones de marca. Última lectura de uso18/11 00:00:19, primera tarea fallida00:05. Más de70 tareas fallidas y reintentos internos de cola, mientras el worker sigue procesando otras tareas. `external_usage_synced_at` supera el umbral de15 minutos, por lo que la guarda pospone el envío.

Base actualizada de17cbbd6 a95114ab por fast-forward, conservando WIP ajeno. Release Gmail directo: SIMPLE_MAIL y QGR habilitados, routing global cerrado; el target tiene credencial directa anterior y carece de ruta moderna. La combinación QGR=true/routing=false/sin scope reproduce QGR_DENIED antes de red. Falta confirmar el código específico de la tarea productiva: el worker lo reemplaza por PROCESSING_FAILED. Se publicará primero clasificación segura de errores y se observará una tarea normal; no se presume que toda falla sea de autenticación.

## Requisitos y aceptación

- FR-01 / AC-01: conservar códigos técnicos permitidos (cuotas, transporte, Gmail y SQLSTATE) sin payloads, mensajes del proveedor, tokens, cuentas o URLs. Errores desconocidos siguen redactados.
- FR-02 / AC-02: corregir el camino confirmado de sincronización/cuotas, manteniendo rechazo a contextos ajenos, proveedores incorrectos y llamadas sin autorización. Nunca falsear la fecha de sincronización ni retirar la guarda de15 minutos.
- FR-03 / AC-03: reanudar los mismos50 registros solo después de una lectura Gmail completa y confirmada. No insertar duplicados, reiniciar recordatorios, reintentar resultados inciertos ni reasignar cuentas.
- FR-04 / AC-04: mostrar el bloqueo operativo en la campaña, conservando su estado de programación.
- FR-05 / AC-05: pruebas ficticias de falla y éxito, controles de cuotas/marca/identidad, build y publicación coordinada. Validación productiva por lecturas acotadas de tareas, uso y cola. Nada de pruebas de envío manual.

Fuera de alcance: activar Composio, modificar OAuth, subir cuotas, importar leads, tocar otros expedientes o configurar infraestructura.
