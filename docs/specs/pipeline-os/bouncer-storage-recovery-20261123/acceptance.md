# Aceptación

- AC-001 / FR-001: 502 UUID únicos generan actualizaciones 100/100/100/100/100/2, cada URL menor de 4.500 caracteres; 0, 100 y 1.000 también funcionan.
- AC-002 / FR-001: HTTP 400/401/402/403/429 guarda el motivo en esos mismos bloques y no programa sondeo.
- AC-003 / FR-002: error ambiguo o fallo después del primer bloque no repite POST, conserva reservas y se detiene ante el fallo de DB.
- AC-004 / FR-003: lote completado, 502 resultados únicos, diferencia simétrica de correos cero y cohorte local sin cambios; en caso contrario no conciliar.
- AC-005 / FR-004: recuperación de resultados exclusivamente mediante GET y función SQL existente, respaldo previo, conteo final de 502 resultados; despliegue del commit correcto en worker.
- AC-006 / NFR-001: sin claves, correos reales o payloads privados en Git, logs ni evidencia pública.
