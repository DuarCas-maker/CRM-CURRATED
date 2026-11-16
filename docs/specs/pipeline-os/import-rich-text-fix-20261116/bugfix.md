# Importación XLSX: texto con formato dentro de enlaces

SDD STANDARD · bugfix del recorrido de campañas publicado2ef0826. Diagnóstico e implementación local dentro de la solicitud del usuario. Producción de referencia solo lectura; publicación del arreglo requiere autorización final del paquete.

Clarificación cerrada: el usuario sitúa el error al confirmar el registro de la importación (respuesta B). La vista de error es el boundary general de Pipeline OS.

Causa confirmada: consola Chrome, React31, object with keys {richText}. El parser usa ExcelJS Cell.text como string; en HyperlinkValue.toString() esa propiedad puede devolver el objeto de texto enriquecido del shared string. El XLSX suministrado tiene1070 celdas no string:1068 etiquetas enriquecidas y2 shared strings vacíos representados como objetos vacíos. Hay2 celdas enriquecidas en las5 primeras filas de vista previa. El parser se ejecuta pero devuelve objetos que React no puede renderizar. El mismo objeto también podría convertirse en [object Object] durante normalizeRow.

El análisis local solo registra tipos y conteos, sin valores de contactos ni copias del archivo en el repo. Hay1851 filas/4 columnas; lectura de metadatos productivos confirma que no se registró un lote nuevo. No se repitió el POST de importación ni se llamó Bouncer/Gmail. Los logs acotados de servidor no mostraron excepciones; el error literal estaba en el navegador del usuario.

Hipótesis contrastadas: archivo ilegible descartado por parseo local; fallo fatal de carga del servidor descartado por logs y apertura correcta en otra pestaña; render de vista previa confirmado por el literal React31 y los tipos devueltos. Aviso CSS adicional en la pestaña antigua no explica el objeto richText; no se alteran CSP ni assets para ocultar el error.

- RICH-FR01 / AC01: cabeceras y celdas del XLSX entregan siempre texto; richText dentro de enlaces conserva sus fragmentos en orden, acentos y espacios.
- RICH-FR02 / AC02: vista previa y worker reutilizan el mismo parser; la normalización recibe el contenido visible, nunca un objeto ni [object Object]. URLs y fórmulas no se ejecutan.
- RICH-FR03 / AC03: CSV, strings, números, booleanos y resultados de fórmulas existentes conservan su contrato. Cabeceras duplicadas siguen rechazándose.
- AC04: el archivo original queda intacto y todas sus celdas importadas son strings después del arreglo. No se introducen registros reales o datos de clientes en fixtures/evidencias públicas.

Diseño: conversión pequeña y explícita en parse-import.ts, aplicada a cabeceras y filas. Solo se aceptan valores de texto conocidos; un objeto inesperado produce error controlado, sin volcar contenido de celdas. Sin dependencias nuevas, cambios SQL, permisos, remapeo de columnas, reprocesado de lotes o cambios de worker.

Tareas: RICH-T01 completada (dos casos rojos reproducidos); T02 completada (conversión compartida); T03 completada (archivo íntegro en memoria,51 pruebas/tipos/build y navegador local); T04 manifiesto preparado, publicación pendiente de autorización explícita. Ver verification.md.
