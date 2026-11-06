# R47: publicación fb9f201 y resultado de Coolify

**Actualización posterior:** [smoke HTTP de nueva versión6/6 conforme](instantly-047-app-smoke.md), autorizado por el usuario después de la publicación. Health/login200 y webhook/trial/control/lease404 vacíos/no-store;43/12 privados intactos, sin activación/envíos/SQL/despliegue adicional. El balance0 smoke de la constancia original siguiente corresponde al momento anterior a esa ejecución. Siguen pendientes sesión/vistas e imagen recuperable actuales, y C/D/S00.

30/10/2026, America/Bogota. Continuación SDD STRICT del [candidato](instantly-047-release-candidate.md), [commit local](instantly-047-local-commit.md) y [runbook](instantly-047-release-runbook.md). El usuario autorizó publicar exactamente fb9f201 en main y su despliegue automático, conservando43, sin envíos, más SQL remoto o activación. Esta constancia local no autoriza otro commit/push/despliegue.

## Publicación comprobada por el agente

- Repositorio y destinos fetch/push verificados: `github.com/DuarCas-maker/CRM-CURRATED`, remote origin; sin credenciales embebidas o destinos múltiples.
- Árbol local limpio y HEAD `fb9f2015e682fc0704340530425322efc62c601b`, único commit sobre `0af77b7ce3baa0d46b0dd2e7e553dd88c230a150`, con38 archivos públicos (20 payload/18 documentación). Blobs y huella de payload coinciden con la copia QA681.
- `git ls-remote` previo devolvió main0af77b7, padre directo del candidato. Push normal del SHA exacto a refs/heads/main, sin force, merge, tags, otras ramas o push de submódulos. La lectura posterior del remoto confirmó **main fb9f2015e682fc0704340530425322efc62c601b**.
- El push es el disparador previsto de Coolify según main/autodeploy confirmados por operador. No se ejecutó un segundo Deploy/Redeploy ni se cambiaron variables, recurso web, worker o infraestructura.

## Resultado de despliegue aportado por el operador

El usuario respondió: «fb9f201 aparece Success/Finished y el contenedor está healthy». Se acepta el resultado de Coolify para ese commit como **evidencia del operador**. El agente no inspeccionó el build, imagen final o logs de ese despliegue.

El conector de GitHub devolvió lista de estados vacía (dos lecturas); no se interpretó como éxito/fallo de Coolify. Se localizó una única ventana de Deployments del CRM para lectura, pero Computer Use se detuvo antes de observar la página porque no pudo determinar la URL del navegador con suficiente certeza para aplicar su política. No se insistió, pulsó un control de despliegue o intentó eludir esa detención.

Última confirmación de configuración: INSTANTLY_WEBHOOK_ENABLED ausente según operador. El agente no cambió ese estado ni activó un permiso, trial o webhook. La migración047 ya aplicada/postflight aceptado se conserva, sin repetir SQL. No se hizo un smoke HTTP de la nueva versión por esta constancia.

## Balance y aceptación

R47-T04 queda completada para publicación verificada en Git y despliegue exitoso reportado por operador. No equivale a aceptación funcional completa, verificación independiente de imagen/TLS/PostgREST/MFA o prueba de recepción C.

Instantly **43/v7**,12 JSON operativos idénticos y20 archivos de payload sin cambios.0 peticiones Instantly,0 mensajes,0 SQL remoto adicional por el agente,0 smoke HTTP app y0 cambios de variables/activación. Se realizaron tres comandos Git remotos (lectura/push/lectura) y dos lecturas del conector de estados; no se presentan como peticiones del proveedor ni como techo del tráfico automático de Coolify/GitHub. No se cargaron `.env` reales, generaron claves/tickets/ventanas o migró el journal a v9.

La evidencia681/DB/TS/build corresponde al mismo payload previamente comprobado; no se repitió por publicar o registrar esta confirmación. Formato, enlaces y preservación se revisan localmente. Esta documentación se guarda después de publicar fb9f201, sin incluirla en un segundo push automático.

## Pendientes y recuperación

R47-T05 pendiente: smoke acotado del [runbook](instantly-047-release-runbook.md) (hasta6 HTTP a la app,0 Instantly), revisión de sesión/vistas mediante operador y comprobación de que la imagen0af77b7 sigue retenida tras el despliegue nuevo. Un404 debe contrastarse con la versión publicada, pues también puede provenir de una ruta ausente.

No crear el manifiesto ejecutable C, token de control o cambiar flagtrue para validar la publicación. C real/D/S00 siguen abiertos, sujetos a sus gates y presupuestos. Recuperación ante regresión: versión/imagen saludable0af77b7 identificada anteriormente, previa confirmación de su disponibilidad y autorización de recuperación; conservar046/047/evidencia y43, sin reversa SQL remota o restauración de diarios.
