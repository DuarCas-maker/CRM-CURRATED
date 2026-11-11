# Aceptación I05

1. Base051 compatible, quota ausente y cola quieta: el preflight informa catálogo
   correcto; mantiene `publicationReady:false` porque no puede acreditar pausa,
   imágenes o autorización.
2. Diferencia de fuente/ACL/dependencia, objeto v2 preexistente o trabajo en vuelo:
   no se realiza DDL; informe acotado o excepción con grupos/objetos/campos.
3. Aplicación052 completa: catálogo final coincide, huellas antes/después iguales,
   cabeza sin política, presupuesto/checks vacíos y Gmail conservado.
4. Repetición052: falla antes del DDL. No usar IF NOT EXISTS para ocultar drift.
5. ROLLBACK transaccional: catálogo y datos vuelven a su punto de partida.
6. Reversa posterior sin uso: conserva datos/consumo y bloquea las nuevas RPC.
   Una política utilizada impide esa reversa automática.
7. Fuentes web/worker del mismo manifiesto, flags apagados, sin cambios en código
   durante la preparación. Estado remoto, build Linux y health se aceptan después.
