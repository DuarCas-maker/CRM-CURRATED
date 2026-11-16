# Tareas — Usuarios

STRICT · spec/design v1 · 2026-11-16

| T     | Objetivo / archivos                                                          | FR / AC                                            | Estado / evidencia                                                                     |
| ----- | ---------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T-001 | Contratos, migración 054, reversa y pruebas DB aisladas                      | FR-001/003/004/006/008; AC-001/004/005/007/009/010 | done — PGlite, reversa y reaplicación; ver verification.md                             |
| T-002 | Servicio Auth/cifrado y API /api/users, pruebas negativas/recuperación       | FR-001/002/005/006/008; AC-001/002/003/006/007/009 | done — pruebas HTTP/servicio, cifrado y reconciliación; 13/13 finales                  |
| T-003 | Pantalla Usuarios, navegación, diálogo y estilos, pruebas UI                 | FR-001–007; AC-008/011                             | done — render y QA local ficticia, captura/teclado/copiar                              |
| T-004 | Typecheck, build aislado, regresión pertinente, revisión de diff y evidencia | Todos                                              | done — build/smoke/typecheck/formato; regresión con cuatro fallos basales documentados |

Definition of Done: cada tarea pasa a done solo con pruebas/evidencia en verification.md. No se crean agentes/chats ni se modifica WIP ajeno. Producción y proveedores fuera del alcance.
