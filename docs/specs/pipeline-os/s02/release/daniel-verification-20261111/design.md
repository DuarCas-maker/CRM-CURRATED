# Diseño DV

Reutilizar los módulos publicados: verification-context-v2, mail-quota-policy,
composio-bindings-v2, proveedor/verificador existente e interfaz I04. Sin nuevo
adaptador, endpoint, dependencia o SQL. No modificar archivos sellados de052.

1. Una consulta repeatable-read/read-only al CRM correcto obtiene solo cuenta,
   email/UUID privados, marca, rutas/bindings y cabeza/contadores del delta052.
   Autenticar por /pg/query HTTPS443 con la credencial guardada, sin imprimirla.
2. Comparar SHA256 del email normalizado con s00-composio-run.json. Para la alias
   que coincide, contrastar el ID actual del env con originalIds de la evidencia
   de reconexión. El owner procede de la misma alias aceptada. Es procedencia
   histórica, no nueva certificación de identidad/permisos actuales.
3. Referenciar proyecto entregado por el operador y Auth Config del env. Derivar
   credential_version con SHA256 de la clave, sin copiarla. Guardar DTO y borrador
   privado con auth_config_revision:null: no rellenar una fecha inventada.
4. Proponer política nueva generation1, grupo crm_shared_conservative, Google
   provenance unknown/project_id:null. Límites propuestos:4500 unidades/minuto
   compartidas y por buzón,75000000 por ventana86460s. Son una propuesta dentro
   del contrato, NO saldo externo ni política publicada. Publicar después debe
   conciliar las reservas legadas bajo pausa y conservar sus contadores.
5. Mantener límites de ejecución separados: una lectura de Auth Config para
   completar last_updated_at, luego check I04 con sus cuatro admisiones. La
   primera lectura no consume el presupuesto DB del check, pero sí el ledger
   total nuevo del ensayo. No reusar el remanente/contador S00.

Flags actuales false/ausentes: MAIL_QUOTA_POLICY_ENABLED,
COMPOSIO_BINDING_V2_ENABLED, COMPOSIO_BINDING_CHECKS_ENABLED,
COMPOSIO_CONNECT_ENABLED, MAIL_TRANSPORT_ROUTING_ENABLED, INSTANTLY_WEBHOOK_ENABLED.
La operación Composio permanece literalmente false en el código publicado.
Preparar valores no autoriza cambiar ninguno de ellos. La clave solo se copiará
al secreto runtime del recurso web correcto en un paso remoto autorizado.

Custodia: .local/pipeline-os/qgr-daniel-20261111, ignorado por Git. No se guardan
tokens Google, contraseñas, cookies, enlaces OAuth ni cuerpo crudo del proveedor.
El contexto/hash/revisiones de los comandos se refrescan desde la app al ejecutar;
no pegar valores stale del borrador como aprobación humana.
