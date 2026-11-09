# HTTP/UI — siguiente publicación coordinada

Este incremento implementa las rutas y el panel; no publicó código, configuró secretos ni aplicó SQL remoto. Gmail directo permanece y la operación Composio sigue deshabilitada en código. Instantly43, cero nuevas.

1. Preparar el nuevo paquete SQL final que reúna WC/CW, R06 y T-009, con inventario/preflight/postflight y ensayo aislado propio. Los SQL locales recibidos tienen guards de fixture y **no se deben pegar en producción**. No repetir048/049 ya aceptadas.
2. Revisar el descriptor T-004 del proyecto correcto, su generación/owner template/contexto de credencial y organizaciones admitidas. Publicarlo explícitamente por el procedimiento del nuevo paquete; las rutas no publican configuración en cada petición.
3. Preparar en servidor APP_ORIGIN HTTPS, COMPOSIO_API_KEY y las tres variables de .env.example: COMPOSIO_CONNECT_ENABLED=false; COMPOSIO_CONNECT_SETTINGS con descriptor y organizaciones; COMPOSIO_CONNECT_KEYRING con ID activo y claves base64url de32 bytes. No usar valores de fixtures, NEXT_PUBLIC ni compartir claves. El keyring debe conservar claves vigentes para descifrar intentos; cualquier rotación debe contemplar los intentos activos y el contexto revisado.
4. Revisar/build/publicar una versión concreta de web y worker, conservando ruta directa y modo de pausa/corte acordado. El archivo histórico de fuentes no contiene este delta; requiere nuevo paquete revisado. Mantener flags apagados durante el smoke de publicación.
5. Antes de habilitar el alta: comprobar Auth/getClaims/MFA, clientes humanos/servicio y PostgREST reales; HTTPS/cookies y callback estándar del proyecto. Presupuestar y autorizar el pequeño piloto por separado. Entonces un superadmin, desde su sesión original, podrá elegir Gmail/marca y consentir en Google; el resultado será un candidato. Confirmación de marca, permisos y selección de transporte siguen siendo explícitas y separadas.

El alta no activa envío/sync ni sustituye credenciales directas. La operación Composio sigue bloqueada por composioProductOperationEnabled=false, además de las guards R06/C2. Publicar este incremento no habilita ese transporte.

Si falla la configuración: conservar el flag de alta apagado. Antes de sustituir binarios/SQL con intentos activos, pausar/drenar y conservar los recibos inciertos; no borrar ni reemitir automáticamente. Ninguna acción de esta lista se ejecutó en esta entrega.
