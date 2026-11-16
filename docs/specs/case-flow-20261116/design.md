# Diseño / ADR-01

Reutilizar underwriting_runs + analyses, submissions + offers y financing_processes; los eventos con evidencia conservan la auditoría. No crear una segunda base de ofertas ni usar localStorage para estados de negocio.

Los informes mantienen la RPC de aprobación y snapshot vigente; la UI usa directamente el contenido del reporte. Un análisis manual histórico no es un informe IA aprobado. Los rechazos quedan trazados y las decisiones no se toman al visualizar.

La nueva gestión es por IDs de expediente/proceso/lender. Una operación interna puede crearse al guardar una acción explícita cuando no existe una actual; nunca se crea al leer. Un hilo ya asociado a otra operación no se mueve silenciosamente. Las asociaciones ambiguas requieren elegir la operación. No se migra el histórico para dar pasos por cumplidos.

Correos confirmados: direction outbound + status sent, destinatario exacto del catálogo/contactos o evaluación explícitamente vinculada. Ni asuntos, dominios aproximados, envíos en cola ni textos libres acreditan entrega. Las renovaciones filtran su operación/fecha; sin operación, los correos posteriores al informe aprobado pueden iniciar la gestión actual. Registrar manualmente una oferta con evidencia conserva ese hecho aunque falte el correo outbound en la cobertura del CRM; se identifica como dato confirmado por persona y no incrementa el contador de correos reales.

Confirmaciones manuales: motivo y evidencia del mismo expediente; control de versión e idempotencia. Puede volver a automático. No se permite confirmar informe aprobado sin informe, selección sin lender elegido, oferta sin monto ni desembolso sin sus datos reales. El estado estructurado financiero prevalece sobre una casilla genérica.

Permisos: ampliar la gestión de casos al responsable actual y administradores, preservando cualificación/histórico aprobado, MFA, usuario activo y separación de buzones. No modificar can_send, grants de buzón, transportes ni código del worker. La API usa cliente autenticado/RLS; RPCs validan además actor, alcance, evidencia y concurrencia. Si existe S01/049, sus predicados privados de actor usan el mismo responsable y conservan la autorización explícita de remitente. La cola existente solo cambia el propietario de una evaluación nueva a coalesce(closer_id,seller_id), conservando sus validaciones de documentos, marca, destinatario y envío.

Un correo sin proceso puede contar desde el inicio de la operación cuando el destinatario es exacto y no está asociado explícitamente a otra operación. La creación explícita de una operación usa como referencia el informe vigente aprobado o el último desembolso, conservando así los envíos posteriores a esa revisión. Un hilo de una operación histórica exige asociación explícita, nunca coincidencias por nombre.

Las correcciones de montos conservan valores anteriores y nuevos en el evento. Una selección posterior a un contrato no cambia silenciosamente de lender ni reutiliza el contrato anterior: requiere revisar la operación. Los controles antiguos de selección también conservan alternativas.

SQL aditivo reservado como 055: 054 pertenece al frente de usuarios y no se copia ni modifica. No hay dependencia funcional de esa migración. Probar instalación/reversa en DB ficticia. Publicación y SQL remoto requieren una aprobación posterior del candidato concreto.
