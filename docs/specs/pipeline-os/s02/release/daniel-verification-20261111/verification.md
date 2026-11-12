# DV — evidencia de preparación

11/11/2026. T01–T04 realizados; configuración en vivo y verificación Composio no
ejecutadas. No se presenta un borrador incompleto como configuración operativa.

## Observado

- Una petición SQL a /pg/query del Supabase self-hosted CRM, read-only y ROLLBACK:
  PostgreSQL150008, rol supabase_admin; una cuenta connected, Curated Financial
  activa y revisión confirmed. Cero bindings, políticas, checks y presupuestos
  nuevos. No se consultaron credenciales, mensajes ni clientes del negocio.
- SHA256 del email privado corresponde exactamente a la alias2 histórica. Su
  conexión del env coincide con el segundo ID original conservado. Owner de la
  misma evidencia aceptada. No se eligió la reconexión de alias1 ni se volvió a
  probar recepción, adjuntos o identidad contra el proveedor.
- Clave y Auth Config guardados presentes. Proyecto de la confirmación previa
  del operador. No se copió la clave ni se certificó su permiso/proyecto actual
  mediante una llamada real. No se generó otra credencial.
- Borradores privados de configuración, valores runtime y registro del candidato
  completan las referencias conocidas; revisión Auth Config null y contexto CAS
  pendiente se mantienen visibles. Propuesta de política válida según el schema,
  sin Google Project ID obligatorio; no publicada ni aprobada como saldo externo.
- Captura suministrada: Last30days,52 Tool calls,27.3K managed app calls,5.8% errores,
  sin subcupo Proxy ni fechas del ciclo de facturación.27.3K es abreviado, no un
  número exacto. La evidencia no equivale a27300 peticiones del CRM ni altera S00.
- Tarifa oficial consultada11/11/2026: Hobby incluye1000 proxy/mes y se detiene
  al límite; las llamadas de apps propias y de apps gestionadas tienen partidas
  distintas. Fuente: https://composio.dev/pricing/platform. Esta información
  pública no confirma el saldo restante de esta organización/proyecto.

## Verificación local y trazabilidad

DV-FR01/02/03: ejecutor privado de preparación con Node22/tsx y guard de red:
cuenta/marca únicas, correlación histórica e ID original correctos, clave solo
referenciada, propuesta parseada con mailQuotaPolicySchema. El contexto real
incompleto falla exclusivamente por auth_config_revision; el comando con CAS
incompleto también se rechaza. Ningún placeholder se publica.

DV-FR04/05: presupuesto JSON verificado:1 lectura previa de Auth Config +4 de
check, máximo5;0 reservas/retries/permisos reales. No son6 con OAuth. La lectura
previa explica el incremento respecto a las4 anunciadas para el check aislado.
Se conserva el presupuesto histórico, sin reescribirlo.

DV-FR06:49 archivos operativos privados contrastados por hash,49 intactos.
Instantly43/0, Gmail directo conservado; ningún cambio en código de aplicación,
variables en vivo, política, presupuesto, candidato, transporte, SQL DDL o worker.
El guard de red bloqueó el tráfico durante la validación offline. git diff --check
correcto; directorio privado ignorado por Git.

Se dejó preparado un ejecutor privado de UNA lectura de Auth Config, sin habilitar
flags. Solo conserva ID/toolkit/authScheme/enabled/last_updated_at, descarta el
resto del cuerpo y no reintenta. Cuatro comprobaciones offline correctas: metadata
válida, ID ajeno, estado disabled y revisión ausente. Modo live NO invocado.

## Conteo y siguiente acción concreta

- CRM SQL API:1 lectura,0 escrituras. Composio/Gmail/Instantly:0 peticiones nuevas.
- Preparación local completada; configuración real NO publicada y check NO listo.
- Pendiente técnico exacto: last_updated_at del Auth Config original. Ejecutable
  privado preparado para solicitar autorización de1 GET de metadatos, sin proxy
  ni llamada a Gmail. El uso real necesita esa autorización posterior.
- Antes de las4 consultas del check: cerrar evidencia/cupo del intento y autorizar
  la publicación limitada de política/variables/panel v2, manteniendo operación
  Composio y routing apagados. Presupuesto humano/MFA justo antes de la ventana.

Evidencia local propia en `.local/pipeline-os/qgr-daniel-20261111/`: crm-attempt,
crm.private, configuration.private, runtime-values.draft.private,
register-candidate.draft.private y validation. No contiene la clave copiada,
tokens Google, cookies o datos de mensajes. No se enviaron comunicaciones.
