# Promoción CR-01

Destino autorizado: crm.finlabinc.com y Supabase autoalojado ya conectado. No nueva aprobación por etapa. Fuente v1 aplicada y publicada en a1532d7; firma inicial de campaign_flow_launch en source-pins.json.

1. Pruebas owner/RLS/MFA/replay, regresión del flujo, TypeScript/build y PostgreSQL nativo con reversa/concurrencia.
2. Respaldo nuevo privado en el volumen PostgreSQL, listado y decodificado sin descargar datos; sin ensayo completo de desastre.
3. Comparar fuente y ACL. Aplicar únicamente up.sql con hash verificado y timeouts. Comprobar que los responsables de casos existentes y las demás funciones no cambiaron.
4. Publicar el commit por fast-forward a main; seguir disponibilidad de ruta y comprobación autenticada de lectura. El cambio operativo vive en la función SQL; el cliente solo añade una nota. No requiere cambios adicionales del worker.

Reversa: down.sql solo restaura el comportamiento para lanzamientos futuros. No reasigna expedientes ya asignados ni modifica recibos, envíos o recordatorios. Restituir binario anterior es compatible con ambos SQL.
