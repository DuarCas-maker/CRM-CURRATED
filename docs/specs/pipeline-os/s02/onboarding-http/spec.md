# Alta Gmail desde Configuración — HTTP/UI offline

08/11/2026 · STRICT · implementación autorizada al pedir «Hazlo» para integrar persistencia y completar rutas/botón. Reutiliza las siete respuestas de alta F2 y las guardas A/B/C/R06. Sin llamadas reales, SQL remoto, activar Composio, mensajes, push o deploy; Instantly43 y Gmail directo conservados.

| FR / AC          | Criterio verificable                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP-FR01 / AC01 | Flag de alta false por defecto; sin descriptor/keyring/origen coherentes responde indisponible antes de RPC/proveedor. No env ni API key en browser/DTO                                                                     |
| HTTP-FR02 / AC02 | Toda operación requiere superadmin activo/MFA, claims criptográficamente verificados y sesión original; SQL revalida roles/revisión/TTL. POST con Origin exacto, cuerpo acotado/schema estricto                             |
| HTTP-FR03 / AC03 | Inicio fija cuenta nueva/existente/reconexión, Gmail esperado y marca; estado aleatorio y proof en cookie host-only Secure/HttpOnly/SameSite=Lax con deadline original. Un buzón por intento, sin traslado a otra sesión    |
| HTTP-FR04 / AC04 | Crear enlace requiere POST explícito/recibo; navegar usa POST protegido y303 a URL validada. Callback estándar valida state/cookie/sesión/cuenta esperada, rechaza duplicados/param extra y no muestra URL/tokens en estado |
| HTTP-FR05 / AC05 | Pendiente de marca requiere confirmación B1 aparte y adopción explícita. Solo entonces registrar candidato mediante concesión servicio + RPC humana; no entrega can_send, live/sync o transporte                            |
| HTTP-FR06 / AC06 | Panel ES/EN con nuevo/existente/reconectar, estado/deadline, retomar/cancelar/revisión/registro; sin activación automática ni retries de proveedor. UI usa componentes y tokens existentes                                  |
| HTTP-FR07 / AC07 | Tests offline de rutas contra store/SQL compuestos, sesión/MFA/origen/cookies/replay/identidad/incertidumbre y UI de fixtures; no confundir con OAuth real o build publicado                                                |

La configuración/procedencia real y callback estándar del proyecto se acreditarán antes de activar el flag y presupuestar la prueba. El flujo estándar conserva state y devuelve status/connected_account_id según documentación oficial; session_uri del verificador global se rechaza, no se redime por este incremento.
