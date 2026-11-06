# CR-001 — validar la consulta en el motor real mediante lectura

01/11/2026 · Aceptado por instrucción humana y resultado aportado por el operador. El usuario explicó que no hay entorno de pruebas y pidió realizar esta comprobación en la base real. La continuación se limitó expresamente a una consulta de catálogo READ ONLY en el Supabase self-hosted del CRM, sin migraciones, cambios de permisos/datos, instalación o despliegue.

## Cambio y alcance

La exigencia de ejecutar PD-R1 en PostgreSQL15 aislado antes de su primera lectura real se sustituye, únicamente para la compatibilidad de esta consulta, por una ejecución controlada en el motor real. Las32 pruebas funcionales de PD siguen siendo offline/PGlite18; no se afirman ejecutadas en producción. La nueva evidencia demuestra ejecución y contrato de PD-R1 en150008, no una batería destructiva, contención, compatibilidad de A/B/C o posibilidad de publicar.

No cambia el SQL revisado (`e6116007a597cc67f51be3c257c19f0469da3284715a3e0ff21c2746e19fca21`) ni el scope (`c323bbbea3b07afa2c30b3c6847e887c2a2d660be28ecb87497ff19582711b4a`). El agente intentó consultar el panel, pero el control del navegador se detuvo sin poder verificar su URL; no ejecutó SQL. El operador aportó después el resultado válido de PD-R1. No se declara una conexión API o sesión autenticada del agente.

## Impacto trazable

- PD-FR03/AC03 y PD-T04: compatibilidad de ejecución de la consulta enPG15 demostrada por la salida aportada, conservando como históricas las evidencias de implementación que marcaban pendiente ese paso. No borrar ni reetiquetar las32 pruebas PGlite.
- PD-FR05/AC05 y PD-T05/06: una ejecución de lectura reportada por el operador; sin retry ni permiso residual para nuevas consultas. El resultado es completo dentro del scope y sin exceso de límites.
- Datos, código, dependencias, migraciones y contratos del CRM: sin cambios. La remediación necesita especificación/QA/permiso propios; no se prepara ni aplica por aportar el resultado.
- REL-T03 continúa parcial por ACL/vistas/metadata de plataforma pendientes. G5/G6 de promoción, SQL definitivo y publicación siguen sin aprobarse.

Esfuerzo de esta adaptación bajo; riesgo acotado por READ ONLY/timeouts/scope y ausencia de datos de negocio en la salida. Las pruebas de escritura o de concurrencia seguirán requiriendo un entorno seguro distinto de la base productiva. No se usa esta excepción para ensayar migraciones en producción.

## Evidencia y recuperación

[Revisión del resultado](../result-review.md), input SHA256 `9aaaaf19fc497169b54b710866bc0af99f106ab88c73c681a69cc59ca404d430`. Sin instalación, costos adicionales, APIs de proveedores, correos, cambios remotos o consumo Instantly nuevo. Se mantiene43. El script termina con ROLLBACK; el JSON acredita contexto READ ONLY durante la consulta, no inspección independiente posterior de la sesión. No hay cambios de datos que revertir.
