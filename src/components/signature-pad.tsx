"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import { t } from "./ui";
export function SignaturePad({
  value,
  onChange,
  locale,
  disabled = false,
}: {
  value: string;
  onChange: (image: string) => void;
  locale: Locale;
  disabled?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    ink = useRef(false);
  const [hasInk, setHasInk] = useState(!!value);
  useEffect(() => {
    if (!value) {
      canvas.current?.getContext("2d")?.clearRect(0, 0, 900, 220);
      ink.current = false;
      setHasInk(false);
    }
  }, [value]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - box.left) * 900) / box.width,
      ((e.clientY - box.top) * 220) / box.height,
    ] as const;
  };
  return (
    <div className="signature-pad">
      <canvas
        ref={canvas}
        width={900}
        height={220}
        role="img"
        aria-label={t(
          locale,
          "Área para dibujar tu firma como representante",
          "Draw your signature as representative",
        )}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const [x, y] = point(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || disabled) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const [x, y] = point(e);
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111827";
          ctx.lineTo(x, y);
          ctx.stroke();
          ink.current = true;
          setHasInk(true);
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          if (ink.current) onChange(e.currentTarget.toDataURL("image/png"));
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <p className="muted">
        {t(
          locale,
          "Dibuja tu firma con el mouse, lápiz o dedo.",
          "Draw your signature using a mouse, stylus or finger.",
        )}
      </p>
      <button
        className="button"
        type="button"
        disabled={disabled || !hasInk}
        onClick={() => {
          canvas.current?.getContext("2d")?.clearRect(0, 0, 900, 220);
          ink.current = false;
          setHasInk(false);
          onChange("");
        }}
      >
        {t(locale, "Borrar firma", "Clear signature")}
      </button>
    </div>
  );
}
