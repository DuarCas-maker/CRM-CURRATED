# Especificación — Administración de usuarios

Nivel STRICT · v1 · 2026-11-16 · Implementación local autorizada por la solicitud y respuestas 1A/2A/3A/4A. Publicación y SQL remoto pendientes de autorización.

## Contexto y objetivos

Next.js 16.3.8 / React 19.3 / TypeScript / Supabase, pnpm 11.19.0. `requireUser` exige perfil activo y MFA AAL2. Configuración muestra el equipo y permite invitaciones; `crm_command('user_role')` ya cambia rol/estado e impide modificar el acceso propio. Los perfiles son legibles por otros roles, por lo que no pueden contener el texto privado.

Objetivo: administrar accesos y un texto privado independiente por usuario desde una sección exclusiva para superadmin. Se reutilizan estilos, diálogos, protección de formularios y los cinco roles existentes.

## Personas, alcance y flujos

Solo un superadmin activo con MFA puede listar el módulo, crear usuarios, cambiar accesos, establecer contraseñas y guardar/revelar/copiar texto privado. Otros roles conservan el directorio operativo existente, sin acceso administrativo. Flujo: abrir Usuarios, buscar, crear o administrar una persona, guardar una acción explícita.

Incluye nombre, correo, rol y contraseña al crear; edición posterior de rol/estado, contraseña y texto privado. No incluye borrar usuarios, editar correo, roles personalizados, recuperar contraseñas anteriores, envíos de invitaciones, restablecer MFA ni activar proveedores.

## Requisitos funcionales

| ID     | Requisito                                                                                                                                           | Origen / prioridad         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| FR-001 | Módulo y API exclusivos para superadmin activo con MFA                                                                                              | Solicitud / alta           |
| FR-002 | Crear con nombre, correo normalizado, uno de los cinco roles y contraseña elegida, sin enviar correo                                                | 1A, 2A / alta              |
| FR-003 | Listar/buscar usuarios con rol y estado, con paginación                                                                                             | Administración / alta      |
| FR-004 | Cambiar rol y activar/desactivar otro usuario, sin perder el acceso propio                                                                          | 4A, regla existente / alta |
| FR-005 | Establecer una nueva contraseña sin consultar ni almacenar una copia reversible de la contraseña de acceso                                          | Solicitud / alta           |
| FR-006 | Guardar/reemplazar/vaciar un texto privado por usuario, cifrado y separado de perfiles                                                              | 3A / alta                  |
| FR-007 | Texto oculto por defecto; revelar explícitamente, volver a ocultar y copiar; limpiar al cerrar/cambiar usuario y al perder visibilidad de la página | Solicitud / alta           |
| FR-008 | Auditar acciones sin contraseñas, texto privado, ciphertext ni huellas de secretos                                                                  | Seguridad / alta           |

## Requisitos no funcionales y reglas

- NFR-001: autorización de servidor en cada petición; origen verificado en POST; respuestas `private, no-store`; sin secretos en URLs ni almacenamiento del navegador.
- NFR-002: nombre 1–100 caracteres, correo válido hasta 254, contraseña 12–128 caracteres sin recortar, texto privado máximo 4.000 caracteres; body limitado a 32 KiB.
- NFR-003: formularios etiquetados, botones de iconos con nombre, foco/dialog de la app, mensajes de carga/error/éxito y diseño 360/768/1280.
- BR-001: no cambiar el rol ni desactivar la propia cuenta. La contraseña propia sí puede cambiarse con MFA.
- BR-002: reintentar creación con la misma clave conserva la identidad y no sustituye su contraseña; un correo existente se rechaza. No hay reintentos automáticos de mutaciones Auth.
- BR-003: MFA se mantiene obligatorio para nuevos accesos. Crear no concede permisos de buzones/marcas ni dispara trabajos.
- BR-004: escritura privada usa versión para detectar ediciones simultáneas; vaciar conserva la versión, evitando sobrescrituras silenciosas.

## Estados, validaciones y errores

Usuarios activos/inactivos; crear produce acceso activo sujeto a MFA. Texto sin guardar/guardado/mostrado/oculto. HTTP 400 entrada inválida, 401 sin sesión, 403 sin rol/MFA/actividad u origen inválido, 404 usuario inexistente, 409 correo/versión en conflicto, 413 tamaño, 503 esquema/cifrado/Auth no disponibles. Errores de proveedores no se reproducen al cliente.

## Casos límite, dependencias y restricciones

Listas vacías, búsqueda sin coincidencias, duplicados de correo e invitaciones pendientes, doble clic/reintento, fallo Auth antes/después de creación, fallo de finalización de perfil, falta de clave, cifrado alterado o de otro usuario, cambios de rol concurrentes y portapapeles denegado. Sin backfill: tabla privada nueva. Volumen real de usuarios y esquema remoto no consultados; no se requieren datos reales para verificar localmente. Dependencias ya instaladas; sin dependencias nuevas.

Supuestos de negocio: ninguno. Decisiones de implementación: ver diseño y ADR. Cumplimiento legal específico: no aplica a esta entrega técnica local; no se añade información personal adicional.

## Aceptación y preguntas

Criterios detallados AC-001–AC-011 en `acceptance.md`; cada FR enlaza a tareas y pruebas en `verification.md`.

| N.º | Ronda | Pregunta            | Opciones / recomendación                                          | Respuesta | FR         |
| --- | ----- | ------------------- | ----------------------------------------------------------------- | --------- | ---------- |
| 1   | 1     | Roles a asignar     | A actuales (recomendada), B nuevos                                | A         | FR-002/004 |
| 2   | 1     | Forma de alta       | A directa con contraseña elegida (recomendada), B invitación      | A         | FR-002/005 |
| 3   | 1     | Ubicación del texto | A por usuario (recomendada), B general                            | A         | FR-006/007 |
| 4   | 1     | Cambios de acceso   | A rol y activar/desactivar (recomendada), B alta/contraseña/texto | A         | FR-004     |

## Historial

2026-11-16 — v1: clarificación cerrada; alcance local confirmado.
