# Publicación autorizada · 16/11/2026

Autorización explícita: «autorizo aplicar la migración e integrar y publicar estas correcciones en Curated. Verifica que todo funcione en producción, sin importar datos reales ni enviar correos».

Destino: CRM `https://crm.finlabinc.com`, Supabase `https://supabase.finlabinc.com`, repositorio `DuarCas-maker/CRM-CURRATED`, main. Web Coolify `rv8rpfxhf0mbxprge6h6ki9c`; worker `vc4aybj4ucje7zstpsp3zboh`. Conservar pipeline, variables, transportes y modo del worker. Nivel STRICT, G6 autorizado para este delta.

1. Verificar huellas del candidato y conciliar main vigente (primera lectura: `26d3f1454f0f62f13bff3ac7c008ce0609edb38d`), conservando Usuarios, campañas desde archivos y despacho manual de correo. No incluir WIP ajeno ni reset/stash/clean/force.
2. Repetir pruebas relevantes y build sobre la integración. Revisar únicamente el delta propio. Sellar commit y comprobar que main no avanzó antes del push.
3. Verificar identidad y catálogo remoto, ausencia de 055, contratos de funciones reemplazadas y compatibilidad con 048–054. No seleccionar datos de clientes ni valores de credenciales. Respaldo completo con permisos restrictivos y verificación de pg_restore antes de DDL; guardar solo huella/tamaño/ruta/resultado.
4. Aplicar 055 íntegra una vez, en transacción, con lock timeout 5s y statement timeout 30s. Si la respuesta es incierta, inspeccionar catálogo antes de reintentar. No ejecutar SQL histórico ni importación.
5. Postflight: columnas, constraints, índice, propietario/search_path/grants, definición esperada y RPC nueva; `can_send` sin cambios. Pruebas de acceso en transacciones temporales/ROLLBACK, sin editar usuarios ni oportunidades existentes. Cero filas de negocio exportadas.
6. Push fast-forward a main; esperar webhook existente, sin duplicar deploy. Verificar versión exacta, build Linux y health web. Si reconstruye worker, comprobar salud y conservar operación actual sin iniciar jobs/envíos.
7. Smoke público/autenticado: health, API nueva privada/no-store, cinco pasos, riesgo sin registro manual/traspaso, acciones y controles de lenders. Navegar sin guardar, aprobar informes reales, ejecutar IA, importar ni enviar. Mutaciones solo con fixtures o dentro de transacciones SQL ficticias revertidas. Documentar cualquier límite de sesión o datos disponibles.

Rollback: preferir imagen web previa (`26d3f14`, o el main verificado al publicar) y conservar DDL aditiva. Si debe retirarse la RPC/permisos nuevos, `../rollback.sql` preserva columnas, eventos y montos; revisar dependencias/actividad y respaldo antes de ejecutarla. Nunca restaurar toda la base sobre escrituras posteriores ni revertir cambios ajenos. No rotar secretos ni cambiar DNS/infraestructura.
