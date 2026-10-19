"use client";
import { ProtectedForm, markFormSaved } from "./unsaved-changes";
import { useState, type FormEvent } from "react";
import { ShieldCheck, Plus, CheckCircle2, Upload } from "lucide-react";
import { applicationSchema } from "@/lib/application";
import { Field } from "./ui";
type Doc = {
  id: string;
  name: string;
  status: string;
  kind: string;
  period: string;
};
export function ApplicationForm({
  token,
  declaration,
  demo = false,
  submitted = false,
  documents = [],
}: {
  token: string;
  declaration: string;
  demo?: boolean;
  submitted?: boolean;
  documents?: Doc[];
}) {
  const [owners, setOwners] = useState(1);
  const [done, setDone] = useState(submitted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const values = Object.fromEntries(form);
    const parsed = applicationSchema.safeParse({
      ...values,
      consent: form.get("consent") === "on",
      owners: Array.from({ length: owners }, (_, i) =>
        Object.fromEntries(
          ["name", "title", "email", "phone", "ownership", "address"].map(
            (k) => [k, form.get(`owner_${i}_${k}`)],
          ),
        ),
      ),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(". "));
      setBusy(false);
      return;
    }
    if (demo) {
      setError(
        "This is a demonstration. Your information was not submitted or stored.",
      );
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/public/applications/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application: parsed.data,
          idempotency_key: key,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="application-page" lang="en">
      <header className="application-header">
        <img src="/icon.svg" alt="" width="40" height="40" />
        <strong>curated financial</strong>
        <small>
          <ShieldCheck size={13} /> Secure application
        </small>
      </header>
      <section className="application-card">
        {done ? (
          <div className="application-success">
            <CheckCircle2 size={44} />
            <h1>We received your application.</h1>
            <p>
              Your application and signature have been recorded. Your
              representative will review your file and follow up with you.
            </p>
          </div>
        ) : (
          <>
            <div className="eyebrow">
              BUSINESS FINANCING APPLICATION{demo ? " · DEMONSTRATION" : ""}
            </div>
            <h1>Let’s take the next step.</h1>
            <p>
              Tell us about your business and financing needs. Fields marked *
              are required.
            </p>
            <ProtectedForm busy={busy} onSubmit={submit}>
              <h2>Business information</h2>
              <div className="form-grid">
                <Field name="legal_name" label="Legal business name" required />
                <Field name="dba" label="DBA / trade name" />
                <Field name="entity_type" label="Entity type">
                  {["LLC", "Corporation", "Partnership", "Sole proprietor"].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </Field>
                <Field name="ein" label="Federal tax ID / EIN" required />
                <Field
                  name="business_phone"
                  label="Business phone"
                  type="tel"
                  required
                />
                <Field
                  name="business_email"
                  label="Business email"
                  type="email"
                  required
                />
              </div>
              <Field name="address" label="Business street address" required />
              <div className="form-grid">
                <Field name="city" label="City" required />
                <Field name="state" label="State (2 letters)" required />
                <Field name="zip" label="ZIP code" required />
                <Field
                  name="established"
                  label="Date established"
                  type="date"
                  required
                />
                <Field name="industry" label="Industry" required />
                <Field
                  name="annual_revenue"
                  label="Annual revenue (USD)"
                  type="number"
                  min={0}
                  required
                />
              </div>
              <h2>Financing request</h2>
              <Field
                name="requested_amount"
                label="Requested amount (USD)"
                type="number"
                min={1}
                required
              />
              <Field
                name="purpose"
                label="How will you use the funds?"
                type="textarea"
                required
              />
              <h2>Business owners</h2>
              {Array.from({ length: owners }, (_, i) => (
                <div key={i}>
                  <h3>Owner {i + 1}</h3>
                  <div className="form-grid">
                    <Field
                      name={`owner_${i}_name`}
                      label="Full legal name"
                      required
                    />
                    <Field name={`owner_${i}_title`} label="Title" required />
                    <Field
                      name={`owner_${i}_email`}
                      label="Email"
                      type="email"
                      required
                    />
                    <Field
                      name={`owner_${i}_phone`}
                      label="Phone"
                      type="tel"
                      required
                    />
                    <Field
                      name={`owner_${i}_ownership`}
                      label="Ownership (%)"
                      type="number"
                      min={1}
                      max={100}
                      required
                    />
                    <Field
                      name={`owner_${i}_address`}
                      label="Home address"
                      required
                    />
                  </div>
                </div>
              ))}
              {owners < 4 && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setOwners(owners + 1)}
                >
                  <Plus size={16} />
                  Add owner
                </button>
              )}
              <h2>Declarations and signature</h2>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.8,
                  whiteSpace: "pre-wrap",
                }}
              >
                {declaration}
              </p>
              <label className="consent">
                <input name="consent" type="checkbox" required />
                <span>
                  I have read the declarations above and agree to sign
                  electronically.
                </span>
              </label>
              <div className="signature-field">
                <Field
                  name="signature_name"
                  label="Electronic signature · type your full legal name"
                  required
                />
              </div>
              <p className="muted">
                Your signature, declarations and submission time will be
                preserved with this application.
              </p>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Submitting securely…"
                  : demo
                    ? "Preview submission"
                    : "Submit application"}
              </button>
            </ProtectedForm>
          </>
        )}
        {done && (
          <>
            <h2>Upload your documents</h2>
            <p className="muted">
              Upload each requested statement. Your representative will review
              every document.
            </p>
            {documents
              .filter((d) => d.kind !== "application")
              .map((d) => (
                <ProtectedForm
                  busy={busy}
                  key={d.id}
                  className="document-row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setUploadMessage("");
                    setError("");
                    setBusy(true);
                    const savedForm = e.currentTarget;
                    const form = new FormData(savedForm);
                    form.set("document_id", d.id);
                    try {
                      const res = await fetch(
                        `/api/public/documents/${token}`,
                        { method: "POST", body: form },
                      );
                      const body = await res.json();
                      if (!res.ok) throw new Error(body.error);
                      markFormSaved(savedForm);
                      setUploadMessage(`${d.name}: received. Pending review.`);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div>
                    <strong>{d.name}</strong>
                    <small>
                      {d.period} · {d.status}
                    </small>
                    <input
                      name="file"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      required
                      aria-label={`Upload ${d.name}`}
                    />
                  </div>
                  <button className="button" disabled={busy}>
                    <Upload size={14} />
                    Upload
                  </button>
                </ProtectedForm>
              ))}
            {uploadMessage && (
              <div className="info-banner" role="status">
                {uploadMessage}
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
          </>
        )}
      </section>
      <p
        style={{
          textAlign: "center",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 25,
        }}
      >
        Curated Financial · Please do not email sensitive identification
        numbers.
      </p>
    </main>
  );
}
