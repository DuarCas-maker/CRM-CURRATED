# Criterios de publicación

| Criterio | Escenario | Evidencia |
|---|---|---|
| AC-001 |4.040 leads visibles, lectura sin COUNT, completar todas las páginas | tasks-overview-volume; task-leads caps1/17/500/1000; producción pendiente |
| AC-002 | Cuentas compartidas/alias/pendientes mantienen atribución; closer no lee leads | tasks-overview-accounts/reader,119/119 suite |
| AC-003 | Fallo detiene carga, reintento responde sin datos obsoletos | QA ficticia alert=true,busy=false,falseStageLoading=false; recuperación errors0,tabla=true |
| AC-004 | Consulta privada con token/cuerpo/identidad produce solo operación/tiempos | tasks-overview-observation, dos pruebas correctas |

Aceptar producción solo después de Success del SHA corregido, health y repeticiones reales de tabla/filtros en menos de30s. No se acepta únicamente porque /api/health responda o un GET sin límite termine eventualmente.
