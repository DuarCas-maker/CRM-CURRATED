# Diagnóstico

Síntoma informado: entrada y varias secciones lentas en la aplicación publicada, a veces requieren recargar.

1. Confirmado por código: el CRM hace una nueva lectura a los 250 ms de montar pese a recibir Workspace del servidor. setInterval puede solapar peticiones si una lectura tarda más de 15 s; refresh no participa de la cancelación del efecto.
2. Confirmado con fixture: 200 conversaciones requieren ocho consultas de correo secuenciales; con 25 ms de espera por consulta, 247 ms y concurrencia máxima uno.
3. Confirmado por código: estadísticas, preferencias, acceso y directorios se esperan en fases independientes innecesarias; en leads se consulta una lista de oportunidades que luego se descarta. Las relaciones sin casos también envían consultas vacías.
4. Confirmado por dependencia del efecto: Pipeline OS vuelve a leer tablero al cambiar data después de refresh.

No confirmado: duración/plan de consultas SQL reales, presión de CPU/RAM o red de producción y causa concreta de cada carga fallida reportada. Las correcciones se limitan a defectos demostrados, con medición sintética y regresión offline.
