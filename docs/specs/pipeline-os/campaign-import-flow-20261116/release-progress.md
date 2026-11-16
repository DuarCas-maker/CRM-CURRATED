# Ejecución autorizada

Usuario: respuesta A a la aprobación del paquete completo para integrar, aplicar cinco funciones aditivas y publicar crm.finlabinc.com, después de catálogo/respaldo. Smoke de solo lectura, sin Bouncer ni activaciones/envíos de prueba.

1. Supabase productivo verificado: postgres15.8, base postgres, rol supabase_admin. Captura privada solo de metadatos,391 funciones,9 relaciones. Sin filas de negocio.17 fuentes críticas y99 columnas coinciden con el contrato probado localmente; cinco nombres nuevos libres.
2. Respaldo nuevo en el servidor:56502091 bytes, modo600, dump/listado/decodificación exit0; evidencia production-backup.json. No se restauró sobre producción ni se ensayó una copia restaurada; no se verificó copia fuera del servidor.
3. up.sql aplicado por la API SQL existente en una transacción; respuesta200. Postflight confirmó396 funciones, exactamente5 nuevas,391 anteriores intactas,9 relaciones y2 triggers sin cambios.
4. Default privileges del servidor concedían EXECUTE a service_role. Corrección versionada y acotada a las cinco funciones, con guard de fuentes/propietario; respuesta200. Postflight final: anon/service_role sin EXECUTE, authenticated con4 RPC y helper interno sin acceso. up.sql incorpora también el cierre para instalaciones nuevas.
5. Integración aislada sobre el release90a95ce de correo manual, posterior a la base del candidato; sin modificar los cuatro archivos WIP del coordinador ni el worker.48/48 pruebas, tipos/build exit0. Código de aplicación idéntico al candidato aprobado; delta final de SQL limitado a permisos heredados y regresión correspondiente.
6. Publicación de app y comprobación HTTP/UI pendientes en este checkpoint. No se han consumido créditos ni activado campañas/enviado mensajes como parte del release.
