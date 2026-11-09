# CW-I03 — composición local del store

T-009 final recibido: seis fuentes y recibo SHA256 idénticos; no se escribió en F2 ni se copió runtime privado. Las12 pruebas unitarias originales pasan en root; el runner PG15 se omite por defecto sin crear cluster. Los12 escenarios/13 runner PG15.19 del recibo F2 son evidencia de origen, no una prueba nativa ejecutada aquí.

Cuatro pruebas nuevas en memoria usan el store/cifrado/motor/adaptador reales de código y RPC contra PGlite sobre CW/R06 completos: instalación/rollback con catálogo y ACL restaurados, candidato nuevo inactive sin credenciales/permisos, aprobación B1 explícita y verificación C2 antes de seleccionar R06, state cifrado, enlace incierto bloqueado y mailbox ajeno sin materialización. Ninguna petición real de proveedor.

La primera fixture pasó un objeto de marca en lugar de su UUID; se corrigió la fixture y sus tipos, sin modificar SQL o guardas. El flujo posterior pasó completo. El harness comprueba hashes y guards nativos, adapta únicamente en memoria con marcador propio y conserva los controles de estado cerrado/catálogo de la reversa. Los seis archivos se recibieron exactos. En la extensión HTTP posterior, store.ts recibe únicamente inspectIntent; SQL, cifrado y tests originales permanecen intactos. Se reconstruyó el store original removiendo ese método y se cotejó su hash con F2.

Resultados exactos de selección/TypeScript y preservación en manifest.json. Sin env reales, instalación, SQL remoto, mensajes, push/deploy o activación. Gmail directo, Composio apagado e Instantly43. La concurrencia física PG15 de la composición root, Auth/PostgREST/configuración reales y el corte web/worker siguen pendientes. La siguiente extensión HTTP/UI declarará cualquier delta posterior del store recibido por separado.
