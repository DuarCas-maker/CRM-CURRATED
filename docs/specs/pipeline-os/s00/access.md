# Accesos necesarios para las pruebas externas S00

El usuario decidió usar el ambiente actual, todavía sin uso, y permite modificarlo para S00. No se exige preparar otro Supabase ni otro workspace. El [procedimiento del ambiente actual](environment.md) reemplaza las propuestas anteriores de separación. Falta identificar las referencias concretas y disponer de acceso seguro.

No enviar contraseñas, API keys ni códigos de acceso por el chat. Solo hacen falta referencias de proyecto/cuenta y saber cuáles servicios están disponibles.

## Manejo de secretos

Las reglas Duarte prohíben al agente abrir archivos `.env` con valores reales. El archivo privado `.local/pipeline-os/s00.env` preparado anteriormente sigue bajo control del usuario y no se abre ni inspecciona. El usuario puede usar la plantilla vacía [staging.env.example](staging.env.example) como inventario de nombres; su nombre no obliga a crear staging y no constituye un canal de entrega al agente.

Para pruebas autenticadas, el usuario debe provisionar las credenciales mediante un gestor seguro o el proceso de pruebas, sin imprimirlas ni incluirlas en argumentos de comandos. No sobrescribir `.env.local`, rotar la clave de cifrado ni copiar secretos a documentación. La herramienta offline no tiene modo de red ni reutiliza automáticamente el entorno del proceso.

La comprobación de presencia en el proceso del agente no encontró las ocho variables de acceso examinadas (Supabase URL/anon/service role, Composio key/auth config, Instantly key y el par TextTorrent). No se abrieron archivos privados ni se infiere que esas credenciales no existan en el servidor.

## Primera etapa sin envíos

| Servicio        | Acceso mínimo                                                                                                                                                                                                                 | Contexto necesario                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase actual | Acceso de lectura de esquema/migraciones, o exportación de esquema sin datos. URL y credencial correspondiente por canal seguro para pruebas autenticadas. No se solicita service role para una simple comprobación de salud. | URL o referencia del proyecto actual autorizado; estado de migraciones y respaldo. El origen local de la web no demuestra dónde está la base.           |
| Composio        | API key del proyecto actual con lectura de Auth configs, Connected accounts y Triggers.                                                                                                                                       | ID del proyecto, auth config Gmail y referencias de los dos buzones controlados; modo administrado/propio.                                              |
| Instantly       | API key V2 del workspace actual con lectura de cuentas/campañas y permisos disponibles.                                                                                                                                       | ID del workspace y alcance de prueba; identificar campañas activas antes de modificar alguna.                                                           |
| TextTorrent     | X-API-SID y X-API-PUBLIC-KEY de la cuenta/subcuenta actual, por canal seguro.                                                                                                                                                 | ID y ámbito de subcuenta/act-as cuando corresponda, líneas, capacidades, límites y saldo. No consultar indiscriminadamente buzones de otras subcuentas. |

Composio separa permisos por recurso según su [documentación de claves](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions). Para Instantly y TextTorrent, los contratos se contrastan con el [índice oficial de Instantly](https://developer.instantly.ai/llms.txt) y la [API oficial TextTorrent](https://texttorrent.com/docs/api). La documentación pública no acredita el plan, permisos o saldo de esta cuenta; siguen sin probarse.

## Segunda etapa con efectos delimitados

Después de identificar el ambiente y comprobar lecturas:

1. **Composio/Gmail:** dos buzones controlados autorizados por sus propietarios; acceso para enviar, leer y obtener adjuntos. El usuario realiza el consentimiento OAuth. Preparar permisos adicionales de ejecución/proxy/triggers solo si hacen falta. No se pide una clave por buzón. Medir recepción y probar revocación/reconexión.
2. **Instantly:** borrador etiquetado y leads ficticios en el workspace actual; comprobar detención individual o alternativa de pasos únicos controlados por CRM. Antes de activar, acordar destinatario y mensaje concretos. No usar campañas preexistentes como muestra de escritura.
3. **TextTorrent:** línea ya disponible y receptor controlado. Antes de enviar, acordar texto, cantidad de mensajes/segmentos y presupuesto. La compra de números no está autorizada por disponer de la clave.
4. **Bouncer:** no se necesita acceso para pruebas offline. Una verificación real requiere direcciones controladas, cantidad y presupuesto delimitados; no usar automáticamente una clave existente.

Se emplean texto, PDF y leads ficticios. Registrar IDs, estados y tiempos; nunca cuerpos privados, documentos de clientes ni respuestas completas con datos personales. Un timeout de envío no autoriza repetirlo sin conciliación.

## Información que puede compartirse por chat

- URL o referencia de Supabase actual y origen de la aplicación.
- Nombre/ID o «aún no creada» para Composio, Instantly y TextTorrent.
- Canal seguro disponible para provisionar credenciales, sin pegar valores.
- Disponibilidad de dos buzones y un receptor de correo/SMS controlados; no hace falta publicar sus datos en el chat.

Usar el ambiente actual ya está autorizado. Identificarlo y proveer acceso son los pendientes; no se vuelve a solicitar una infraestructura separada. La autorización general del ambiente no incluye envíos a terceros, gastos, operaciones destructivas ni despliegues de producción.

## Estado declarado y provisión del 25 de octubre

El usuario informó que guardó las credenciales nuevas en el archivo privado, con dos cuentas Composio y act-as vacío para la administradora TextTorrent. No se solicita volver a copiarlas. Las claves Supabase/Bouncer existentes en `.env.local` se conservan. El comprobador actual solo necesita las tres integraciones nuevas. La carga interna por Node del archivo S00 requiere excepción explícita a la regla Duarte; alternativamente, el usuario puede ejecutarlo en su terminal y compartir únicamente el reporte sanitizado. Ver [procedimiento y comando](connections.md).

La excepción de carga interna del archivo S00 fue concedida expresamente. La inspección posterior permitida detectó un ID `ac_` en el campo de API key y los campos restantes vacíos; Composio devolvió 401. Hace falta corregir la asignación y confirmar el archivo usado, sin compartir claves. Esta autorización se conserva para repetir el mismo alcance de lectura; no se solicita de nuevo para esos GET. Detalle en [connections.md](connections.md).
