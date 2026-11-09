# CW-I03 — diseño, tareas y aceptación

## CW3-ADR01

Se reciben seis archivos finales T-009 byte a byte. Su SQL permanece local-only con guards de host/base/owner. El harness root comprobará huella y prefijo y adaptará **solo en memoria** el guard nativo para PGlite, igual que el harness previo T-002. Exige marcador propio, base vacía de intentos y transacción externa para ensayo/reversa; no cambiar el SQL original para hacerlo ejecutable en producción.

Componer después de WC/CW y R06-I01/I02/I03. T-009 crea su schema y revoca cinco entradas antiguas sin reemplazar sus cuerpos; conservar la corrección monotónica CW y las guards C2/R06. Publicar descriptor sintético de generación nueva conserva la política Auth ya configurada. C1 exige identidad humana: el servicio emite concesión opaca y la RPC humana final realiza el commit; no sintetizar claims de actor en servicio.

Un adapter RPC de test selecciona rol/claims ficticios para cada llamada, sin GoTrue ni PostgREST. El store real de código cifra state/navegación con keyring ficticio y usa engine/proveedor T-003/T-004 con transporte en memoria. Las cuentas nuevas quedan disconnected/live=false/sync=false, sin credenciales/permisos/jobs. Confirmación B1 y adopción explícitas preceden candidato; C2 y R06 siguen siendo etapas posteriores.

## Tareas / escenarios

- CW3-T01 / FR01–02 / AC01–02: recibir/cotejar fuentes terminadas y ejecutar12 unitarias; runner nativo omitido por defecto sin cluster.
- CW3-T02 / FR03,05 / AC03,05: fixture DB propia; ACL, tickets/leases y ciphertext, un flujo real de código motor/store/proveedor, identidad equivocada y resultado incierto. Aplicación/reversa en memoria conserva catálogo/ACL previos y datos ajenos.
- CW3-T03 / FR04 / AC04: pasar candidato nuevo por evidencia C2 simulada y transición R06 explícita; recepción/sender anteriores conservados y ninguna activación real.
- CW3-T04 / FR05 / AC05: TypeScript, regresión pertinente, inventario y límites. Luego diseñar/implementar HTTP/UI bajo su propio contrato; G6 no se ejecuta por este incremento.

Reversa local: conservar recibos y retirar solo adiciones propias. El SQL rollback de F2 revierte su delta en fixture cerrado y restaura cinco ACL; no se promueve como rollback productivo ni revierte publicaciones deliberadas de configuración. No repetir048/049, reset/stash/clean ni copiar runtime ajeno.
