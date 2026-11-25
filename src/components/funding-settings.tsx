"use client";
import type { FundingModel } from "@/lib/funding-options";

export function FundingSettings({
  value,
  change,
}: {
  value: FundingModel;
  change: (value: FundingModel) => void;
}) {
  return (
    <fieldset className="analysis-card">
      <legend>Opciones estimadas · USD</legend>
      <p className="muted">
        Monto = ingreso mensual × multiplicador. Pago semanal = monto × factor ÷
        semanas. Son ejemplos, sujetos a revisión; el factor no es una tasa APR.
      </p>
      {value.options.map((option, index) => (
        <div key={option.months} className="form-grid">
          <strong>{option.months} meses</strong>
          {(["multiplier", "factor", "weeks"] as const).map((key) => (
            <label className="field" key={key}>
              {
                {
                  multiplier: "Multiplicador del ingreso",
                  factor: "Factor de devolución",
                  weeks: "Pagos semanales",
                }[key]
              }
              <input
                type="number"
                step={key === "weeks" ? 1 : 0.01}
                min={key === "factor" ? 1 : key === "weeks" ? 1 : 0.01}
                max={key === "weeks" ? 520 : key === "factor" ? 5 : 100}
                value={option[key]}
                onChange={(e) =>
                  change({
                    ...value,
                    options: value.options.map((o, i) =>
                      i === index ? { ...o, [key]: Number(e.target.value) } : o,
                    ) as FundingModel["options"],
                  })
                }
              />
            </label>
          ))}
        </div>
      ))}
      <p className="muted">
        Vista previa con ingreso ficticio de $100,000.00 al mes. Cada campaña
        nueva conservará su propia copia.
      </p>
    </fieldset>
  );
}
