# Publicación y reversa (pendientes de autorización)

1. Conciliar catálogo remoto y migraciones 048–052 ya existentes; no repetir instaladores históricos. Respaldar antes de aplicar 053. Ensayar instalación/reversa en copia y PG15 nativo antes de producción.
2. Aplicar solo delta 053 autorizado y publicar web desde versión probada. No habilitar cuentas, Composio, OAuth, envíos ni worker por instalar la revisión.
3. Verificar modelo y A_OPENAI_API_KEY existentes sin exponer valores. Piloto humano con correo ficticio autorizado: analizar, editar, aprobar, recargar y verificar IDs/permiso.
4. Reversa: volver a imagen previa; exportar revisiones/requisitos si deben conservarse. Rollback SQL elimina solo nuevos contratos/tablas; no borra ofertas, tareas, actividades ni eventos ya aprobados. No descifra/copía adjuntos ni cambia claves.

Esta implementación no ejecuta estos pasos remotos.
