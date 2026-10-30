# REL: comprobación de app publicada con Instantly apagado

29/10/2026, America/Bogota. Continuación SDD STRICT del [runbook046](instantly-046-release-runbook.md) y [candidato conjunto](release-candidate.md). Solo registro de publicación y smoke autorizado; no código nuevo, activación o envío. El permiso de publicación se limita a0af77b7; esta constancia local no autoriza otro push/autodeploy.

## Procedencia y estado

- El usuario confirmó ausente INSTANTLY_WEBHOOK_ENABLED y autorizó publicar0af77b7 en main con despliegue automático hacia https://crm.finlabinc.com.
- Preflight Git verificó repositorio github.com/DuarCas-maker/CRM-CURRATED y main2f1f0a7 como ancestro del candidato. Push normal, sin force, publicó cuatro commits; lectura posterior confirmó main remoto **0af77b7ce3baa0d46b0dd2e7e553dd88c230a150**. La rama local S00 conserva ese candidato; no se cambió main local ni el worktree S01.
- El usuario reportó después **Success** para el despliegue0af77b7. Esa confirmación es evidencia del operador: el agente no leyó sus logs/imagen en Coolify. El intento de inspección nativa se detuvo por no identificar la URL del navegador con suficiente seguridad; no se insistió ni se disparó Redeploy.
- La046 fue aplicada por el usuario. Su catálogo posterior acredita dos tablas/columnas/RLS y tres funciones SECURITY DEFINER/search_path vacío, execute permitido solo service_role entre anon/authenticated/service_role, sin acceso directo a las tablas para esos roles. Propietario observado **supabase_admin**, coherente entre tablas y funciones; simulación PGlite con ese propietario confirmó prepare/arm/read y denegaciones. No se cambió el owner remoto ni se repitió046. No se acreditó historial de migraciones, igualdad completa de definiciones, catálogo previo o RPC PostgREST real.

## Alcance y aceptación del smoke

La solicitud posterior del usuario autoriza continuar validando la app, sin activar el webhook/enviar mensajes y conservando43. Se anunció y ejecutó un máximo de **cuatro peticiones HTTP a la misma app**, sin credenciales/cookies/tokens, cuerpo de prueba, redirecciones o reintentos. No se cargaron env reales. Nonce ficticio de24 ceros, sin manifiesto o armado real.

| Comprobación             | Petición / aceptación                                                                                  | Resultado |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | --------- |
| REL-AC04/05 salud        | GET /api/health →200 con objeto exacto status=ok/service=curated-crm.                                  | Correcto. |
| REL-AC04 entrada apagada | POST vacío /api/integrations/instantly/webhook/000000000000000000000000 →404, cuerpo vacío/no-store.   | Correcto. |
| REL-AC04 control apagado | GET /api/integrations/instantly/trials/000000000000000000000000 →404, cuerpo vacío/no-store.           | Correcto. |
| REL-AC05 acceso público  | GET /login →200 HTML con formulario, campos email/password e indicación Sign in. No enviar formulario. | Correcto. |

Las cuatro respuestas incluyeron no-store, X-Content-Type-Options=nosniff, X-Frame-Options=DENY y Content-Security-Policy. Se guardan únicamente resultado/estado/tamaño y comprobaciones booleanas, sin HTML completo, cookies, secretos o datos de clientes. No se hizo login ni se consultaron vistas autenticadas. La presencia de formulario no demuestra que las credenciales/MFA/Supabase funcionen en vivo.

Balance: **4/4 comprobaciones**,4 peticiones app,0 peticiones Instantly,0 consultas directas Supabase por el agente,0 mensajes y0 cambios de variables/campañas/infra. Journal real v7/completed43 y12 JSON operativos idénticos. El código desplegado y los contadores no se modifican por registrar estos resultados. No se repiten656 pruebas/build por documentación.

## Límites y siguiente validación

El estado publicado se apoya en push verificado, Success reportado por el operador y smoke real en el dominio. Un404 por sí solo no prueba la revisión desplegada: no se obtuvo identificador de imagen o commit por una ruta de versión de la app. No se certifica salud funcional completa, logs del contenedor, Docker Linux reproducido localmente, latencias bajo carga, auditoría de TLS/CSP o costos globales.

**Comprobación autenticada reportada por el operador:** respuesta8→A, «Pude entrar con MFA y las tres vistas abren correctamente». Se acepta acceso con MFA y apertura de Oportunidades (lista y un detalle), Conversaciones y Campañas, según el recorrido solicitado de solo lectura. Es evidencia humana; el agente no realizó el login ni leyó datos de clientes. No equivale a contrastar cifras/indicadores del control, probar acciones de escritura, verificar todas las reglas de permisos o demostrar recepción integrada.

REL-T04 publicación apagada acreditada en el alcance descrito; REL-T05 tiene **smoke4/4 y aceptación manual básica de sesión/MFA/vistas correctos**. La revisión independiente de logs/imagen y la aceptación funcional más amplia no se declaran completadas. Puente/control/manifiesto y presupuesto integrado de C aún deben prepararse antes de una activación autorizada. C/D/T00-04/S00 siguen abiertos; no gastar el remanente5 de B ni el antiguo techo19/62. Registrar la respuesta8 no añade HTTP/peticiones de proveedor o permisos de activación.

Rollback conservado: última revisión saludable previa2f1f0a7 según evidencia del operador, código046 expansivo compatible con la versión anterior. Recuperación de imagen/revisión previa y cualquier cambio en vivo requieren su autorización concreta; no ejecutar reversa SQL ni restaurar contadores. No se propone rollback por este smoke exitoso.
