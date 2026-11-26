# Rollout y reversa

1. Ensayar en PostgreSQL 15 temporal con volumen y presupuesto autenticado, además de regresión HTTP/funding/flow y build.
2. Conciliar catálogo, respaldo reciente listado y decodificado. Instalar parche exacto de dos funciones en transacción, con registro privado de reversa y sin tocar datos de clientes.
3. Publicar app/worker desde main. Confirmar Success y Running; comprobar revisión de lote desde sesión humana sin Enviar campaña.
4. Para revertir, publicar código anterior y ejecutar down.sql solo si los hashes siguen iguales a la aplicación. Conservar datos/campañas existentes. Los errores por timeout revierten la transacción; no reprocesar automáticamente una solicitud incierta.
