import type { CompactUnderwriting } from "./underwriting-compact";
import type { UnderwritingDocument } from "./underwriting";
/** Fictional presentation fixture, used only by the demo and tests. */
export function demoCompactUnderwriting(
  company: string,
  documents: UnderwritingDocument[],
): CompactUnderwriting {
  return {
    conclusion: {
      es: "Revisar una opción de plazo largo, condicionada a confirmar crédito e impuestos. El ejemplo no muestra MCA activos; la aprobación queda pendiente de la revisión del usuario.",
      en: "Consider a longer-term option, subject to confirming credit and taxes. This example shows no active MCAs; approval remains pending user review.",
    },
    file: [
      {
        label: { es: "Negocio", en: "Business" },
        value: { es: company, en: company },
      },
      {
        label: { es: "Cuentas", en: "Accounts" },
        value: {
          es: "Demo Bank · 1111 (ficticia)",
          en: "Demo Bank · 1111 (fictional)",
        },
      },
      {
        label: { es: "Pendiente", en: "Missing" },
        value: {
          es: "FICO, antigüedad y declaración fiscal",
          en: "FICO, business age and tax return",
        },
      },
    ],
    file_notes: {
      es: "Demostración con cifras ficticias; no corresponde a una lectura de archivos reales.",
      en: "Demonstration with fictional figures; not an analysis of actual files.",
    },
    bank_details: documents
      .filter((d) => d.kind === "bank_statement")
      .map((d, i) => ({
        document_id: d.id,
        nsf_count: 0,
        exclusions: {
          es:
            i === 1
              ? "$20,000 de fondeo y $5,000 de transferencias internas excluidos."
              : "$5,000 de transferencias internas excluidos.",
          en:
            i === 1
              ? "$20,000 funding and $5,000 internal transfers excluded."
              : "$5,000 internal transfers excluded.",
        },
      })),
    bank_notes: [
      {
        es: "Confirmar si la variación mensual de ingresos es estacional. Las transferencias entre cuentas no son ventas.",
        en: "Confirm whether monthly revenue variation is seasonal. Transfers between accounts are not sales.",
      },
    ],
    debts: [
      {
        name: "Example Term Loan",
        kind: "term",
        payment_amount: 5000,
        payment_frequency: "monthly",
        status: { es: "Vigente en el ejemplo", en: "Current in this example" },
        notes: {
          es: "Préstamo a plazo; no se cuenta como posición MCA.",
          en: "Term loan; not counted as an MCA position.",
        },
      },
    ],
    debt_summary: {
      es: "Servicio de deuda ilustrativo: $5,000 al mes. Confirmar obligaciones y saldos antes de presentar.",
      en: "Illustrative debt service: $5,000 monthly. Verify obligations and balances before submission.",
    },
    risks: [
      {
        es: "Faltan crédito e impuestos para respaldar una recomendación de producto.",
        en: "Credit and taxes are missing to support a product recommendation.",
      },
      {
        es: "La búsqueda judicial en NYSCEF queda pendiente de revisión manual.",
        en: "The NYSCEF court check remains pending manual review.",
      },
    ],
    tier_sba: {
      es: "Tier 1 y potencial SBA sujetos a verificar crédito, antigüedad, impuestos y criterios actuales. No hay una decisión de financiación.",
      en: "Tier 1 and SBA potential are subject to verifying credit, business age, taxes and current criteria. No funding decision has been made.",
    },
    lenders: [],
    pitch: {
      es: "Solicitar crédito e impuestos y evaluar un producto con cuota mensual sostenible. Confirmar guidelines antes de elegir lenders.",
      en: "Request credit and taxes, then assess a product with sustainable monthly payments. Confirm guidelines before selecting lenders.",
    },
    pending: [
      { es: "Reporte de crédito y FICO.", en: "Credit report and FICO." },
      {
        es: "Declaración fiscal y fecha de inicio del negocio.",
        en: "Tax return and business inception date.",
      },
      {
        es: "Saldos de deuda y explicación de transferencias.",
        en: "Debt balances and an explanation of transfers.",
      },
    ],
    crm_notes: {
      es: "DEMO: informe pendiente de revisión humana. Confirmar crédito, impuestos y saldos; evaluar plazo largo con guidelines vigentes.",
      en: "DEMO: report awaiting human review. Confirm credit, taxes and balances; assess longer terms using current guidelines.",
    },
  };
}
