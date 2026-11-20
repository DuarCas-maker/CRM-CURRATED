# Aceptación

1. Dado un saved reference accesible y un buzón directo antiguo conectado, con cuotas activas, descargar entrega los bytes completos y preview entrega esos mismos bytes y hash.
2. Dado un usuario sin acceso al origen, ambas operaciones fallan antes de credenciales, Storage privilegiado o Gmail.
3. Si se revoca el acceso o cambia la identidad del origen durante la preparación, no se emite la petición al proveedor.
4. Dado un archivo ya almacenado o bytes inline, no se consulta Gmail. Los archivos vacíos, demasiado grandes o de preview no soportado siguen rechazándose.
5. Una llamada Gmail ajena a estos lectores, sin el contexto previo exigido, continúa denegada. No hay envío ni fallback nuevo.
6. Al obtener la vista previa, `DocumentIntake` conserva su identificación automática por hash, autorización/caché y confirmación humana. La prueba usa OpenAI simulado; una prueba real requiere el despliegue autorizado y no guarda ni aprueba el documento por sí sola.
