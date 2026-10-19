"use client";
import { useRef } from "react";
import { mergeFields, type CampaignFormat } from "@/lib/campaign-content";
import type { Locale } from "@/lib/domain";
import { t } from "./ui";

export function CampaignEditor({
  value,
  onChange,
  format,
  onFormat,
  locale,
  label = "Mensaje",
}: {
  value: string;
  onChange: (v: string) => void;
  format: CampaignFormat;
  onFormat?: (v: CampaignFormat) => void;
  locale: Locale;
  label?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  function insert(before: string, after = "") {
    const field = input.current;
    const start = field?.selectionStart ?? value.length,
      end = field?.selectionEnd ?? start;
    onChange(
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + before.length, end + before.length);
    });
  }
  return (
    <div className="field">
      <span>{label}</span>
      <div className="card-actions">
        {onFormat && (
          <label>
            {t(locale, "Formato", "Format")}{" "}
            <select
              value={format}
              onChange={(e) => onFormat(e.target.value as CampaignFormat)}
            >
              <option value="plain">{t(locale, "Texto", "Text")}</option>
              <option value="markdown">
                {t(locale, "Con formato", "Formatted")}
              </option>
            </select>
          </label>
        )}
        {format === "markdown" && (
          <>
            <button
              type="button"
              className="button"
              onClick={() => insert("**", "**")}
              aria-label={t(locale, "Negrita", "Bold")}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className="button"
              onClick={() => insert("*", "*")}
              aria-label={t(locale, "Cursiva", "Italic")}
            >
              <em>I</em>
            </button>
            <button
              type="button"
              className="button"
              onClick={() => insert("\n- ")}
            >
              {t(locale, "Lista", "List")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => insert("[", "](https://example.com)")}
            >
              {t(locale, "Enlace", "Link")}
            </button>
            {(["black", "blue"] as const).map((color) => (
              <button
                key={color}
                type="button"
                className="button"
                onClick={() =>
                  insert(
                    `\n:::table ${color}\n| {{company}} | |\n| :--- | ---: |\n| Amount | $0.00 |\n| Terms | 120 months |\n:::\n`,
                  )
                }
              >
                {t(
                  locale,
                  color === "black" ? "Tabla negra" : "Tabla azul",
                  color === "black" ? "Black table" : "Blue table",
                )}
              </button>
            ))}
          </>
        )}
        <select
          aria-label={t(locale, "Insertar variable", "Insert field")}
          value=""
          onChange={(e) => {
            if (e.target.value) insert(`{{${e.target.value}}}`);
          }}
        >
          <option value="">
            {t(locale, "Insertar variable…", "Insert field…")}
          </option>
          {mergeFields.map((key) => (
            <option key={key} value={key}>{`{{${key}}}`}</option>
          ))}
        </select>
      </div>
      <textarea
        ref={input}
        rows={7}
        value={value}
        maxLength={20000}
        onChange={(e) => onChange(e.target.value)}
      />
      {format === "markdown" && (
        <small>
          {t(
            locale,
            "Usa los botones para negritas, cursivas, tablas, listas y enlaces. En las tablas, cada línea es una fila. Revisa el resultado en la vista previa.",
            "Use the toolbar for bold, italic, tables, lists and links. Each table line is a row. Check the result in the preview.",
          )}
        </small>
      )}
    </div>
  );
}
