import React, { useState } from "react";

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (seconds: number) => void;
}

export function ScheduleModal({ isOpen, onClose, onConfirm }: ScheduleModalProps) {
  const [selectedSeconds, setSelectedSeconds] = useState<number>(30);
  const [customVal, setCustomVal] = useState<string>("10");
  const [customUnit, setCustomUnit] = useState<"sec" | "min" | "hour">("min");
  const [activeTab, setActiveTab] = useState<"preset" | "custom">("preset");

  if (!isOpen) return null;

  const presets = [
    { label: "10 soniya", sec: 10 },
    { label: "30 soniya", sec: 30 },
    { label: "1 daqiqa", sec: 60 },
    { label: "5 daqiqa", sec: 300 },
    { label: "15 daqiqa", sec: 900 },
    { label: "30 daqiqa", sec: 1800 },
    { label: "1 soat", sec: 3600 },
  ];

  const handleConfirm = () => {
    let finalSec = selectedSeconds;
    if (activeTab === "custom") {
      const parsed = parseInt(customVal, 10);
      if (isNaN(parsed) || parsed <= 0) return;
      if (customUnit === "sec") finalSec = parsed;
      else if (customUnit === "min") finalSec = parsed * 60;
      else if (customUnit === "hour") finalSec = parsed * 3600;
    }
    onConfirm(Math.max(3, finalSec));
    onClose();
  };

  const getComputedDisplay = () => {
    let s = selectedSeconds;
    if (activeTab === "custom") {
      const parsed = parseInt(customVal, 10) || 0;
      if (customUnit === "sec") s = parsed;
      else if (customUnit === "min") s = parsed * 60;
      else if (customUnit === "hour") s = parsed * 3600;
    }
    if (s < 60) return `${s} soniya`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `${m} daqiqa ${rem > 0 ? `${rem} son` : ""}`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h} soat ${remM > 0 ? `${remM} daq` : ""}`;
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div
        className="schedule-modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--layout, #1e2c3a)",
          color: "var(--text, #e1e8ef)",
          borderRadius: 18,
          padding: 24,
          maxWidth: 430,
          width: "92%",
          boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.08)",
          animation: "modalFadeIn 0.15s ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 26 }}>⏱️</span>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Xabarni timer orqali yuborish
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "rgba(225,232,239,0.7)" }}>
              Xabar belgilangan muddatdan so'ng avtomatik yuboriladi
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            background: "rgba(0,0,0,0.25)",
            padding: 4,
            borderRadius: 12,
            marginBottom: 16,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("preset")}
            style={{
              padding: "8px 12px",
              borderRadius: 9,
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: activeTab === "preset" ? "var(--accent, #0e7c66)" : "transparent",
              color: activeTab === "preset" ? "#ffffff" : "rgba(225,232,239,0.65)",
              transition: "all 0.15s ease",
            }}
          >
            ⚡ Tezkor muddatlar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            style={{
              padding: "8px 12px",
              borderRadius: 9,
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: activeTab === "custom" ? "var(--accent, #0e7c66)" : "transparent",
              color: activeTab === "custom" ? "#ffffff" : "rgba(225,232,239,0.65)",
              transition: "all 0.15s ease",
            }}
          >
            ⚙️ O'zingiz belgilang
          </button>
        </div>

        {activeTab === "preset" ? (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {presets.map((p) => {
                const active = selectedSeconds === p.sec;
                return (
                  <button
                    key={p.sec}
                    type="button"
                    onClick={() => setSelectedSeconds(p.sec)}
                    style={{
                      background: active ? "var(--accent, #0e7c66)" : "rgba(255,255,255,0.06)",
                      color: active ? "#ffffff" : "var(--text, #e1e8ef)",
                      border: active ? "1.5px solid var(--accent, #0e7c66)" : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      padding: "10px 6px",
                      fontSize: 13,
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(225,232,239,0.7)", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Vaqt miqdorini kiriting:
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min="1"
                max="999"
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                style={{
                  flex: 1,
                  background: "rgba(0,0,0,0.3)",
                  border: "1.5px solid var(--accent, #0e7c66)",
                  color: "var(--text, #e1e8ef)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 15,
                  fontWeight: 600,
                  outline: "none",
                }}
                placeholder="Masalan: 10"
                autoFocus
              />
              <select
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value as any)}
                style={{
                  background: "rgba(0,0,0,0.4)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "var(--text, #e1e8ef)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 14,
                  fontWeight: 600,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="sec">Soniya</option>
                <option value="min">Daqiqa</option>
                <option value="hour">Soat</option>
              </select>
            </div>

            {/* Quick adjust chips */}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {[1, 5, 10, 15, 30].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setCustomVal(String(num))}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    borderRadius: 7,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: customVal === String(num) ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)",
                    color: "rgba(225,232,239,0.85)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            background: "rgba(14, 124, 102, 0.15)",
            border: "1px solid rgba(14, 124, 102, 0.3)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 20,
          }}
        >
          <span>⏳</span>
          <div>
            Xabar <strong>{getComputedDisplay()}</strong>dan keyin yuboriladi.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: "11px 16px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              background: "var(--accent, #0e7c66)",
              color: "#fff",
              border: "none",
            }}
          >
            ⏱️ Taymerni boshlash
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "11px 16px",
              borderRadius: 10,
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text, #e1e8ef)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            Bekor qilish
          </button>
        </div>
      </div>
    </div>
  );
}
