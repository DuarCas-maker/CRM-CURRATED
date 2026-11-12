# DV — orden propuesto, todavía sin ejecución Composio

## Preparación completada o acotada

Base2730d27 y052 ya publicadas/aceptadas: no repetir la migración. Buzón existente
y marca se revisan solo por lectura. Clave/Auth Config y conexión original se
reutilizan; no generar otra API key, enlace OAuth o cuenta CRM.

## Secuencia posterior, con autorización concreta

1. Acreditar el cupo del ensayo Hobby. Capturas del11/11 muestran Last30days,
   Tool calls52 y Composio-managed app calls27.3K; no muestran el subcupo Proxy ni
   saldo restante. La tarifa oficial consultada incluye proxy1000/mes en Hobby
   y parada al límite: https://composio.dev/pricing/platform. No afirmar saldo por
   restar esas métricas de100000 ni de1000. Confirmar que se aplica el plan/cupo
   del proyecto correcto; si no se puede acreditar, mantener ejecución bloqueada.
2. Con permiso de UNA petición de configuración, GET del Auth Config guardado por
   APIv3.1. Admitir solo Gmail/OAUTH2/ENABLED e ID exacto; guardar únicamente
   last_updated_at y hechos/referencias saneados. Error, cuota o discrepancia:
   detener sin retry. No extraer tokens o cambiar el Auth Config. Contar1 aunque
   falle. Si hay fecha exacta acreditada sin API, se puede omitir esta petición y
   ajustar el máximo antes de autorizar la prueba.
3. Completar el descriptor privado y volver a validarlo. Revisar propuesta de
   política/grupo compartido y transición de consumo previo; no convertir la
   clave de servicio en una sesión humana ni conceder presupuesto por SQL admin.
4. Bajo autorización de configuración en vivo, sesión superadmin/MFA y pausa:
   publicar política mediante mail_quota_publish con generación esperada actual,
   preservando reservas/consumo anteriores. Preparar variables servidor web y
   habilitar únicamente la interfaz/comprobación v2 y la política necesarias.
   Mantener Connect nuevo, routing y operación Composio apagados y workerpaused.
   El cambio de env requiere su publicación/reinicio acordado; no lo autoriza
   este documento. Contexto/política reales deben coincidir entre DB y servidor.
5. Desde la app con MFA, registrar candidato existente y revisar revisiones
   vigentes; no sustituir cuenta/historial/marca. Preparar presupuesto humano
   composio_binding_budget_v2, maximum4, included_confirmed y vencimiento máximo
   30min. Abrirlo solo cuando el operador esté listo; no caducarlo ahora.
6. Con permiso del check, una ejecución POST /api/mail/accounts/{id}/composio/check:
   GET conexión1 + GET Auth Config1 + proxy tokeninfo1 + proxy perfil Gmail1.
   Deadline30s; cada intento se admite antes del wire, fallos incluidos. El
   tokeninfo vía proxy no está acreditado contra este Auth Config real: ante
   rechazo detener, sin extraer credenciales, cambiar dominio ni probar atajos.
7. Solo con resultado completed, permisos e identidad exactos y recibo vigente,
   confirmar la asociación en la misma sesión humana. Transporte continúa Gmail
   directo. Confirmar no autoriza seleccionar proveedor ni reanudar el worker.
8. Guardar acta/contador propios, cerrar exposición temporal acordada y preparar
   el corte piloto como paso separado. Sin mensajes, campañas o histórico aquí.

## Presupuesto y cierre

Máximo propuesto5 peticiones a Composio:1 de configuración +4 del check. El check
incluye2 proxy;1 llega a tokeninfo y1 a Gmail profile, sin listar mensajes.
Cero reservas diagnósticas/reintentos automáticos y costo adicional autorizado$0.
Las llamadas CRM/Auth/PostgREST y assets se contabilizan aparte, no como Composio.

La variante anterior de6 peticiones con OAuth no aplica a esta asociación existente;
se conserva intacta como antecedente. No se modifica ningún ledger histórico S00.
Instantly permanece43/0. Un saldo desconocido no se registra como confirmado.

Reversa de preparación: no hay cambios remotos que revertir. Después de una
configuración autorizada, apagar los controles temporales por su protocolo y
conciliar intentos; no borrar recibos/contadores ni revocar Gmail automáticamente.
