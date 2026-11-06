# Base común y apertura de F2/F3 — 05/11/2026

SDD STRICT. El usuario autoriza preparar la base común conservando cambios y abrir dos chats con worktrees aislados. La clarificación ya está cerrada por esa instrucción y el reparto F1/F2/F3 acordado. No autoriza proveedores, push, despliegue, SQL remoto, cambios operativos o implementación de los nuevos frentes.

## Alcance y criterios

| FR / AC           | Resultado requerido                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BASE2-FR01 / AC01 | Capturar todos los archivos públicos actuales en un commit local de trabajo, con WIP preservado y ningún material privado. Base padre fb9f201; no es un release ni se presenta como build aprobado. |
| BASE2-FR02 / AC02 | Crear exactamente dos chats del proyecto local del CRM, cada uno en un worktree separado que contenga A/B/C completo, no solamente el HEAD histórico sin WIP.                                       |
| BASE2-FR03 / AC03 | F2 escribe solo connect-gmail y F3 solo operations-pilot; instrucciones por carpeta y techo explícito de planificación. Compartidos e integración permanecen bajo F1.                               |
| BASE2-FR04 / AC04 | Comprobar fuentes y ausencia de privados copiados antes de considerar listo cada worktree. Registrar commit, rama, carpeta y chat realmente devueltos por la app.                                   |
| BASE2-FR05 / AC05 | Conservar payload100, operativos49, Gmail directo, Composio deshabilitado, Instantly43 y trabajo del S01 anterior. Cero API de proveedor, envíos, SQL remoto, push/deploy o arranque de worker.     |

## Decisión BASE2-ADR01

Se usa un commit **local WIP de base común**, no un commit de publicación. El release Linux/QA sigue pendiente y no se promueve al crear la base. El commit incluye la selección pública revisada y estas instrucciones. Credenciales/env reales, .local, node_modules, .next, logs y adjuntos privados quedan fuera. Se revisa el índice y los patrones de secretos antes de registrar el commit; hooks y firma externos no se ejecutan para esta captura local.

Cada chat nuevo se crea con el estado actual de trabajo en un worktree mediante la app, tras fijar el commit. El prompt contiene el hash exacto de base y los límites. La comprobación posterior contrasta el payload y el árbol, admitiendo únicamente la normalización LF prevista por .gitattributes; no se ignoran cambios de código o secretos por coincidir los nombres de las carpetas. No se copia material del antiguo worktree S01.

La base se identifica por Git en el mensaje inicial y en el resultado posterior de esta apertura; no se inserta su propio SHA dentro del commit. [Reparto y pendientes](parallel-roadmap-20261105.md), [candidato de código conservado](s02/release/web-worker-20261105/manifest.json).

## Apertura y límites

1. Inventariar y preservar archivos públicos actuales, índice inicial y fuentes protegidas. Añadir instrucciones F2/F3; no tocar producto.
2. Sellar/registrar la base local con selección explícita de rutas, sin push, hooks externos o valores de env.
3. Crear el chat F2 de alta Gmail–Composio y F3 de piloto/operación, con worktrees separados. El primer encargo de ambos es discovery/documentación, no implementar o ejecutar servicios.
4. Verificar rutas/base/fuentes y ausencia de env/contadores del coordinador. Las modificaciones documentales propias de cada frente se distinguen de la base, sin resetearlas.
5. Observar una primera actualización compacta; registrar si comenzó, está preparando documentos o necesita una decisión nueva. No responder en nombre del usuario a sus preguntas.

Recuperación de la organización: conservar commit, carpetas y trabajo. No borrar/resetear worktrees o reutilizar el S01 antiguo para esconder un conflicto. Cualquier integración o cambio de permisos posterior se revisa explícitamente, sin tocar producción por abrir chats.

## Estado al preparar esta base

Gmail directo fijo y Composio deshabilitado en el código conservado. Instantly43 y ensayos C/D pendientes; 049 y postflight aceptados, sin repetición. El paquete ABC-WW-20261105 sigue siendo un candidato de fuentes, no una imagen nueva publicada. El resultado con IDs, commit y verificaciones se registrará después de crear efectivamente los chats, sin inventar esos metadatos ahora.
