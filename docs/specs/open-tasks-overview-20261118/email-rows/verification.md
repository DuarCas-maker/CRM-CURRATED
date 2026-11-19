# CR-001 — Verificación del resumen por correo

Base c0ef7a9; Node22.23.4, Next16.3.8 y dependencias existentes. Se conserva el WIP previo. Requisito anterior por responsables sustituido explícitamente por CR-001 y respuestas A/A del usuario.

## Implementación comprobada

- EMAIL-FR01: byAccount agrupa por dirección normalizada, incluyendo aliases con IDs diferentes. El rol/owner solo se usa para autorización, nunca como agrupación visible. Se retiraron responsables del resumen y del detalle. byRep queda únicamente para compatibilidad de pestañas antiguas durante el despliegue.
- EMAIL-FR02: los destinatarios pendientes se leen como metadatos de campaign_enrollments y selected_contact_ids de campañas first_contact visibles. La relación se cruza con leads/casos autorizados. El RPC de hechos sigue limitado a sent y no vuelve a paginar miles de hechos pendientes innecesarios.
- EMAIL-FR03/04: conjuntos únicos por correo/contacto; indicadores y fechas independientes por cuenta. Se probó un lead con respuesta en A pero sin respuesta en B, un envío en A que no convierte en gestionado un pendiente de B, duplicados de campaña/alias y selección pendiente sin envío.
- EMAIL-FR05: la selección del correo se conserva al filtrar estado, buscar, paginar o entrar a una etapa; tarjetas y strip filtran el mismo listado. Los filtros no generan otro GET de board. Teclado Enter, detalle obsoleto oculto, error/reintento y cambio rápido de cuenta comprobados.

Cuatro regresiones nuevas fallaron antes del cambio (byAccount inexistente y estado heredado de otra cuenta). Pasan después. Suite relevante ampliada: **107/107**, cero fallos/omisiones. TypeScript y build aislado sin env/proveedores correctos,60/60 páginas. Sin cambios de esquema, RLS, MFA, configuración, timeout o dependencias.

QA de navegador con datos ficticios y CSP connect-src none:4 correos únicos más total, frente a5 registros físicos (un alias repetido). Primera cuenta73 leads,2 gestionados y71 pendientes; segunda cuenta compartida1 enviado y0 contestados, sin heredar la respuesta de otra cuenta. Página2 muestra23 filas. Etapa aplicación30 leads;0 lecturas redundantes de board. Cambio rápido conserva la última cuenta. Error oculta leads obsoletos y reintento recupera.

Responsive observado en1280/768/360 CSS px exactos, sin overflow de documento; solo la región de tabla desplaza horizontalmente. Capturas ficticias y comprobaciones en evidence/. La publicación y prueba con sesión existente se registran después de observarlas, sin afirmar todavía un resultado productivo.

## Revisión

Revisado contra permisos, exactitud, campos consultados, compatibilidad, carreras y datos personales. Contrato GET aditivo (byAccount/stage y account de hasta320 caracteres); no se usa service role ni entrada del usuario para ampliar permisos. No se cargan cuerpos ni secretos. La agrupación por correo opera únicamente sobre cuentas/relaciones autorizadas. Se conserva el error ante count faltante, catálogo parcial o fallo de fuente; no se convierte en cero.

Limitación: el total global incluye leads sin correo asignado y deduplica los compartidos; no se obtiene sumando filas. Las etapas siguen los expedientes vinculados existentes. Los12 fallos históricos de compatibilidad de inventario ABC documentados en la primera publicación no pertenecen a este delta; no se afirma una suite completa del repositorio verde.
