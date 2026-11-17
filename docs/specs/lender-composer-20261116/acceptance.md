# Escenarios de aceptación

1. Dado un catálogo de 73 lenders, al seleccionar todos quedan 73; uno sin contacto no se oculta. Corregirlo o quitarlo habilita revisión. Un correo independiente por lender, CC aislados.
2. Dada una plantilla con company/amount y lender_name, elegirla muestra datos del expediente y lender actuales. Al faltar phone, el preview destaca el token y la revisión se bloquea hasta editar o completar el expediente.
3. Dada una plantilla de campaña con pasos y assets, aplicarla copia solo asunto/mensaje. unsubscribe_url no se inventa ni se resuelve con datos de muestra.
4. Dada una revisión final, cambiar datos de expediente, contacto, adjuntos, cuenta, marca, contenido o firma obliga nueva revisión antes de encolar. Texto HTML malicioso de una variable aparece como texto.
5. Dado un reintento del mismo request, se retorna el lote previo sin duplicar. Un target inválido revierte todo, incluso si es el último.
6. Dadas dos sesiones editando una plantilla, solo la primera versión vigente se guarda; la otra recibe conflicto. Un vendedor consulta pero no escribe; anónimo/usuario inactivo no consulta. Guardar, aplicar o previsualizar no crea outbox.
7. Dado un borrador modificado, Escape/cierre solicita conservar o descartar; teclado queda en el modal; tamaños 360/768/1280 sin scroll horizontal.
