# Verificación

Cambio STRICT autorizado: código, expansión SQL y recuperación del ingreso; sin activar campañas ni enviar pruebas.

- AC-001/002/003: pruebas monetarias con importes esperados independientes, referencia, formatos USD, nulos y conflictos. 21 pruebas unitarias aprobadas.
- Regresión: 42 pruebas aprobadas en 12 archivos, cubriendo cálculo, plantillas, secuencias, importador XLSX enriquecido, HTTP/origen/sesión, compatibilidad y worker. El caso adicional de la referencia se ejecutó después: 43 casos únicos comprobados.
- AC-004/005/006: ensayo PostgreSQL 15 temporal nativo aprobado y réplica PGlite. Recuperación idempotente, MFA/permisos, rechazo de ingreso ausente, no duplicación y preservación de modelo/ingreso al cambiar datos y reimportar. Ver native-result.json.
- TypeScript --noEmit aprobado. next build --webpack aprobado. git diff --check aprobado. Sin dependencias añadidas.
- SQL productivo aplicado con comparación de hashes del catálogo y respaldo previo de 114.865.743 bytes, listado y decodificado con pg_restore. No se ensayó restauración de desastre completa.
- Recuperación productiva: 2.122 filas, 2.072 correos únicos con ingresos interpretables; 2.052 coinciden con contactos existentes del lote. Se actualizaron esos 2.052. Los otros 20 no existen como contactos y se omiten; no se crean registros.
- Se comparó la huella de identidad/campos anteriores de los contactos y supresiones antes/después: idéntica. Se conservan 4.040 contactos, 4.030 leads y dos bloqueos activos. 25 campañas previas conservan funding_model=null. Sin nuevas campañas ni verificaciones Bouncer.

Publicación y AC-007 visual: pendientes de completar y registrar.
