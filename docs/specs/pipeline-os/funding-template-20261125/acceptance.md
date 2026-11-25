# Aceptación

- AC-001: ingreso ficticio 100.000 produce montos 100.000/200.000/300.000 y cuotas 5.000,00/6.923,08/8.076,92.
- AC-002: referencia 110.000/215.000/320.000 reproduce cuotas 5.500/7.442/8.615 redondeadas al dólar.
- AC-003: errores, negativos, cero, formato ambiguo y conflictos de correo no producen estimaciones inventadas; filas duplicadas idénticas se consolidan.
- AC-004: recuperar dos veces no crea contactos, leads ni verificaciones; conserva bloqueos, historial y propietario.
- AC-005: ingreso actualizado después de crear una campaña no modifica su snapshot; campañas existentes y cuotas quedan intactas.
- AC-006: modelos con datos maliciosos, variables desconocidas, campos financieros ausentes y actores ajenos/anon/sin MFA se rechazan.
- AC-007: plantilla en biblioteca y creación de campaña muestra nombre/empresa/importe/cuotas y remitente dinámicos; firma única de Gmail y baja funcional, sin activar envíos en postflight.
