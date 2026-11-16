# Integración y validación de lecturas

Autorización del usuario: «Hazlo, integra el candidato de Master Pipeline y valida las lecturas con los permisos reales antes de publicarlo». Continúa el mismo alcance STRICT, sin nuevas decisiones de producto. La integración de los13 archivos queda autorizada; no se incorpora el WIP de otros frentes.

1. Verificar HEAD, índice y WIP del coordinador; comprobar huellas de base/candidato/parche y transferir únicamente los13 archivos revisados a una rama de integración aislada.
2. Verificar contra el catálogo productivo las relaciones, columnas, grants y límites utilizados por el lector. Consultas acotadas de solo lectura, sin migraciones ni operaciones Auth administrativas. Registrar metadatos y resultados agregados, sin filas de clientes ni credenciales.
3. Comprobar la sesión real disponible, MFA y alcance del usuario mediante las rutas existentes. Las pruebas de políticas SQL, si se usan, se identificarán como pruebas de RLS del catálogo real; no se presentarán como sesiones JWT de otros usuarios ni se fabricarán tokens o verificaciones MFA.
4. Resolver incompatibilidades comprobadas dentro del lector de Master, conservar el cierre por defecto y repetir pruebas pertinentes/tipos/build sobre el árbol integrado. No relajar permisos, instalar SQL ni sustituir campos con inferencias para que un check pase.
5. Cerrar la validación de lecturas antes de la publicación. Si falta una sesión/identidad necesaria o hay un fallo de permisos, documentarlo y dejar la promoción detenida. La validación no autoriza crear usuarios, recuperar contraseñas, ampliar permisos o enviar correos.

Destino previsto del incremento: CRM existente en `crm.finlabinc.com`, recurso web Coolify `rv8rpfxhf0mbxprge6h6ki9c`, rama remota `main`. Se verificará de nuevo antes de una promoción. El worker funciona en modo normal por autorización de otro frente: no modificarlo, pausarlo ni repetir sus pilotos.

Recuperación: antes de publicar, descartar únicamente la rama aislada si se decide no integrar (sin borrar WIP ni fuentes originales). Después de publicar, recuperar la versión web anterior o revertir solamente este delta en un commit posterior; no hay DDL ni datos de negocio escritos por Master. No ejecutar reset/force push ni restauraciones de base.
