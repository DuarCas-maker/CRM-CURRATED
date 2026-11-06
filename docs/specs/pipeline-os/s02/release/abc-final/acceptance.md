# Aceptación de la preparación SQL

- AF-AC01: dado el manifiesto de100 fuentes intactas y base47+048, generar exactamente una migración049 con cinco cuerpos en orden, un BEGIN/COMMIT de envoltura y sin guarda local de fixture. No interpretar materializar como autorización de ejecutar.
- AF-AC02: con contexto equivocado, grant humano fuera del contrato, fuente alterada, instalación parcial o replay, fallar antes de cambios persistentes. Un fallo posterior al primer DDL revierte todo el conjunto.
- AF-AC03: con defaults amplios de supabase_admin, el artefacto final debe producir la misma ACL efectiva de sus objetos que la referencia aceptada con defaults limpios. Probar anon, usuario propio/ajeno, servicio y superadmin; endpoints de evidencia C nunca accesibles al rol humano que no les corresponde.
- AF-AC04: mantener metadata fuera del delta y filas antiguas salvo columnas/revisiones y access_area derivado de fuente exacta. Sin nuevas marcas, asociaciones, intenciones, jobs, mensajes o verificaciones por aplicar el SQL. Gmail directo seleccionado por fuentes intactas.
- AF-AC05: postflight READ ONLY devuelve contrato/flags/cardinalidades/huellas; detecta drift de permiso/definición/metadata protegida y rechaza escritura. Comparación final con recibo después de Success del script completo; no replay si hay incertidumbre.
- AF-AC06: comprobar conservación de payload/SQL/contadores/HEAD y0 red/env/remoto. Las nuevas pruebas en PGlite no se reportan como PG15 nativo, contención, build o smoke de producción.
