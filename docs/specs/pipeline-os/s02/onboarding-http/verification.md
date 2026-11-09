# HTTP/UI — verificación y límites

Rutas Next reales de código llamadas con puertos inyectados: cookies, claims Auth, HTTP proveedor y reloj son ficticios; store, cifrado, orquestador y SQL compuestos usan su implementación real sobre PGlite. La precarga bloquea fetch/http/https/socket/TLS/DNS reales. TypeScript sin emitir ni caché incremental. Resultado exacto y huellas en manifest.json.

La revisión de sesión exige getClaims verificado del SDK, sub/session_id/aal2/exp/role y lectura del perfil exacto y activo; no decodifica un JWT sin verificar. Cookies contienen proof y metadata ligada al intento/sesión, nunca permisos. DTOs no contienen estado OAuth, URL de consentimiento, API key o ciphertext. Callback restringido al contrato estándar y retorno303 a APP_ORIGIN.

T-009 se recibió con seis fuentes idénticas al recibo F2. La única extensión posterior de ese store es inspectIntent, una proyección administrativa mediante el load autorizado existente; se registra por separado antes/después. Sus SQL/cifrado/tests originales permanecen intactos. Tres archivos previamente existentes reciben únicamente el montaje/retorno del panel y ejemplos de variables; reconstrucción contra baseline en el manifiesto.

El panel se probó con Edge headless, perfil propio y fixture local, sin servidor de app ni env.14 capturas ES/EN a360/768/1280; recorrido de teclado y estados del flujo, cero red externa. No sustituye QA de sesión y navegador reales tras publicar. No se ejecutó build Linux/Next productivo ni ensayo físico PG15 de esta composición.

No se ejecutaron proveedores, SQL remoto, mensajes, push o deploy.049 y privados operativos se preservan; Gmail directo activo por defecto, Composio apagado, Instantly43. G6/publicación/piloto siguen pendientes según runbook.md.
