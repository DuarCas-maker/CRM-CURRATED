# Aceptación — ABC-WW-20261105

- AC01: el candidato reproduce bytes de todas sus fuentes, identifica base/árbol y excluye material privado; el índice y HEAD se conservan.
- AC02: payload100 y operativos49 sin cambios; código directo fija gmail_oauth y las pantallas técnicas no activan Composio. No se consultan flags reales ni se consumen peticiones.
- AC03: CMD web/worker carecen de ejecución de migraciones y la guía para el CRM señala explícitamente que 048/049 no se repiten. No se crea historial remoto ni cambia el inventario base47.
- AC04: revisión de Dockerfiles, lockfile y entrypoints registrada; comprobaciones de tipos/worker no producen tráfico. Los checks bloqueados no se convierten en pass ni se repiten compilaciones con idéntica limitación.
- AC05: fixture con datos sintéticos/red bloqueada, idioma/viewport/estado anotados; cada combinación sin inspección permanece pending. No se reproducen pilotos de negocio ya aceptados.
- AC06: mismo candidato para ambos servicios, smoke y rollback explícitos; publicación y arranque quedan sin ejecutar ni autorización implícita.
