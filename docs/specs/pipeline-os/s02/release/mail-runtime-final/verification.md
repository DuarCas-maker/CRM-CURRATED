# MR-FINAL-r1 — resultados locales

**MR-AUTH-r1 posterior:** [corrección y evidencia](auth-session-bugfix.md). La guarda inicial rechazó el tipo real de refreshed_at; se adapta en el generador y se convierte el timestamp naive UTC explícitamente en live_actor/session_limit, con dos overloads privados. Seis fuentes originales intactas. Regresión actual:371 casos/grupos,369 correctos, cero fallos, dos omisiones nativas; TypeScript correcto y24 casos/grupos focalizados correctos. Resultados vigentes en manifest.json; los355 correctos y el build descritos abajo corresponden a la entrega anterior. El build no se repite por cambios exclusivos de SQL/herramientas offline; producto/config/worker conservan sus bytes.

Preparado050, preflight, postflight y contrato desde seis fuentes completas y fijadas por hash. Generación en memoria sobre048/049 ficticios; ninguna aplicación remota. Se conservó el archivo049 aceptado sin cambios. Retirados solo wrappers de fixture de las copias generadas; siguen source pins, anchors, guardas de identidad/roles y ACL.

La primera consulta de catálogo nueva omitía dos campos del CTE de schemas; se corrigió en el generador antes de producir el paquete. La primera fixture de job usó search_path implícito y omitió dedupe_key; se corrigió la fixture, sin relajar restricciones del SQL. TypeScript detectó tipos desconocidos de los resultados de test; se tiparon esas lecturas.

## Resultado observado

- Diez escenarios nuevos: generación determinista, preflight sin escrituras, rol/Auth/esquema incompatible, job activo, rollback completo, fallo del contrato final, CRLF del archivo/cuerpos heredados, COMMIT y postflight, ACL/objetos privados extra y CSP.
- Selección final de34 archivos:357 casos/grupos, **355 correctos, cero fallos, dos omisiones** de runners PG15 nativos T-002/T-009 opt-in. No se iniciaron esos clusters. Red real bloqueada por precarga; proveedores/RPC/Auth simulados según cada suite.
- TypeScript --noEmit --incremental false correcto. Formato y git diff --check; conservación de fuentes previas salvo CSP/test y documentación/metadatos declarados, privados operativos y049 cotejados en el manifiesto.
- **Next16.3.8 compiló correctamente con webpack en Windows/Node22.23.4**, en copia aislada del contexto público. Variables ficticias, sin archivos env reales, dependencias existentes enlazadas, sin instalación y con red bloqueada.49 páginas estáticas generadas, TypeScript de build correcto. No es un build Linux ni prueba de sesión real.
- **Worker en paused** arrancó en esa copia y generó su heartbeat, sin proporcionar credenciales y con red bloqueada. Solo se ejecutó ese proceso aislado; fue detenido por el harness. Esto no prueba DB, sincronización o envío.

El cambio de CSP añade únicamente https://connect.composio.dev a form-action, porque el formulario autorizado hace303 hacia ese host. Se conservan Google/default-src/base-uri/frame-ancestors; no se añade fetch a Composio desde el navegador. Código de producto anterior reconstruible al retirar solo el dominio/comentario nuevos; el test esperado actualiza esa misma lista.

## Límites pendientes

El contrato usa metadata lógica PG15 y normaliza únicamente LF/CRLF en prosrc. Constraints/índices/deparser y concurrencia real **requieren ensayo físico PostgreSQL15**; no se acreditan con PGlite ni aceptando a posteriori otro hash. El postflight comprueba targets/ACL, sin certificar objetos base ajenos al contrato o datos de clientes entre sesiones. El instalador sí verifica preservación del catálogo fuera del delta dentro de su propia transacción.

Faltan ensayo nativo, controles actuales de destino/pausa/recuperación y construcción/publicación Linux de web/worker, configuración auténtica y piloto propio. El archivo histórico de A/B/C no incluye estos incrementos; usar el nuevo inventario sellado. No hay push/deploy, SQL remoto, enlaces OAuth, verificaciones pagas ni mensajes; Instantly43, Gmail directo, Composio y alta apagados.
