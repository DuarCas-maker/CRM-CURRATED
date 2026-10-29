# S01: preparación del frente aislado

Leer AGENTS raíz y `../parallel-development.md`. Este chat trabaja en un worktree separado desde la base común; no modificar el checkout del coordinador.

Encargo inicial: T01-01, discovery y contratos SDD, utilizando las decisiones D01–D24 y los cuatro documentos raíz como fuentes de lectura. Escribir aquí discovery/spec/design/tasks/acceptance/verification; preguntas numeradas A/B/C o abiertas únicamente para ambigüedades nuevas. No inventar respuestas o pedir otra vez decisiones ya confirmadas.

No implementar producto, nuevos esquemas/RLS, importar o enviar contactos por el mero encargo de preparar S01. T01-02/03/04 se planifican con sus dependencias y requieren su incremento correspondiente. SQL preliminar solo en migrations/ de este directorio, sin numeración remota definitiva o aplicación real.

No usar APIs, abrir/copiar env reales, acceder a .local del coordinador, iniciar workers/servidores, desplegar o tocar Supabase remoto. Si faltan dependencias/runtime, informar qué no se ejecutó. Campos, mensajes, documentos y fixtures deben ser ficticios.

Los archivos comunes y contadores son del coordinador; proponer cambios antes de tocar un archivo fuera de `docs/specs/pipeline-os/s01/**`. No editar los cuatro documentos raíz ni AGENTS raíz. Entregar avances en este chat y documentos S01; no enviar mensajes a otros chats sin autorización directa del usuario.
