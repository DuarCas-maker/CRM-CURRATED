# WC-I01 — ejecución acotada del worker

08/11/2026 · SDD STRICT · implementación autorizada por «perfecto, hazlo». Origen: P-001/P-002 de F3, elección B del lanzamiento y un envío/una respuesta confirmados. La ronda de alcance está cerrada: implementar y probar el control; no ejecutar un piloto real por disponer de él. Gmail directo e Instantly43 se conservan; Composio permanece sin activar.

| FR / AC | Resultado exigido                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WC01    | Modos normal, paused y pilot explícitos; configuración inválida falla antes de procesar. Normal conserva el recorrido existente. Paused/pilot no ejecutan scheduler, campañas, sender global, notificaciones o claim_job. |
| WC02    | Pilot solo reclama un outbox manual exacto de una cuenta y destinatario; mantiene todas las guardas B2. Nunca reclama otra fila ni cae en notification_outbox.                                                            |
| WC03    | Ensayo/lease/consumo durables, una sola adquisición, máximo un POST send; réplicas y reinicios no renuevan presupuestos ni reenvían.                                                                                      |
| WC04    | Cuenta/ruta/proveedor/lease se comprueban antes de acceder a OAuth; cada HTTP Gmail/OAuth/Composio se reserva antes de la red, incluidos fallos. OAuth del piloto no usa reintentos ocultos del SDK.                      |
| WC05    | Solo consulta el hilo ya asociado al outbox enviado. No sincroniza buzones completos ni ejecuta jobs derivados; las escrituras normales de ingestión y jobs encolados quedan inventariadas.                               |
| WC06    | Revocación, vencimiento, falta de presupuesto o error detienen futuras llamadas. Un envío incierto conserva la incertidumbre, sin replay, devolución de cupo ni recuperación automática de lease.                         |
| WC07    | Pruebas con SQL/dobles y red externa bloqueada; no env reales, APIs, SQL remoto, envíos, push o despliegue en esta entrega.                                                                                               |

Dependencia: SQL aditivo de ensayo sobre A/B/C aceptado, sin repetir ni editar048/049. El operador deberá detener/drenar réplicas antiguas y emisores ajenos antes de un piloto real; un lease del nuevo código no puede controlar binarios viejos. No se presenta como interruptor global de web/otros servicios.

No objetivos: alta OAuth Composio (F2), activación del transporte, piloto real, UI de control o habilitar una cuota específica. Los límites se suministrarán en una preparación privada futura; no se hereda el sobre20+1 de F3 ni remanentes S00. Campos/historias de usuario nuevos de la app: no aplica.
