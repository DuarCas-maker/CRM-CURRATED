# Rollout y rollback — Usuarios

## Preparación local autorizada

1. Revisar/aplicar 054 únicamente en base efímera con datos ficticios; probar reversa allí.
2. Pruebas offline, typecheck y build sin cargar `.env` reales; revisar diff y QA visual si el entorno lo permite.
3. Entregar fuentes, SQL y limitaciones verificadas.

## Publicación futura (requiere autorización explícita)

1. Confirmar destino, backup y revisiones efectivamente instaladas (paquetes 048–053 se gestionan aparte; 054 no los reemplaza). Verificar SDK/Auth acepta id en createUser.
2. Aplicar `docs/specs/user-management/migrations/054_user_management.sql` antes de publicar web. Se entrega como paquete independiente, igual que 048–053; no reemplaza el catálogo histórico base47. Mantener clave de cifrado existente y comprobar que esté disponible, sin imprimirla.
3. Publicar web aprobada. Worker no requiere cambios. Smoke con usuarios QA: denegación de otros roles, crear ficticio, acceso, contraseña y texto; MFA sigue obligatorio.

## Rollback

Volver a la versión web previa y conservar tabla/ciphertexts. No revierte automáticamente contraseñas o accesos ya modificados ni borra usuarios. Reversa SQL en `migrations/054_user_management.rollback.sql`; elimina objetos nuevos y datos privados, por lo que fuera de la base efímera requiere backup y autorización explícita. No ejecutar la reversa como migración forward.
