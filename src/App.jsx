import { useState, useCallback, useRef } from "react";

// ─── Helpers ────────────────────────────────────────────────────────────────

const CATEGORIES = ["Food", "Essentials", "Household", "Personal Care", "Cleaning Supplies", "Other"];

const CATEGORY_COLORS = {
  Food: "#22c55e",
  Essentials: "#3b82f6",
  Household: "#f59e0b",
  "Personal Care": "#ec4899",
  "Cleaning Supplies": "#8b5cf6",
  Other: "#6b7280",
};

const CATEGORY_ICONS = {
  Food: "🥦",
  Essentials: "🛒",
  Household: "🏠",
  "Personal Care": "🧴",
  "Cleaning Supplies": "🧹",
  Other: "📦",
};

function formatCurrency(n) {
  return "$" + Number(n || 0).toFixed(2);
}

function generateId() {
  return Math.random().toString(36).slice(2);
}

// ─── Anthropic API call ──────────────────────────────────────────────────────

async function parseReceiptWithClaude(imageBase64, mimeType) {
  const prompt = `You are a grocery receipt OCR parser. Analyze this receipt image and extract structured data.

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "store": "Store Name or Unknown",
  "date": "YYYY-MM-DD or null",
  "items": [
    { "name": "Item Name", "price": 1.99, "category": "Food" }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00
}

Category options: Food, Essentials, Household, Personal Care, Cleaning Supplies, Other

Rules:
- Item names should be cleaned up and readable (expand abbreviations when possible)
- Prices must be numbers (floats), not strings
- If subtotal/tax/total not found, calculate or use 0
- Categorize intelligently: produce/meat/dairy/snacks = Food; toilet paper/paper towels = Essentials; detergent/soap/cleaner = Cleaning Supplies; shampoo/lotion/cosmetics = Personal Care; candles/batteries/storage = Household; unknown = Other
- Receipt item names are often abbreviated — make your best guess
- Return ONLY the JSON, nothing else`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
},
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.find(b => b.type === "text")?.text || "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function parseReceiptTextWithClaude(text) {
  const prompt = `You are a grocery receipt parser. Parse this raw receipt text and extract structured data.

Receipt text:
${text}

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "store": "Store Name or Unknown",
  "date": "YYYY-MM-DD or null",
  "items": [
    { "name": "Item Name", "price": 1.99, "category": "Food" }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00
}

Category options: Food, Essentials, Household, Personal Care, Cleaning Supplies, Other
- Prices must be numbers, not strings
- Expand abbreviated item names when possible
- Return ONLY the JSON`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
},
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  const raw = data.content?.find(b => b.type === "text")?.text || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Initial receipt data (empty) ─────────────────────────────────────────────

const DEMO_RECEIPTS = [];

// ─── Components ───────────────────────────────────────────────────────────────

function Badge({ category }) {
  return (
    <span style={{
      background: CATEGORY_COLORS[category] + "22",
      color: CATEGORY_COLORS[category],
      border: `1px solid ${CATEGORY_COLORS[category]}44`,
      borderRadius: "999px",
      padding: "2px 10px",
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.03em",
      whiteSpace: "nowrap",
    }}>
      {CATEGORY_ICONS[category]} {category}
    </span>
  );
}

function CategorySelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: "#1a1f2e",
        color: "#e2e8f0",
        border: "1px solid #2d3748",
        borderRadius: "6px",
        padding: "4px 8px",
        fontSize: "12px",
        cursor: "pointer",
      }}
    >
      {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
    </select>
  );
}

function SpendingBar({ category, amount, max }) {
  const pct = max > 0 ? (amount / max) * 100 : 0;
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "13px", color: "#94a3b8" }}>{CATEGORY_ICONS[category]} {category}</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>{formatCurrency(amount)}</span>
      </div>
      <div style={{ height: "6px", background: "#1e2535", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: CATEGORY_COLORS[category],
          borderRadius: "999px",
          transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)",
        }} />
      </div>
    </div>
  );
}

function MiniDonut({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  let cumulative = 0;
  const size = 120;
  const cx = size / 2, cy = size / 2, r = 46, innerR = 28;
  const segments = data.map(d => {
    const start = cumulative;
    cumulative += d.value / total;
    return { ...d, start, end: cumulative };
  });

  function arc(startFrac, endFrac) {
    const s = startFrac * 2 * Math.PI - Math.PI / 2;
    const e = endFrac * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const xi1 = cx + innerR * Math.cos(e), yi1 = cy + innerR * Math.sin(e);
    const xi2 = cx + innerR * Math.cos(s), yi2 = cy + innerR * Math.sin(s);
    const lg = endFrac - startFrac > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${innerR} ${innerR} 0 ${lg} 0 ${xi2} ${yi2} Z`;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((d, i) => (
        <path key={i} d={arc(d.start, d.end)} fill={CATEGORY_COLORS[d.category]} opacity={0.9} />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight="700">
        {formatCurrency(total)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize="9">total</text>
    </svg>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [receipts, setReceipts] = useState(DEMO_RECEIPTS);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [scanState, setScanState] = useState("idle"); // idle | uploading | scanning | done | error
  const [scanError, setScanError] = useState("");
  const [pendingReceipt, setPendingReceipt] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [manualText, setManualText] = useState("");
  const [scanMode, setScanMode] = useState("image"); // image | text
  const fileRef = useRef();

  // ── Derived data ────────────────────────────────────────────────────────────

  function getCategoryTotals(items) {
    const totals = {};
    CATEGORIES.forEach(c => totals[c] = 0);
    items.forEach(item => {
      totals[item.category] = (totals[item.category] || 0) + Number(item.price);
    });
    return totals;
  }

  function getAllCategoryTotals() {
    const totals = {};
    CATEGORIES.forEach(c => totals[c] = 0);
    receipts.forEach(r => {
      r.items.forEach(item => {
        totals[item.category] = (totals[item.category] || 0) + Number(item.price);
      });
    });
    return totals;
  }

  const allTotals = getAllCategoryTotals();
  const grandTotal = Object.values(allTotals).reduce((a, b) => a + b, 0);
  const maxCatValue = Math.max(...Object.values(allTotals));
  const donutData = CATEGORIES
    .filter(c => allTotals[c] > 0)
    .map(c => ({ category: c, value: allTotals[c] }));

  // ── Upload handler ───────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setScanState("uploading");
    setScanError("");
    setPendingReceipt(null);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];
      const mimeType = file.type || "image/jpeg";
      setScanState("scanning");
      try {
        const parsed = await parseReceiptWithClaude(base64, mimeType);
        const items = (parsed.items || []).map(item => ({
          ...item,
          id: generateId(),
          price: Number(item.price) || 0,
          category: CATEGORIES.includes(item.category) ? item.category : "Other",
        }));
        const calcTotal = items.reduce((s, i) => s + i.price, 0);
        setPendingReceipt({
          id: generateId(),
          store: parsed.store || "Unknown Store",
          date: parsed.date || new Date().toISOString().slice(0, 10),
          scannedAt: new Date().toISOString(),
          items,
          subtotal: Number(parsed.subtotal) || calcTotal,
          tax: Number(parsed.tax) || 0,
          total: Number(parsed.total) || calcTotal,
        });
        setScanState("done");
      } catch (err) {
        setScanError("Could not parse receipt. Please try again or use manual text entry.");
        setScanState("error");
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleManualParse = async () => {
    if (!manualText.trim()) return;
    setScanState("scanning");
    setScanError("");
    try {
      const parsed = await parseReceiptTextWithClaude(manualText);
      const items = (parsed.items || []).map(item => ({
        ...item,
        id: generateId(),
        price: Number(item.price) || 0,
        category: CATEGORIES.includes(item.category) ? item.category : "Other",
      }));
      const calcTotal = items.reduce((s, i) => s + i.price, 0);
      setPendingReceipt({
        id: generateId(),
        store: parsed.store || "Unknown Store",
        date: parsed.date || new Date().toISOString().slice(0, 10),
        scannedAt: new Date().toISOString(),
        items,
        subtotal: Number(parsed.subtotal) || calcTotal,
        tax: Number(parsed.tax) || 0,
        total: Number(parsed.total) || calcTotal,
      });
      setScanState("done");
    } catch (err) {
      setScanError("Could not parse receipt text. Try to format it more clearly.");
      setScanState("error");
    }
  };

  const saveReceipt = () => {
    if (!pendingReceipt) return;
    setReceipts(r => [pendingReceipt, ...r]);
    setActiveReceipt(pendingReceipt);
    setPendingReceipt(null);
    setPreviewUrl(null);
    setScanState("idle");
    setPage("detail");
  };

  const updatePendingItem = (id, field, value) => {
    setPendingReceipt(r => ({
      ...r,
      items: r.items.map(i => i.id === id ? { ...i, [field]: value } : i),
    }));
  };

  const updateSavedItem = (receiptId, itemId, field, value) => {
    setReceipts(rs => rs.map(r => r.id !== receiptId ? r : {
      ...r,
      items: r.items.map(i => i.id === itemId ? { ...i, [field]: value } : i),
    }));
    if (activeReceipt?.id === receiptId) {
      setActiveReceipt(r => ({
        ...r,
        items: r.items.map(i => i.id === itemId ? { ...i, [field]: value } : i),
      }));
    }
  };

  const deleteReceipt = (id) => {
    setReceipts(rs => rs.filter(r => r.id !== id));
    if (activeReceipt?.id === id) setActiveReceipt(null);
    setPage("history");
  };

  const resetScan = () => {
    setScanState("idle");
    setScanError("");
    setPendingReceipt(null);
    setPreviewUrl(null);
    setManualText("");
  };

  // ── Styles ──────────────────────────────────────────────────────────────────

  const S = {
    app: {
      minHeight: "100vh",
      background: "#0d1117",
      color: "#e2e8f0",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
    },
    topbar: {
      background: "#0d1117",
      borderBottom: "1px solid #1e2535",
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      height: "58px",
      position: "sticky",
      top: 0,
      zIndex: 100,
    },
    logo: {
      fontSize: "18px",
      fontWeight: 800,
      color: "#fff",
      letterSpacing: "-0.5px",
      marginRight: "auto",
      cursor: "pointer",
    },
    navBtn: (active) => ({
      padding: "6px 14px",
      borderRadius: "8px",
      border: "none",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: 600,
      background: active ? "#1e40af22" : "transparent",
      color: active ? "#60a5fa" : "#64748b",
      transition: "all 0.15s",
    }),
    main: { flex: 1, padding: "28px 24px", maxWidth: "900px", margin: "0 auto", width: "100%" },
    card: {
      background: "#111827",
      border: "1px solid #1e2535",
      borderRadius: "14px",
      padding: "24px",
      marginBottom: "20px",
    },
    h1: { fontSize: "22px", fontWeight: 800, color: "#f1f5f9", marginBottom: "4px" },
    h2: { fontSize: "16px", fontWeight: 700, color: "#f1f5f9", marginBottom: "12px" },
    label: { fontSize: "12px", color: "#64748b", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px", display: "block" },
    btn: (variant = "primary") => ({
      padding: "10px 20px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: 700,
      transition: "all 0.15s",
      ...(variant === "primary" ? { background: "#2563eb", color: "#fff" } :
        variant === "green" ? { background: "#16a34a", color: "#fff" } :
        variant === "ghost" ? { background: "transparent", color: "#64748b", border: "1px solid #1e2535" } :
        variant === "danger" ? { background: "#dc262622", color: "#f87171", border: "1px solid #dc262633" } :
        { background: "#1e2535", color: "#94a3b8" }),
    }),
    table: { width: "100%", borderCollapse: "collapse" },
    th: { textAlign: "left", padding: "10px 12px", fontSize: "11px", color: "#475569", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid #1e2535" },
    td: { padding: "12px 12px", fontSize: "13px", color: "#cbd5e1", borderBottom: "1px solid #111827" },
    input: {
      background: "#1a1f2e",
      border: "1px solid #2d3748",
      borderRadius: "8px",
      color: "#e2e8f0",
      padding: "8px 12px",
      fontSize: "13px",
      width: "100%",
      outline: "none",
    },
    statCard: {
      background: "#111827",
      border: "1px solid #1e2535",
      borderRadius: "12px",
      padding: "20px",
      flex: 1,
    },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" },
    flex: (gap = 12) => ({ display: "flex", alignItems: "center", gap }),
    tag: (active) => ({
      padding: "6px 14px",
      borderRadius: "8px",
      border: `1px solid ${active ? "#2563eb" : "#1e2535"}`,
      background: active ? "#1e40af22" : "transparent",
      color: active ? "#60a5fa" : "#64748b",
      fontSize: "13px",
      fontWeight: 600,
      cursor: "pointer",
    }),
  };

  // ── Pages ────────────────────────────────────────────────────────────────────

  const DashboardPage = () => (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={S.h1}>Dashboard</div>
        <div style={{ color: "#475569", fontSize: "14px" }}>Spending overview across all receipts</div>
      </div>

      <div style={S.grid2}>
        <div style={S.statCard}>
          <div style={{ color: "#475569", fontSize: "12px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "8px" }}>Total Spent</div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#f1f5f9" }}>{formatCurrency(grandTotal)}</div>
          <div style={{ color: "#475569", fontSize: "12px", marginTop: "4px" }}>{receipts.length} receipt{receipts.length !== 1 ? "s" : ""}</div>
        </div>
        <div style={S.statCard}>
          <div style={{ color: "#475569", fontSize: "12px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "8px" }}>Top Category</div>
          {(() => {
            const top = Object.entries(allTotals).sort((a, b) => b[1] - a[1])[0];
            return top && top[1] > 0 ? (
              <>
                <div style={{ fontSize: "22px", fontWeight: 800, color: CATEGORY_COLORS[top[0]] }}>{CATEGORY_ICONS[top[0]]} {top[0]}</div>
                <div style={{ color: "#475569", fontSize: "12px", marginTop: "4px" }}>{formatCurrency(top[1])}</div>
              </>
            ) : <div style={{ color: "#475569" }}>No data yet</div>;
          })()}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.h2}>Spending by Category</div>
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            {CATEGORIES.map(c => allTotals[c] > 0 && (
              <SpendingBar key={c} category={c} amount={allTotals[c]} max={maxCatValue} />
            ))}
            {grandTotal === 0 && <div style={{ color: "#475569", fontSize: "14px" }}>Scan receipts to see spending data.</div>}
          </div>
          {grandTotal > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <MiniDonut data={donutData} />
              <div style={{ fontSize: "11px", color: "#475569" }}>Distribution</div>
            </div>
          )}
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={S.h2}>Recent Receipts</div>
          <button style={S.btn("ghost")} onClick={() => setPage("history")}>View All →</button>
        </div>
        {receipts.slice(0, 3).map(r => (
          <div key={r.id} onClick={() => { setActiveReceipt(r); setPage("detail"); }}
            style={{ display: "flex", alignItems: "center", padding: "12px", borderRadius: "10px", cursor: "pointer", transition: "background 0.1s", marginBottom: "4px" }}
            onMouseEnter={e => e.currentTarget.style.background = "#1a1f2e"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: "14px" }}>{r.store}</div>
              <div style={{ color: "#475569", fontSize: "12px" }}>{r.date} · {r.items.length} items</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: "16px", color: "#f1f5f9" }}>{formatCurrency(r.total)}</div>
          </div>
        ))}
        {receipts.length === 0 && <div style={{ color: "#475569", fontSize: "14px" }}>No receipts yet.</div>}
        <button style={{ ...S.btn("primary"), marginTop: "16px", width: "100%" }} onClick={() => { resetScan(); setPage("scan"); }}>
          + Scan New Receipt
        </button>
      </div>
    </div>
  );

  const ScanPage = () => (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={S.h1}>Scan Receipt</div>
        <div style={{ color: "#475569", fontSize: "14px" }}>Upload an image or paste receipt text</div>
      </div>

      {scanState === "idle" || scanState === "error" ? (
        <>
          <div style={{ ...S.flex(8), marginBottom: "20px" }}>
            {["image", "text"].map(m => (
              <button key={m} style={S.tag(scanMode === m)} onClick={() => setScanMode(m)}>
                {m === "image" ? "📷 Image Upload" : "📝 Paste Text"}
              </button>
            ))}
          </div>

          {scanMode === "image" ? (
            <div
              style={{ ...S.card, border: "2px dashed #1e3a5f", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#2563eb"; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = "#1e3a5f"; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#1e3a5f"; handleFile(e.dataTransfer.files[0]); }}
            >
              <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
                onChange={e => handleFile(e.target.files[0])} />
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🧾</div>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "6px" }}>Drop receipt here or click to browse</div>
              <div style={{ color: "#475569", fontSize: "13px" }}>Supports JPG, PNG, PDF · Mobile camera supported</div>
              <button style={{ ...S.btn("primary"), marginTop: "20px" }}>Choose File</button>
            </div>
          ) : (
            <div style={S.card}>
              <div style={S.h2}>Paste Receipt Text</div>
              <textarea
                value={manualText}
                onChange={e => setManualText(e.target.value)}
                placeholder={"WHOLE FOODS MARKET\n03/06/2026\n\nORG BANANAS      1.49\nALMOND MILK      3.99\nBREAD WHL GRN    4.29\nPAPER TOWELS     7.99\n\nSUBTOTAL        17.76\nTAX              0.52\nTOTAL           18.28"}
                style={{ ...S.input, height: "220px", resize: "vertical", fontFamily: "monospace", fontSize: "12px" }}
              />
              <button style={{ ...S.btn("primary"), marginTop: "12px" }} onClick={handleManualParse} disabled={!manualText.trim()}>
                Parse Receipt →
              </button>
            </div>
          )}

          {scanState === "error" && (
            <div style={{ background: "#7f1d1d22", border: "1px solid #7f1d1d", borderRadius: "10px", padding: "14px 18px", color: "#fca5a5", fontSize: "14px", marginTop: "16px" }}>
              ⚠️ {scanError}
            </div>
          )}
        </>
      ) : scanState === "uploading" || scanState === "scanning" ? (
        <div style={{ ...S.card, textAlign: "center", padding: "60px 24px" }}>
          {previewUrl && (
            <img src={previewUrl} alt="receipt" style={{ maxHeight: "200px", maxWidth: "100%", borderRadius: "10px", marginBottom: "24px", border: "1px solid #1e2535" }} />
          )}
          <div style={{ fontSize: "32px", marginBottom: "12px", animation: "spin 1s linear infinite" }}>⚙️</div>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>
            {scanState === "uploading" ? "Loading receipt..." : "Parsing with AI..."}
          </div>
          <div style={{ color: "#475569", fontSize: "13px", marginTop: "6px" }}>Extracting items, prices, and categories</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : scanState === "done" && pendingReceipt ? (
        <div>
          <div style={{ ...S.flex(12), marginBottom: "20px" }}>
            {previewUrl && (
              <img src={previewUrl} alt="receipt" style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "10px", border: "1px solid #1e2535" }} />
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: "18px" }}>{pendingReceipt.store}</div>
              <div style={{ color: "#475569", fontSize: "13px" }}>{pendingReceipt.date} · {pendingReceipt.items.length} items found</div>
            </div>
          </div>

          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={S.h2}>Extracted Items</div>
              <div style={{ color: "#475569", fontSize: "12px" }}>Edit names, prices, and categories below</div>
            </div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Item</th>
                  <th style={S.th}>Category</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {pendingReceipt.items.map(item => (
                  <tr key={item.id}>
                    <td style={S.td}>
                      <input
                        style={{ ...S.input, padding: "4px 8px" }}
                        value={item.name}
                        onChange={e => updatePendingItem(item.id, "name", e.target.value)}
                      />
                    </td>
                    <td style={S.td}>
                      <CategorySelect value={item.category} onChange={v => updatePendingItem(item.id, "category", v)} />
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <input
                        style={{ ...S.input, padding: "4px 8px", textAlign: "right", width: "80px" }}
                        type="number"
                        step="0.01"
                        value={item.price}
                        onChange={e => updatePendingItem(item.id, "price", parseFloat(e.target.value) || 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.card}>
            <div style={S.h2}>Category Summary</div>
            {CATEGORIES.map(c => {
              const total = pendingReceipt.items.filter(i => i.category === c).reduce((s, i) => s + i.price, 0);
              return total > 0 ? (
                <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e2535" }}>
                  <span style={{ fontSize: "13px" }}><Badge category={c} /></span>
                  <span style={{ fontWeight: 700, fontSize: "14px" }}>{formatCurrency(total)}</span>
                </div>
              ) : null;
            })}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 0", fontWeight: 800, fontSize: "16px" }}>
              <span>Total</span>
              <span>{formatCurrency(pendingReceipt.items.reduce((s, i) => s + i.price, 0))}</span>
            </div>
          </div>

          <div style={S.flex(12)}>
            <button style={S.btn("green")} onClick={saveReceipt}>✓ Save Receipt</button>
            <button style={S.btn("ghost")} onClick={resetScan}>← Scan Another</button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const HistoryPage = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <div style={S.h1}>Receipt History</div>
          <div style={{ color: "#475569", fontSize: "14px" }}>{receipts.length} receipts saved</div>
        </div>
        <button style={S.btn("primary")} onClick={() => { resetScan(); setPage("scan"); }}>+ New Scan</button>
      </div>

      {receipts.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🧾</div>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>No receipts yet</div>
          <div style={{ color: "#475569", fontSize: "13px", marginTop: "6px" }}>Upload your first receipt to get started.</div>
        </div>
      ) : (
        receipts.map(r => (
          <div key={r.id} style={{ ...S.card, cursor: "pointer", transition: "border-color 0.2s" }}
            onClick={() => { setActiveReceipt(r); setPage("detail"); }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#2563eb44"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2535"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "16px", marginBottom: "4px" }}>{r.store}</div>
                <div style={{ color: "#475569", fontSize: "12px" }}>{r.date} · {r.items.length} items</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                  {CATEGORIES.filter(c => r.items.some(i => i.category === c)).map(c => (
                    <Badge key={c} category={c} />
                  ))}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: "20px", color: "#f1f5f9" }}>{formatCurrency(r.total)}</div>
                <div style={{ color: "#22c55e", fontSize: "11px", marginTop: "4px" }}>View →</div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const DetailPage = () => {
    const r = receipts.find(x => x.id === activeReceipt?.id) || activeReceipt;
    if (!r) return <div style={{ color: "#475569", padding: "40px" }}>Receipt not found.</div>;

    const catTotals = getCategoryTotals(r.items);
    const maxCat = Math.max(...Object.values(catTotals));

    return (
      <div>
        <button style={{ ...S.btn("ghost"), marginBottom: "20px" }} onClick={() => setPage("history")}>← Back</button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
          <div>
            <div style={S.h1}>{r.store}</div>
            <div style={{ color: "#475569", fontSize: "14px" }}>{r.date} · {r.items.length} items scanned</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "26px", fontWeight: 800 }}>{formatCurrency(r.total)}</div>
            <button style={{ ...S.btn("danger"), marginTop: "8px", fontSize: "12px", padding: "6px 12px" }}
              onClick={() => { if (window.confirm("Delete this receipt?")) deleteReceipt(r.id); }}>
              🗑 Delete
            </button>
          </div>
        </div>

        <div style={S.grid2}>
          <div style={S.card}>
            <div style={S.h2}>Category Totals</div>
            {CATEGORIES.map(c => catTotals[c] > 0 && (
              <SpendingBar key={c} category={c} amount={catTotals[c]} max={maxCat} />
            ))}
          </div>
          <div style={S.card}>
            <div style={S.h2}>Receipt Summary</div>
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>
              {[
                { label: "Subtotal", val: r.subtotal },
                { label: "Tax", val: r.tax },
              ].map(({ label, val }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e2535" }}>
                  <span>{label}</span><span>{formatCurrency(val)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontWeight: 800, fontSize: "16px", color: "#f1f5f9" }}>
                <span>Total</span><span>{formatCurrency(r.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={S.h2}>All Items</div>
            <div style={{ color: "#475569", fontSize: "12px" }}>Click to edit</div>
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Item</th>
                <th style={S.th}>Category</th>
                <th style={{ ...S.th, textAlign: "right" }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map(item => (
                <tr key={item.id}>
                  <td style={S.td}>
                    {editingItemId === item.id ? (
                      <input
                        autoFocus
                        style={{ ...S.input, padding: "4px 8px" }}
                        defaultValue={item.name}
                        onBlur={e => { updateSavedItem(r.id, item.id, "name", e.target.value); setEditingItemId(null); }}
                        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                      />
                    ) : (
                      <span style={{ cursor: "pointer" }} onClick={() => setEditingItemId(item.id)}>{item.name}</span>
                    )}
                  </td>
                  <td style={S.td}>
                    <CategorySelect value={item.category} onChange={v => updateSavedItem(r.id, item.id, "category", v)} />
                  </td>
                  <td style={{ ...S.td, textAlign: "right", fontWeight: 700 }}>{formatCurrency(item.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "scan", label: "Scan", icon: "📷" },
    { id: "history", label: "History", icon: "🧾" },
  ];

  return (
    <div style={S.app}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <div style={S.topbar}>
        <div style={S.logo} onClick={() => setPage("dashboard")}>🛒 ReceiptIQ</div>
        {NAV.map(n => (
          <button key={n.id} style={S.navBtn(page === n.id || (n.id === "scan" && page === "scan"))}
            onClick={() => { if (n.id === "scan") resetScan(); setPage(n.id); }}>
            {n.icon} {n.label}
          </button>
        ))}
      </div>

      <div style={S.main}>
        {page === "dashboard" && <DashboardPage />}
        {page === "scan" && <ScanPage />}
        {page === "history" && <HistoryPage />}
        {page === "detail" && <DetailPage />}
      </div>
    </div>
  );
}
