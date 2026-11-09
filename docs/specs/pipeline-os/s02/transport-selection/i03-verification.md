# R06-I03 — evidencia de recepción y panel offline

08/11/2026 · STRICT · Implementación local de R06-T07/T08. [Diseño](i03-design.md), [operación](i03-runbook.md), [inventario y huellas](i03-implementation.json). T09/T10 y la operación real no se declaran terminadas.

## Resultado funcional comprobado

| FR / AC             | Evidencia nueva                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 06 / 06             | Cuenta Composio ficticia registrada/verificada mediante la composición DB, sin `mail_credentials`: el scheduler la incluye, el proxy simulado lee profile/lista, todas las peticiones quedan vinculadas al ciclo y el cursor decimal grande se conserva exactamente |
| 06,08 / 06,08       | Paginación/deduplicación, history404, mensaje borrado404, ingestión fallida, identidad de mensaje incorrecta, respuesta malformada, token repetido, cuota, contexto/deadline/revisión/época/CAS obsoletos; nunca confirmar un cursor incompleto                     |
| 04,06 / 04,06       | Una sola sincronización por cuenta; incertidumbre bloquea otro ciclo y el cambio de transporte, incluso vencida; un rechazo contractual429 aborta sin mover cursor y permite el siguiente ciclo, sin repetir una petición dentro del intento                        |
| 06,08 / 06,08       | Scheduler con revisión, live/sync y proveedor; polling proxy sin watch, jobs antiguos retirados sin efecto; push autenticado antiguo no encola para proxy/pausado, directo lleva revisión y error DB no usa fallback                                                |
| 04,08 / 04,08       | Callback directo reclamado antes de una transición: `brand_oauth_finish` falla antes de cambiar credencial o crear jobs. Inicio reconnect también bloqueado en transición. Reemplazos SQL con huellas y anchors exactos                                             |
| 03,07,09 / 03,07,09 | Review humana/MFA, CAS saneado, sin tuple externa/secretos; flag apagado produce0 RPC; sin sesión/MFA/rol no hay acceso. Composio bloqueado impide preparar/confirmar su activación y permite pausar/cancelar                                                       |
| 07,09 / 07,09       | Panel ES/EN distingue asociación, transporte, recepción y trabajo sin resolver; no selecciona cuenta automáticamente, demo/no-admin no lo exponen y cada mutación exige confirmación separada                                                                       |

SQL privado con RLS y sin DML para anon/authenticated/service_role; siete RPC nuevas service-only, una review humana y dos helpers privados. Dos tablas/dos índices. Tres funciones existentes se reemplazan únicamente en el candidato local con source pin: command de transporte y begin/finish OAuth. Ensayo transaccional ROLLBACK restaura las definiciones previas y retira los objetos nuevos. No cambia049 ni sus guardas.

## Checks

Pasada completa final: **262 correctos,0 fallos,1 omitido;263 casos/grupos**. Son38 casos/grupos nuevos y224 regresiones correctas más la omisión nativa. Log `.local/pipeline-os/r06-i03-20261108/qa-final.tap`. Incluye las cinco suites nuevas, Gmail sync previo y la regresión I01/I02/WC/CW/B2/C2/C3, uso y bindings/UI. La única omisión es el ensayo nativo T-002 opt-in ya separado; PGlite no lo sustituye. TypeScript directo y formato de los archivos del delta correctos; no se instaló ninguna dependencia.

Las fixtures negativas comprobaron que ACL y formato de capability realmente rechazan accesos incorrectos. Se corrigieron dos invocaciones de test que usaban rol/capability inadecuados y una expectativa de fecha UTC equivocada; no se relajó ninguna guarda del producto. Las pasadas finales y su inventario sustituyen esos resultados intermedios.

La revisión comprobó además la política de sesión/configuración ausente: impide review humana y la admisión del proveedor, aunque la selección histórica siga en ready. Se conserva ese cierre; no se introduce una política MFA/sesión alternativa ni se confunde el bloqueo de operación de producto con ausencia de configuración de seguridad.

La reconstrucción en memoria de `worker/gmail.ts` devuelve exactamente el SHA256 I02 `035b210c6f655208499e8c0dd82f6683ade919a360cd58814425afc917832df7` al retirar las nuevas ramas/imports de recepción y watch. Esto conserva íntegros sender, MIME, ingestión, adjuntos y conciliación anteriores; no es una repetición del piloto aceptado. Los scripts de inventario comprueban HEAD/índice, fuentes ajenas, privados operativos y SQL049 sin exponer su contenido.

QA visual: seis capturas de fixture ES/EN en viewport real360/768/1280, todas sin overflow horizontal. Inspección de las vistas móvil/tablet/escritorio y orden Tab real select/revisar/pausar/preparar. Edge con perfil aislado y red externa bloqueada; solo CDP loopback y archivos propios. No se certifica todavía el modal/flujo completo de la app con auth ni accesibilidad integral por estas capturas.

## Límites y siguiente entrega

No PostgreSQL físico concurrente, Next build/Linux/Coolify, auth real, OAuth, configuración remota ni prueba operacional Composio en este turno. No servicios de aplicación ni worker de negocio, credenciales reales, proveedores, envíos, verificación de leads, SQL remoto, push o deploy. Gmail directo y flags previos conservados; Instantly43/0 nuevas.

F2: comprobación del chat y documentos públicos08/11: T-003 motor27/27 y T-004 adaptador22/22 completados offline en su worktree; T-009 de persistencia/cifrado/store preparado, sin implementación y pendiente de su autorización en ese chat. No se copiaron parciales, `.env`, `.local`, dependencias ni se enviaron mensajes. El root conserva únicamente el T-002 recibido previamente y su delta CW declarado.

Siguiente entrega: conciliar las fuentes terminadas de alta F2 y el próximo store con esta recepción, luego empaquetar SQL final y versión web/worker. Habilitación live/sync, asignaciones, configuración acreditada, corte y piloto presupuestado son pasos explícitos posteriores; ninguna selección del panel los reemplaza.
