# Candidatos SQL del bloque A, solo ensayo local

`a-brand-foundation.local.sql` y `a-mail-permissions.local.sql` componen I01/I02 sobre001–047. Ambos exigen `pipeline_os.block_a_local=in_memory_test`. No están en supabase/migrations, no tienen número definitivo y **no deben ejecutarse en el SQL Editor remoto**.

El candidato de permisos contiene las29 definiciones de funciones existentes que cambia S01, materializadas sobre la base revisada. No captura catálogo temporal ni modifica funciones mediante reemplazos de texto al aplicarse. Los auxiliares de autorización conservan el esquema S01 revisado, `search_path` y privilegios mínimos. El test nuevo compara funciones, tablas/vistas, columnas/grants, constraints, índices, triggers y políticas con el resultado de los fixtures originales sobre otra base descartable.

Los cuatro fixtures bajo `tests/fixtures/pipeline-os-s01/` conservan los bytes de S01 y sus marcadores originales. Sus reversas solo sirven en la sesión de sandbox. Recuperación operativa futura: pausa y corrección compatible hacia adelante; nunca restaurar la apertura de021 ni borrar historia para revertir.

Antes de promover estos candidatos hace falta T00-02-I: catálogo/privilegios/Storage efectivos, procedencia y agregados de legado, versiones de lectores/escritores y plan de recuperación. El coordinador elegirá entonces nombres/números y removerá las protecciones de ensayo únicamente con una revisión explícita del delta final. No se reaplican030/046/047.
