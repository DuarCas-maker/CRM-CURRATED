# CW-I02 — diseño y decisión de integración

## Decisión CW2-ADR01

Copiar solo entregas finalizadas T-003/T-004 bajo sus huellas, sin fusionar la rama F2 completa. El worktree contiene T-009 activo; un merge o snapshot total incluiría archivos todavía no verificados. No trasladar `.local`, `.env`, node_modules, diarios ni la autorización de pruebas de otro chat.

Mantener byte a byte las siete fuentes y sus tests originales. El motor requiere `ConnectStore`, sesión y reloj explícitos. El adaptador requiere descriptor esperado, credencial y fetch inyectados; no hay fallback al fetch global. La compatibilidad con la extracción de contexto neutro R06 se comprueba con la exportación C2 existente, sin sustituir el verificador ni activar el adaptador operativo.

El descriptor de alta contiene generación, proyecto, auth config, owner, modo callback y contexto C2. El contexto de R06 contiene proyecto, versión de credencial, cuota y procedencia revisada. Que los schemas coincidan prueba compatibilidad local, no acredita esos datos en el proyecto real. La identidad primaria del perfil normalizada por el adaptador es suficiente para comparar el alta; no incluye grants efectivos ni autorización de entrega y no debe convertirse por defecto en evidencia positiva C2.

## Composición de prueba

Fixture propia, sin extraer ni modificar tests de origen: store pequeño con recibos/CAS/capacidades y contexto mutable, reloj virtual y configuración sintética. El motor usa el adaptador terminado con respuestas HTTP en memoria. Capturar solicitudes emitidas y resultados saneados, nunca secretos/URLs privados en el reporte. El happy path crea un enlace ficticio y realiza las tres lecturas de identidad; se confirma únicamente un candidato. Una identidad distinta se rechaza; una emisión sin resultado conserva incertidumbre; cambios de descriptor deben fallar antes de HTTP.

No crear un store de producción paralelo a T-009 ni sustituir sus futuras transacciones por el fixture. No usar el SQL T-002 como si implementara las fases nuevas del motor. T-009 integra cifrado/correlación y persistencia de fases en su propio alcance autorizado.

## Entrega y reversa

Recibos de origen congelados, inventario propio con SHA256 y límites observados. La reversa local retira exclusivamente estas adiciones tras revisión; no hay efecto remoto ni fuente existente de producto que revertir. No usar reset/stash/clean. La publicación posterior tendrá su paquete SQL/binarios/corte revisado y no repetirá048/049.
