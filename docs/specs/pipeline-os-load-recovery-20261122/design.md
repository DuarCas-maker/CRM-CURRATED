# Diseño de corrección

Retirar únicamente el sondeo amplio de c0ef7a9: los callers Board y Master vuelven al lector ya existente por IDs. Eliminar el helper sin consumidores; conservar readPipelinePages, cap4 por relación/cap6 por lector, callback de correo de Tareas y los avances680991b/4cbe7e8/2d4c6fa. No revertir versiones completas del repositorio.

Mantener las mismas columnas, filtros por área/rol, paginación completa y cuerpos solo de la página visible. Los errores de las fuentes acotadas continúan propagándose. No aumentar statement_timeout ni atrapar57014 para producir un dashboard incompleto. No SQL remoto, cachés, dependencias, infraestructura o cambios de worker.

Regresión nueva: fixture simula exactamente SQLSTATE57014 para mail_conversations_visible sin filtro de casos y permite las mismas consultas acotadas. Board y Master deben devolver351 casos,50 filas y nunca disparar el sondeo. Probar también buzón con conversaciones excluidas y cap17, missing count, duplicados y denegación de acceso.

Publicación: flujo Git/Coolify existente autorizado en el chat, sobre el main actual con WIP principal intacto. Postflight API, tres cargas de entrada, filtro de Tareas/Master y logs recientes. Reversa: retirar solo este diff; regresar al sondeo anterior reproduciría el fallo, por lo que no se hará automáticamente sin evidencia de otra regresión.
