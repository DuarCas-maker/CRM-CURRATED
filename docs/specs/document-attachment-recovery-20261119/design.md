# Diseño y decisión

## ADR-001: lectura humana ligada a un adjunto autorizado

Reutilizar `withMailboxScope` para la lectura GET exacta de un adjunto de un buzón directo antiguo. El lector comprueba el origen antes de consultar la configuración privilegiada y vuelve a validarlo antes de emitir la petición. No se relaja `gmail()` ni se inventa una prueba de trabajo del worker.

Un helper interno construye únicamente `messages/<message>/attachments/<attachment>` a partir de identificadores validados. Si ya existe un contexto, respeta la cuenta; las cuentas gestionadas conservan su runtime y los proveedores configurados. El contexto directo antiguo usa revisión0/directOnly, de modo que un cambio concurrente al ruteo gestionado falla cerrado.

La autorización se aporta desde el lector del origen: RLS del archivo, identidad del adjunto y cuenta/mensaje de su archivo original. Revalidar también el archivo cifrado del snapshot evita usar un origen reemplazado. Los datos sensibles y credenciales nunca se registran.

`/api/gmail/files/[id]` reutiliza `documentBytes(saved)` para que descarga, preview y clasificación tengan una fuente única. `readArchiveAttachment` conserva la ruta de Storage y los datos inline sin peticiones Gmail; la fuente legacy conserva sus comprobaciones específicas.

## Límites

No contratos HTTP nuevos, SQL, permisos nuevos, dependencias, secretos, cambios de worker o proveedores. Se conservan cuotas y validación de emisión. El máximo sigue siendo20MiB. Los errores de autorización no deben transformarse en una descarga parcial ni en fallback de proveedor.

## Rollout y reversa

Pruebas negativas y regresión offline, TypeScript y build aislado antes de solicitar publicación. Para publicar este incremento se requiere autorización específica del usuario. Reversa: retirar solo este delta en una nueva revisión, conservando avances posteriores; sin restaurar datos ni cambiar cuotas/env. La base de recuperación es `4cbe7e8`.
