# Aceptación — Usuarios (STRICT)

Fixtures ficticias: dos superadmins, cada uno de los cuatro roles restantes, un perfil inactivo, JWT AAL1/AAL2 y visitante anónimo.

| AC     | FR         | Given / When / Then                                                                                                                                                                                                           |
| ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001 | FR-001     | Dado rol no autorizado, inactivo, sin MFA o sin sesión; al listar/mutar/revelar; se rechaza sin ejecutar servicio ni mostrar módulo.                                                                                          |
| AC-002 | FR-002     | Dado superadmin MFA; al crear nombre/correo/rol/contraseña válidos; se crea identidad confirmada y perfil correcto sin correo, sin permisos de buzón automáticos.                                                             |
| AC-003 | FR-002     | Al repetir mismo request_id se conserva la identidad y no se sustituye contraseña; ID ajeno/datos diferentes/correo existente se rechazan; tras fallo de finalización se puede reanudar.                                      |
| AC-004 | FR-003     | Al buscar y paginar se devuelven solo metadatos de usuarios, total consistente y páginas de 25, sin texto ni cifrado.                                                                                                         |
| AC-005 | FR-004     | Al cambiar acceso ajeno se actualiza/audita; cambio propio o estado esperado desactualizado se rechaza, sin perder último superadmin.                                                                                         |
| AC-006 | FR-005     | Al establecer contraseña válida solo se llama Auth Admin; la contraseña no aparece en respuesta/log/metadata/DB; entrada débil se rechaza.                                                                                    |
| AC-007 | FR-006     | Al escribir/vaciar texto se persiste ciphertext/NULL y aumenta versión; editor desactualizado recibe conflicto; clave ausente o ciphertext alterado se rechazan.                                                              |
| AC-008 | FR-007     | Al abrir el diálogo no se descarga el texto; al pulsar ojo se recupera; al ocultar/cerrar/cambiar/pasar página a segundo plano se descarta. Copiar funciona sin mantener texto mostrado; fallo de portapapeles tiene mensaje. |
| AC-009 | FR-008     | Toda acción sensible deja actor/target/acción sin contenido ni huellas de secretos; fallo de auditoría previa impide cambio de contraseña.                                                                                    |
| AC-010 | FR-001/006 | Consultas directas de anon/authenticated (incluido propietario/superadmin) a tabla y RPC de servicio se deniegan; RPC de listado rechaza roles/MFA no autorizados.                                                            |
| AC-011 | FR-001–008 | UI tiene estados carga/vacío/error/éxito, formularios etiquetados, teclado/dialog, controles visibles en 360/768/1280 y demo sin operaciones reales.                                                                          |

Auth real, recepción de correo y despliegue no forman parte de la verificación local; no se declararán probados.
