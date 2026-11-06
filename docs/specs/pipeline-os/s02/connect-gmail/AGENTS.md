# F2 — Conectar Gmail con Composio

Preparación SDD STRICT autorizada: discovery y especificación S02-CONNECT-T01, siguiendo las reglas raíz y parallel-common-base-20261105.md. No implementar por recibir este encargo.

Escritura permitida exclusivamente en esta carpeta. Producir discovery/spec/design/tasks/acceptance/verification proporcionales, reutilizando D01–D24 y preguntando solo decisiones nuevas. Conservar este AGENTS. Los demás archivos se leen; propuestas de código/SQL/UI van en un manifiesto aquí, sin editarlos ni reservar un ordinal de migración.

Estado conocido: 049/postflight aceptados; candidato A/B/C web/worker preparado, todavía sin publicación. Gmail directo fijo, Composio deshabilitado, Instantly43. Registrar bindings no crea una nueva conexión OAuth; R05 es alta y R06 es activación por buzón. Preservar cuentas/IDs y permisos existentes, distinguir cuenta CRM nueva frente a existente y resolver sesión/identidad/cancelación/reconexión/multicuenta antes de diseñar una implementación.

Antes de escribir, verificar la base común indicada en el mensaje inicial y los hashes del payload público. No abrir env reales, .local de otro checkout o adjuntos privados. No instalar, usar credenciales, generar enlaces OAuth, llamar APIs, ejecutar SQL remoto, enviar mensajes, iniciar servicios/worker o hacer commit/push/merge/deploy. Si falta una herramienta, continuar discovery/documentos y reportar el límite. Fixtures y presupuestos son propuestas; no cuentan como pruebas reales.

Entrega: alcance FR/AC/T, preguntas nuevas, decisiones, manifiesto de cambios futuros con propietarios, verificación ejecutada y pendientes. No cambiar AGENTS raíz/docs comunes ni contactar otros chats sin instrucción explícita del usuario.
