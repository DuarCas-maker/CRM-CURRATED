# Rollout y rollback

1. Implementar y probar únicamente en checkout actual; conservar los cuatro documentos release preexistentes sin cambios.
2. Verificar reglas/paginación/acceso, regresión de conversaciones, tipos, build y UI con datos ficticios. No arrancar worker ni llamar proveedores.
3. Entregar rutas y guía locales. Instalación/publicación real, arranque y pruebas con destinatarios reales son pasos posteriores con su propia autorización.
4. Rollback: retirar el enlace aditivo a `/pipeline-os` y las rutas nuevas. Ninguna tabla ni dato requiere reversa; no se alteran acciones ni componentes existentes. No usar reset/stash/clean sobre trabajo ajeno.

No hay migraciones ni configuración remota que aplicar. Un build local no acredita integraciones productivas.
