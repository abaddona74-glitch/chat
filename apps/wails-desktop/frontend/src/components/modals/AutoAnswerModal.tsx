import React, { useState, useRef } from "react";
import toast from "react-hot-toast";
import { AutoAnswerConfig, AutoAnswerVoice, PublicUser } from "../../types";
import { API_URL } from "../../lib/api";

export interface VoiceOption {
  id: AutoAnswerVoice;
  name: string;
  title: string;
  badge: string;
  badgeColor: string;
  desc: string;
}

export const AVAILABLE_VOICES: VoiceOption[] = [
  {
    id: "en-US-BrianMultilingualNeural",
    name: "Brian",
    title: "1. Brian (Multilingual AI - Erkak)",
    badge: "🔥 Eng jonli va tabiiy",
    badgeColor: "#10b981",
    desc: "Yangi avlod Multilingual inson ovozi, tabiiy nafas va jonli urg'u",
  },
  {
    id: "en-US-AvaMultilingualNeural",
    name: "Ava",
    title: "2. Ava (Multilingual AI - Ayol)",
    badge: "🌸 Eng jonli va mayin",
    badgeColor: "#ec4899",
    desc: "Yangi avlod Multilingual ayol ovozi, juda samimiy va muloyim",
  },
  {
    id: "uz-UZ-SardorNeural",
    name: "Sardor",
    title: "3. Sardor (Standart O'zbekcha)",
    badge: "🇺🇿 Erkak ovozi",
    badgeColor: "#0284c7",
    desc: "Microsoft standart o'zbek tili diktori",
  },
  {
    id: "uz-UZ-MadinaNeural",
    name: "Madina",
    title: "4. Madina (Standart O'zbekcha)",
    badge: "🇺🇿 Ayol ovozi",
    badgeColor: "#8b5cf6",
    desc: "Microsoft standart o'zbek tili ayol diktori",
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    name: "Andrew",
    title: "5. Andrew (Radio / Podkast)",
    badge: "🎙 Erkak ovozi",
    badgeColor: "#f59e0b",
    desc: "Vazmin, radio va podkast uslubidagi erkak ovozi",
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    name: "Emma",
    title: "6. Emma (Samimiy Ayol)",
    badge: "✨ Ayol ovozi",
    badgeColor: "#14b8a6",
    desc: "Yengil, quvnoq va samimiy ayol ovozi",
  },
];

export const DEFAULT_AUTO_ANSWER_CONFIG: AutoAnswerConfig = {
  enabled: false,
  mode: "selected",
  selectedUserIds: [],
  delaySeconds: 2,
  voice: "en-US-BrianMultilingualNeural",
  greetingText:
    "Assalomu alaykum! Men hozir joyimda emasman, zarur ish bilan birozga chiqib ketgandim. Iltimos, birozdan so'ng qayta bog'laning yoki chatga xabar yozib qoldiring.",
  sendChatMessage: true,
  hangupAfterGreeting: true,
};

interface AutoAnswerModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AutoAnswerConfig;
  onSaveConfig: (nextConfig: AutoAnswerConfig) => void;
  users: PublicUser[];
}

export function AutoAnswerModal({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  users,
}: AutoAnswerModalProps) {
  const [form, setForm] = useState<AutoAnswerConfig>({ ...config });
  const [searchQuery, setSearchQuery] = useState("");
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Sync state whenever modal opens
  React.useEffect(() => {
    if (isOpen) {
      setForm({ ...config });
    } else {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current = null;
        setIsPlayingPreview(false);
        setPreviewingVoiceId(null);
      }
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleToggleUser = (userId: string) => {
    setForm((prev) => {
      const exists = prev.selectedUserIds.includes(userId);
      const nextUserIds = exists
        ? prev.selectedUserIds.filter((id) => id !== userId)
        : [...prev.selectedUserIds, userId];
      return { ...prev, selectedUserIds: nextUserIds };
    });
  };

  const handleApplyTemplate = (text: string) => {
    setForm((prev) => ({ ...prev, greetingText: text }));
  };

  const handlePlayVoicePreview = async (voiceId: string) => {
    if (isPlayingPreview && previewingVoiceId === voiceId && audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
      setIsPlayingPreview(false);
      setPreviewingVoiceId(null);
      return;
    }

    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }

    const textToPlay =
      form.greetingText.trim() ||
      "Assalomu alaykum! Hozir qo'ng'iroqqa javob bera olmayman, iltimos xabaringizni qoldiring.";

    try {
      setIsPlayingPreview(true);
      setPreviewingVoiceId(voiceId);

      const audioUrl = `${API_URL}/tts/synthesize?voice=${encodeURIComponent(
        voiceId,
      )}&text=${encodeURIComponent(textToPlay)}&rate=-5%`;

      const audio = new Audio(audioUrl);
      audioPreviewRef.current = audio;

      audio.onended = () => {
        setIsPlayingPreview(false);
        setPreviewingVoiceId(null);
      };

      audio.onerror = () => {
        setIsPlayingPreview(false);
        setPreviewingVoiceId(null);
        toast.error("Ovozni yuklashda xatolik yuz berdi");
      };

      await audio.play();
    } catch (err) {
      setIsPlayingPreview(false);
      setPreviewingVoiceId(null);
      console.error(err);
      toast.error("Ovozni ijro etishda xatolik yuz berdi");
    }
  };

  const handlePlayPreview = async () => {
    await handlePlayVoicePreview(form.voice);
  };

  const handleSave = () => {
    onSaveConfig(form);
    const selectedVoiceObj = AVAILABLE_VOICES.find((v) => v.id === form.voice);
    const voiceName = selectedVoiceObj ? selectedVoiceObj.name : form.voice;
    if (form.enabled) {
      toast.success(`Avto-javobgich yoqildi (${voiceName} ovozi)`);
    } else {
      toast("Avto-javobgich o'chirildi.", { icon: "ℹ️" });
    }
    onClose();
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.displayName.toLowerCase().includes(q) ||
      (u.username && u.username.toLowerCase().includes(q))
    );
  });

  return (
    <div className="lightbox-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="auto-answer-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--layout, #1e2c3a)",
          color: "var(--text, #e1e8ef)",
          borderRadius: 20,
          padding: 24,
          maxWidth: 520,
          width: "94%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.12)",
          animation: "modalFadeIn 0.2s ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            paddingBottom: 14,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: form.enabled
                  ? "rgba(34, 197, 94, 0.2)"
                  : "rgba(0, 136, 204, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: form.enabled ? "#22c55e" : "var(--accent, #0088cc)",
              }}
            >
              📞⚡
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Avto-javobgich (Kutish rejimi)
              </h3>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 12.5,
                  color: "rgba(225,232,239,0.7)",
                }}
              >
                Joyingizda bo'lmaganingizda qo'ng'iroqqa o'zbekcha ovoz bilan javob beradi
              </p>
            </div>
          </div>

          {/* Master Toggle */}
          <label
            style={{
              position: "relative",
              display: "inline-block",
              width: 50,
              height: 26,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, enabled: e.target.checked }))
              }
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: form.enabled
                  ? "var(--accent, #0088cc)"
                  : "rgba(255,255,255,0.2)",
                transition: "0.3s",
                borderRadius: 26,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  content: '""',
                  height: 20,
                  width: 20,
                  left: form.enabled ? 26 : 4,
                  bottom: 3,
                  backgroundColor: "white",
                  transition: "0.3s",
                  borderRadius: "50%",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                }}
              />
            </span>
          </label>
        </div>

        {/* Scrollable Content */}
        <div
          style={{
            overflowY: "auto",
            paddingRight: 4,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Status banner */}
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              background: form.enabled
                ? "rgba(34, 197, 94, 0.12)"
                : "rgba(255, 255, 255, 0.05)",
              border: `1px solid ${
                form.enabled
                  ? "rgba(34, 197, 94, 0.3)"
                  : "rgba(255, 255, 255, 0.08)"
              }`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
            }}
          >
            <span>{form.enabled ? "🟢" : "⚪"}</span>
            <div>
              <strong>
                {form.enabled
                  ? "Avto-javobgich FAOL"
                  : "Avto-javobgich O'CHIRILGAN"}
              </strong>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                {form.enabled
                  ? form.mode === "selected"
                    ? `Faqat ${form.selectedUserIds.length} ta tanlangan kontakt uchun avto ko'taradi.`
                    : "Barcha kiruvchi qo'ng'iroqlarga avtomatik javob beradi."
                  : "Qo'ng'iroqlarga faqat o'zingiz qo'lda javob berasiz."}
              </div>
            </div>
          </div>

          {/* Mode Selector */}
          <div>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                display: "block",
                marginBottom: 8,
              }}
            >
              Kimlarning qo'ng'irog'i ko'tarilsin?
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, mode: "selected" }))}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border:
                    form.mode === "selected"
                      ? "1.5px solid var(--accent, #0088cc)"
                      : "1px solid rgba(255,255,255,0.1)",
                  background:
                    form.mode === "selected"
                      ? "rgba(0, 136, 204, 0.15)"
                      : "rgba(255,255,255,0.03)",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  fontWeight: form.mode === "selected" ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                🎯 Faqat kutayotgan do'stlar
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                  ({form.selectedUserIds.length} kishi tanlangan)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, mode: "all" }))}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border:
                    form.mode === "all"
                      ? "1.5px solid var(--accent, #0088cc)"
                      : "1px solid rgba(255,255,255,0.1)",
                  background:
                    form.mode === "all"
                      ? "rgba(0, 136, 204, 0.15)"
                      : "rgba(255,255,255,0.03)",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  fontWeight: form.mode === "all" ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                🌐 Barcha qo'ng'iroqlar
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                  Har qanday kiruvchi qo'ng'iroq
                </div>
              </button>
            </div>
          </div>

          {/* User selector if mode === "selected" */}
          {form.mode === "selected" && (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: 12,
                background: "rgba(0,0,0,0.15)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  Kutayotgan kontaktlaringiz:
                </span>
                {form.selectedUserIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, selectedUserIds: [] }))
                    }
                    style={{
                      background: "none",
                      border: "none",
                      color: "#f43f5e",
                      fontSize: 11.5,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Tozalash
                  </button>
                )}
              </div>

              <input
                type="text"
                placeholder="Do'stlaringizni qidirish..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "var(--input-bg, rgba(255,255,255,0.06))",
                  color: "inherit",
                  fontSize: 12.5,
                  boxSizing: "border-box",
                  marginBottom: 8,
                }}
              />

              <div
                style={{
                  maxHeight: 140,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {filteredUsers.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.6,
                      textAlign: "center",
                      padding: 12,
                    }}
                  >
                    Foydalanuvchilar topilmadi
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = form.selectedUserIds.includes(user.id);
                    return (
                      <div
                        key={user.id}
                        onClick={() => handleToggleUser(user.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: isSelected
                            ? "rgba(0, 136, 204, 0.2)"
                            : "transparent",
                          transition: "background 0.12s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            style={{ cursor: "pointer" }}
                          />
                          <span style={{ fontSize: 13 }}>{user.displayName}</span>
                          {user.username && (
                            <span style={{ fontSize: 11.5, opacity: 0.6 }}>
                              @{user.username}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--accent, #0088cc)",
                              fontWeight: 600,
                            }}
                          >
                            Kutilmoqda
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Voice selection */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Avto-javob Ovozini Tanlang (1 - 6):
              </label>
              <span style={{ fontSize: 11.5, opacity: 0.65 }}>
                Har birini eshitib ko'rib, yoqqanini tanlang
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 8,
              }}
            >
              {AVAILABLE_VOICES.map((v) => {
                const isSelected = form.voice === v.id;
                const isPlayingThis = isPlayingPreview && previewingVoiceId === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => setForm((prev) => ({ ...prev, voice: v.id }))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: isSelected
                        ? "1.5px solid var(--accent, #0088cc)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: isSelected
                        ? "rgba(0, 136, 204, 0.12)"
                        : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: 13.5,
                            fontWeight: isSelected ? 700 : 500,
                            color: isSelected ? "var(--accent, #0088cc)" : "inherit",
                          }}
                        >
                          {v.title}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 6,
                            background: `${v.badgeColor}25`,
                            color: v.badgeColor,
                          }}
                        >
                          {v.badge}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          opacity: 0.65,
                          marginTop: 3,
                          lineHeight: 1.3,
                        }}
                      >
                        {v.desc}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePlayVoicePreview(v.id);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: "none",
                          background: isPlayingThis
                            ? "#f43f5e"
                            : "rgba(255,255,255,0.08)",
                          color: isPlayingThis ? "#fff" : "inherit",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        title={`${v.name} ovozini eshitib ko'rish`}
                      >
                        <span>{isPlayingThis ? "⏹️ To'xtatish" : "▶️ Eshitish"}</span>
                      </button>

                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: isSelected
                            ? "5px solid var(--accent, #0088cc)"
                            : "2px solid rgba(255,255,255,0.25)",
                          background: isSelected ? "#fff" : "transparent",
                          flexShrink: 0,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Greeting text input */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Qo'ng'iroqda aytiladigan matn:
              </label>
              <button
                type="button"
                onClick={handlePlayPreview}
                style={{
                  background: isPlayingPreview
                    ? "#f43f5e"
                    : "rgba(0, 136, 204, 0.2)",
                  color: isPlayingPreview ? "#fff" : "var(--accent, #0088cc)",
                  border: "none",
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {isPlayingPreview ? "⏹ To'xtatish" : "🔊 Ovozni tinglash"}
              </button>
            </div>

            <textarea
              rows={3}
              value={form.greetingText}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, greetingText: e.target.value }))
              }
              placeholder="Qo'ng'iroq qilgan odamga nima deyilsin..."
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "var(--input-bg, rgba(255,255,255,0.06))",
                color: "inherit",
                fontSize: 13,
                boxSizing: "border-box",
                resize: "vertical",
                lineHeight: 1.4,
              }}
            />

            {/* Template Chips */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.6, alignSelf: "center" }}>
                Namunalar:
              </span>
              {[
                {
                  label: "🚽 Chiqib ketdim (5 daqiqa)",
                  text: "Assalomu alaykum! Men hozir birozga chiqib ketgandim, 5 daqiqadan so'ng qaytaman. Iltimos kuting yoki chatga yozib qoldiring.",
                },
                {
                  label: "🚗 Mashinadaman",
                  text: "Assalomu alaykum! Hozir rulda yoki yo'ldaman, ko'tarolmayman. Tez orada qayta qo'ng'iroq qilaman.",
                },
                {
                  label: "💼 Majlisdaman",
                  text: "Assalomu alaykum! Men hozir muhim yig'ilishdaman, gaplasholmayman. Iltimos chatga yozing.",
                },
                {
                  label: "⌛ 10 daqiqada qaytaman",
                  text: "Assalomu alaykum! Zarur ish bilan 10 daqiqaga joyimdan jildim. Iltimos, birozdan keyin qayta qiling.",
                },
              ].map((tpl, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleApplyTemplate(tpl.text)}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 11,
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingTop: 8,
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Delay */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 13 }}>Qo'ng'iroqni ko'tarish kechikishi:</span>
              <select
                value={form.delaySeconds}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    delaySeconds: parseInt(e.target.value, 10) || 2,
                  }))
                }
                style={{
                  background: "var(--input-bg, rgba(255,255,255,0.1))",
                  color: "inherit",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                <option value={1} style={{ background: "#1e2c3a" }}>
                  1 soniya (tezda)
                </option>
                <option value={2} style={{ background: "#1e2c3a" }}>
                  2 soniya (tavsiya etiladi)
                </option>
                <option value={4} style={{ background: "#1e2c3a" }}>
                  4 soniya
                </option>
                <option value={6} style={{ background: "#1e2c3a" }}>
                  6 soniya
                </option>
              </select>
            </div>

            {/* Chat message toggle */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 13 }}>
                Chatga ham matnli xabarni yozib qoldirish
              </span>
              <input
                type="checkbox"
                checked={form.sendChatMessage}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    sendChatMessage: e.target.checked,
                  }))
                }
                style={{ cursor: "pointer" }}
              />
            </label>

            {/* Hangup after greeting toggle */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 13 }}>
                Ovozli xabar aytib bo'lingach avtomatik go'shakni qo'yish
              </span>
              <input
                type="checkbox"
                checked={form.hangupAfterGreeting}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    hangupAfterGreeting: e.target.checked,
                  }))
                }
                style={{ cursor: "pointer" }}
              />
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Bekor qilish
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "9px 20px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent, #0088cc)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 4px 14px rgba(0, 136, 204, 0.4)",
            }}
          >
            Saqlash
          </button>
        </div>
      </div>
    </div>
  );
}
