# Promoción y reversa

Preparar y verificar código + dos funciones SQL locales con fixtures. Conciliar contra main y catálogo productivo actualizado; comprobar respaldo restaurable antes de cambios SQL. Solicitar aprobación del paquete completo al terminar, no por archivo.

Tras autorización: aplicar solo el delta aditivo con ACL explícitas, comprobar catálogo, integrar/publicar versión exacta y verificar páginas/API en lectura sin consumir Bouncer ni activar campañas. Sin cambios de worker/configuración.

Reversa: volver la web al commit previo aprobado; ejecutar down.sql únicamente tras revisar dependencias de las dos funciones nuevas. No borrar contactos, verificaciones, trabajos o recibos. Una cola ya autorizada no se cancela mediante down.sql.
