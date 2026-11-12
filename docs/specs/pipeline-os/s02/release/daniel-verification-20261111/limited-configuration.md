# DV-LIMIT-01 — configuración limitada del verificador

Actualización posterior: el incremento DV-LIMIT-UI fue autorizado e implementado
offline; ver [evidencia](controls-verification.md). Las referencias a2730d27 y a
controles propuestos documentan la preparación anterior. No se publicaron estos
controles ni se añadieron variables en vivo.

11/11/2026 · SDD STRICT · preparación autorizada, sin cambios en vivo. Base2730d27,
052 aceptada y metadatos Auth Config verificados mediante la única petición
autorizada. No volver a ejecutar052 ni esa consulta de metadatos.

## Alcance y aceptación

DV-FR07 / AC07: preparar los valores servidor y el orden que permite comprobar
solo a Daniel, con Gmail directo y Composio operativo apagado. Ningún secreto
viaja al cliente. El check sigue siendo una acción explícita, nunca un efecto
de renderizar/consultar configuración. Preservar permisos, historial y consumo.

DV-FR08 / AC08: identificar el control humano necesario para publicar política y
conceder el presupuesto de4, con sesión superadmin/MFA y RPC authenticated. No
suplantar sesiones mediante SQL admin, cookies copiadas o JWT fabricados.

DV-FR09 / AC09: para el cupo, acreditar al menos2 Proxy Execute disponibles en el
ciclo/plan correcto y costo adicional0. No sustituir esta evidencia por52 Tool
calls o27.3K managed app calls del selector Last30days.

## Valores privados preparados

Archivo propio: `.local/pipeline-os/qgr-daniel-20261111/limited-config.private.json`.
Contiene referencias al secreto original y el contexto v2 ya válido con revisión
real del Auth Config. No contiene una copia del API key. El archivo es un plan
privado, NO un export listo para importar en Coolify. No inventar policy/context
distintos al aplicar: la política de DB y el contexto servidor deben coincidir.

| Variable | Recurso web, fase de preparación | Ventana de check posterior |
| --- | --- | --- |
| COMPOSIO_API_KEY | Secreto existente, desde la referencia privada | Mismo secreto, sin rotar |
| COMPOSIO_EXISTING_AUTH_CONFIG_ID | ID verificado guardado | Igual |
| COMPOSIO_MAIL_CONTEXT | JSON privado v2 con revisión real y política propuesta | Debe coincidir con la política publicada |
| COMPOSIO_BINDING_V2_ENABLED | true, solo panel v2 | true |
| COMPOSIO_BINDING_CHECKS_ENABLED | false | true, solo con cupo/presupuesto y permiso del check |
| MAIL_QUOTA_POLICY_ENABLED | false | true, después de publicar política y revisar admisiones |
| COMPOSIO_VERIFIER_SETUP_ENABLED | true SOLO después de implementar el control propuesto | true mientras dure la administración autorizada |
| COMPOSIO_VERIFIER_ACCOUNT_ID | UUID privado de Daniel, SOLO con el control propuesto | Igual, sin ampliar a otras cuentas |
| COMPOSIO_CONNECT_ENABLED | false | false |
| MAIL_TRANSPORT_ROUTING_ENABLED | false | false |
| INSTANTLY_WEBHOOK_ENABLED | false | false |

Las dos variables SETUP/ACCOUNT anteriores son propuestas nuevas, no están
implementadas en2730d27: crearlas hoy en Coolify no resuelve el control faltante.
No se modificaron valores en esta preparación. `composioProductOperationEnabled`
sigue siendo false en código; ninguno de estos flags permite enviar por Composio.
El worker permanece paused y conserva sus variables/credenciales actuales; no
necesita recibir la clave Composio para un verificador que corre solo en la web.
Una futura operación del worker requerirá su revisión conjunta de cuota/routing.

## Política propuesta, sin publicar

Modo crm_shared_conservative, Google project desconocido/null, política UUID nueva
con generation1 y expected_generation0 como antecedente. Ambos se revalidan contra
la cabeza real antes de una mutación. Límites propuestos:4500 unidades/minuto
compartidas y por cuenta,75000000 por ventana86460s. No representan saldo Composio.
Reutilizar capture_legacy de la RPC para incorporar consumo previo sin resetearlo.
No publicar si existen trabajos/intentos/envíos inciertos o sincronización en vuelo.

## Hallazgo de integración y siguiente incremento mínimo

La base052 contiene `mail_quota_publish` y `composio_binding_budget_v2`, con sesión
humana/MFA obligatoria. Búsqueda en src/scripts/worker: no hay caller de producto
para ninguna de las dos. Las llamadas actuales de tests usan fixtures autenticados.
El panel v2 permite registrar/comprobar/confirmar, pero no publicar la política o
conceder el presupuesto; `verification_available` exige ese presupuesto existente.
Por ello, NO basta añadir variables para ejecutar el protocolo desde la app.

Preparar un incremento local DV-LIMIT-UI, sin migración nueva prevista:

1. GET/POST dedicados bajo `/api/mail/accounts/[id]/composio/verification-setup`.
   Guardas de flag, UUID objetivo servidor, Origin para POST, cuerpo acotado,
   requireUser/superadmin/MFA y autorización de la cuenta ANTES de leer descriptor
   o construir cliente de servicio. Fallar cerrado para otra cuenta.
2. GET devuelve solo propuesta de límites, cabeza/generación y estado de
   preparación. Puede leer snapshot mediante servicio después de autorizar;
   no publica contexto/política, concede presupuesto ni llama a Composio.
3. Acción «Preparar política»: confirmación explícita de pausa, generación vigente
   y request_key estable. Documento de política del servidor, no del browser;
   `human.rpc(mail_quota_publish)` conserva identidad/MFA y consumo legado.
4. Acción «Autorizar cuatro consultas»: requiere candidato v2/contexto/política
   exactos y evidencia de cupo aceptada; maximum4 fijo, fecha exacta de caducidad
   preparada en la intención (propuesta10min, máximo DB30min), request_key estable.
   `human.rpc(composio_binding_budget_v2)`. No usar service_role para concederlo.
5. Dos controles administrativos junto al panel existente, con impacto visible,
   estados pendiente/listo/error, idempotencia y sin revelar owner completo,
   secretos o configuración cruda. La acción «Comprobar» existente sigue separada:
   preparar política/presupuesto no hace solicitudes al proveedor.
6. Tests locales del delta: actor/rol/MFA/Origin/otra cuenta, flags off, cuerpos y
   revisiones stale, replay, límite4/caducidad,0 provider calls para GET/preparación,
   y conservación del endpoint de check y operación Composio false. UI ES/EN y
   pruebas con fixtures existentes; no repetir pilotos operativos aceptados.

Propiedad coordinador: nuevo módulo servidor `composio-verification-setup.ts`,
nueva ruta dedicada y componente administrativo; conexión pequeña al panel v2,
.env.example y tests propios. No editar F2/F3, migraciones052 o contratos de
verificación. Si la implementación encuentra que necesita SQL nuevo, detener esa
ampliación y revisar el contrato antes de reservar otro ordinal. Esta preparación
no autoriza implementar/publicar el incremento o activar flags.

## Orden posterior propuesto

1. Implementar/probar ese control mínimo offline y revisar la evidencia de cupo.
2. Autorizar publicación del delta y configuración fase de preparación de la web,
   con checks/cuota todavía false, routing/operación false y workerpaused.
3. En la sesión real MFA, revisar y publicar política, registrar candidato exacto
   y preparar la ventana del check. Revalidar pausa/cabeza/contexto; no usar CAS
   precargado de la lectura histórica como si fuera actual.
4. Autorizar la configuración de ventana/check y conceder4 consultas con cupo
   confirmado. Conservar la intención y la sesión; ejecutar una vez el check.
5. Confirmar solo evidencia vigente y cerrar controles temporales según el acta.
   Composio continúa sin ser el transporte seleccionado. El corte piloto posterior
   tiene alcance independiente. No reanudar worker ni eliminar Gmail directo.

Reversa: antes de cualquier publicación no hay cambios remotos. Después, cerrar
los controles temporales y conciliar intentos; no borrar políticas, recibos,
contadores o historial ni conmutar automáticamente un envío incierto.
