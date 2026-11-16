# Campañas desde una base importada

SDD STRICT · implementación local autorizada · base a34a089. El usuario solicita estructurar y aplicar el recorrido en Pipeline OS → Campañas, reutilizando lo existente. 1→A: «voucher» es Bouncer. 2→A: revisión y activación manual de cada campaña.

- CI-FR01: Campañas presenta «Crear campaña» y un recorrido Archivo → Revisión → Bouncer → Plantilla → Envío → Respuestas. Conserva acceso a campañas y métricas existentes.
- CI-FR02: reutiliza ImportWizard y /api/import para XLSX/CSV, mapeo, procesamiento, duplicados y errores. Permite retomar un lote registrado sin subirlo otra vez.
- CI-FR03: muestra clasificación del lote, reutiliza verificaciones válidas y solicita confirmación explícita antes de encolar Bouncer. No repite automáticamente resultados técnicos o inciertos. La confirmación incluye la cantidad; cambios concurrentes obligan a revisar nuevamente.
- CI-FR04: candidatos y creación se limitan en el servidor a contactos del lote. Reutiliza elegibilidad, marca, remitente, plantilla versionada, límites, horario, bajas y prevención de contactos duplicados del motor vigente.
- CI-FR05: crear guarda un borrador. Enviar o programar requiere la decisión manual existente; subir/importar/verificar nunca activa campañas.
- CI-FR06: reutiliza CampaignCenter para enviados, respuestas confirmadas y pendientes de respuesta; no infiere lectura o respuesta de un mero intento de envío.

Permisos: superadmin/seller_admin con MFA crean y verifican; otros roles conservan sus lecturas existentes. Solo datos ficticios y proveedores bloqueados en las pruebas. No ejecutar verificaciones pagas, enviar mensajes, migrar o desplegar por implementar. No cambiar Gmail directo, Composio, worker, credenciales o límites globales.

Límites heredados: importación50MB/50.000 filas; campaña hasta5.000 elegibles. Nunca truncar silenciosamente un lote mayor: se exige selección explícita. Verificación en bloques confirmados de hasta5.000, sin recarga automática de créditos. Los resultados técnicos/dudosos quedan visibles y excluidos del envío.
