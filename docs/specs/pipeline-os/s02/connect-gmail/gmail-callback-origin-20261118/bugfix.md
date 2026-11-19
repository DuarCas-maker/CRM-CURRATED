# Regreso público de OAuth Gmail

SDD STRICT. Síntoma aportado por el usuario: tras aceptar Google, el navegador abre `https://0.0.0.0:3000/?module=connections&mail_connection=...` y falla con ERR_ADDRESS_INVALID. Objetivo: corregir el regreso al CRM público, preservar el consentimiento guardado y verificar recuperación sin intercambiar otra vez el código OAuth ni iniciar envíos. Sigue cerrado Composio.

Base aislada `b1d87c4`, posterior a la publicación Gmail `95114ab`; incorpora los cambios de recuperación de errores del worker sin alterarlos. Se respetan WIP y credenciales existentes. No se abren .env reales, leen tokens ni registran correos de buzones.

## Diagnóstico

H1 confirmada por código: `simpleDirectCallback` construye todos sus destinos con `new URL(relativePath, request.url)`. Detrás del proxy, request.url puede tener el host interno 0.0.0.0:3000, exactamente el observado en la captura. Reproducción local con una Request interna y el constructor vigente reproduce ese Location.

H2: callback incorrecto registrado en Google. Descartada como explicación principal: la captura muestra el destino final de Conexiones con ID de intento, construido por el callback CRM; no es una página OAuth ni un rechazo de redirect_uri de Google. La configuración existente usa APP_ORIGIN para el callback y ya se comprobó en el preflight anterior.

H3 descartada para el intento reportado mediante lectura acotada de metadata: identidad y credencial guardadas, estado preparing, sin error. Se abrió su URL pública en el mismo Chrome y sesión legítima: el flujo automático terminó en ready. Una segunda lectura de metadata confirmó ready, credencial presente y error nulo. No se repitió Google ni se leyó el valor de la credencial. La sincronización todavía aparece pendiente en pantalla.

## Requisitos y diseño

- ORIGIN-AC01: todos los regresos del callback simple usan el APP_ORIGIN validado; request.url se limita a leer parámetros de entrada. Host y forwarded headers del request no deciden el destino público.
- ORIGIN-AC02: conservar module=connections, ID de intento y proveedor Gmail. Nunca incluir code, state ni tokens en la URL final.
- ORIGIN-AC03: configuración ausente, con credenciales, ruta, query/hash, esquema inseguro o host wildcard se rechaza antes del intercambio; no hay fallback al origen interno.
- ORIGIN-AC04: no cambiar identidad/MFA/cookie/PKCE, permisos de buzón, cuotas o SQL. Reintentos ya guardados regresan al CRM sin repetir Google.
- ORIGIN-AC05: ensayo focalizado, regresión relevante, TypeScript/build y revisión del diff. Publicación de la corrección queda preparada como continuación de la entrega autorizada, con reversa al commit anterior; no requiere migración ni backup de datos.

Cambio mínimo: helper de destino público comprobable, utilizado por el único destino compartido de las ramas del callback. No se refactoriza el intercambio OAuth ni se alteran los errores de Google en este incremento. Documentación Next instalada de cookies/Route Handlers revisada.

T01 diagnóstico/metadata; T02 constructor y regresión; T03 checks y payload; T04 publicación y smoke del destino público; T05 recuperación de intento guardado con la sesión legítima o entrega de su enlace público si requiere el navegador del usuario.
