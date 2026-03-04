import { useState, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, LineChart, Line, Cell
} from "recharts";

// ─── DCF CORE ENGINE ───────────────────────────────────────────────────────────
function calcDCF(inputs) {
  const { revenue, growthRates, ebitMargin, taxRate, daPercent, capexPercent, nwcPercent, wacc, tGrowth, years, sharesOut, netDebt } = inputs;
  const waccD = wacc / 100, tgD = tGrowth / 100;
  if (waccD <= tgD) return null;

  let prevRev = revenue;
  let prevNWC = revenue * (nwcPercent / 100);
  const rows = [];

  for (let i = 0; i < years; i++) {
    const rev = prevRev * (1 + growthRates[i] / 100);
    const ebit = rev * (ebitMargin / 100);
    const nopat = ebit * (1 - taxRate / 100);
    const da = rev * (daPercent / 100);
    const capex = rev * (capexPercent / 100);
    const nwc = rev * (nwcPercent / 100);
    const dNWC = nwc - prevNWC;
    const fcf = nopat + da - capex - dNWC;
    const df = Math.pow(1 + waccD, i + 1);
    rows.push({ year: `Y${i + 1}`, rev, ebit, nopat, da, capex, dNWC, fcf, pvFCF: fcf / df });
    prevRev = rev;
    prevNWC = nwc;
  }

  const lastFCF = rows[rows.length - 1].fcf;
  const tv = lastFCF * (1 + tgD) / (waccD - tgD);
  const pvTV = tv / Math.pow(1 + waccD, years);
  const pvFCFs = rows.reduce((s, r) => s + r.pvFCF, 0);
  const ev = pvFCFs + pvTV;
  const equity = ev - netDebt;
  const pricePerShare = sharesOut > 0 ? equity / sharesOut : null;

  return { rows, tv, pvTV, pvFCFs, ev, equity, pricePerShare, tvPct: (pvTV / ev) * 100 };
}

// ─── MONTE CARLO ───────────────────────────────────────────────────────────────
function boxMuller() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function runMC(baseInputs, n = 8000) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const wacc = baseInputs.wacc + boxMuller() * 1.2;
    const tGrowth = baseInputs.tGrowth + boxMuller() * 0.4;
    const ebitMargin = baseInputs.ebitMargin + boxMuller() * 2.5;
    const growthRates = baseInputs.growthRates.map(g => g + boxMuller() * 2.5);
    if (wacc <= tGrowth || wacc < 1 || ebitMargin < 0) continue;
    const res = calcDCF({ ...baseInputs, wacc, tGrowth, ebitMargin, growthRates });
    if (res && res.pricePerShare > 0 && res.pricePerShare < 99999) results.push(res.pricePerShare);
  }
  return results.sort((a, b) => a - b);
}

function percentile(arr, p) { return arr[Math.floor(arr.length * p / 100)] ?? 0; }
function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function buildHistogram(arr, bins = 40) {
  if (!arr.length) return [];
  const min = arr[0], max = arr[arr.length - 1];
  const w = (max - min) / bins;
  const hist = Array.from({ length: bins }, (_, i) => ({ x: min + i * w, count: 0 }));
  arr.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / w), bins - 1);
    hist[idx].count++;
  });
  return hist;
}

// ─── SENSITIVITY ───────────────────────────────────────────────────────────────
function buildSensitivity(baseInputs, waccRange, tgRange) {
  return tgRange.map(tg =>
    waccRange.map(w => {
      const r = calcDCF({ ...baseInputs, wacc: w, tGrowth: tg });
      return r ? r.pricePerShare : null;
    })
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (v, d = 1) => v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(d)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(d)}M` : `$${v.toFixed(d)}`;
const fmtP = (v, d = 1) => `$${v.toFixed(d)}`;
const pct = v => `${v.toFixed(1)}%`;
const num = v => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
const A = "#F59E0B";  // amber accent
const G = "#10b981";  // green
const R = "#ef4444";  // red
const BG = "#030712";
const CARD = "#0c1220";
const BORDER = "rgba(245,158,11,0.18)";
const MUTED = "#4a5568";

function Label({ children }) {
  return <div style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: A, fontFamily: "monospace", marginBottom: 6 }}>{children}</div>;
}

function InputField({ label, value, onChange, min, max, step = 0.1, unit = "" }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#7a8a9a", fontFamily: "monospace" }}>{label}</span>
        <span style={{ fontSize: 12, color: A, fontFamily: "monospace", fontWeight: "bold" }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: A, cursor: "pointer" }} />
    </div>
  );
}

function StatBox({ label, value, sub, color = "#e8e0d0", small = false }) {
  return (
    <div style={{ padding: "14px 16px", background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: MUTED, letterSpacing: "2px", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: small ? 18 : 22, color, fontFamily: "'Georgia', serif", fontWeight: "bold", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#5a6a7a", fontFamily: "monospace", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const DEFAULT = {
  company: "DemoTech Inc.",
  ticker: "DEMO",
  revenue: 500,       // $M
  growthRates: [18, 15, 13, 11, 9],
  ebitMargin: 22,
  taxRate: 17,
  daPercent: 4,
  capexPercent: 6,
  nwcPercent: 8,
  wacc: 10,
  tGrowth: 2.5,
  years: 5,
  sharesOut: 100,     // millions
  netDebt: 50,        // $M — positive = net debt, negative = net cash
};

export default function DCFEngine() {
  const [inp, setInp] = useState(DEFAULT);
  const [tab, setTab] = useState("dcf");
  const [ran, setRan] = useState(false);
  const [mcResults, setMcResults] = useState([]);
  const [running, setRunning] = useState(false);

  const set = useCallback((key, val) => setInp(p => ({ ...p, [key]: val })), []);
  const setGrowth = useCallback((i, v) => setInp(p => { const g = [...p.growthRates]; g[i] = v; return { ...p, growthRates: g }; }), []);

  const dcf = useMemo(() => calcDCF(inp), [inp]);

  const waccRange = useMemo(() => {
    const base = parseFloat(inp.wacc);
    return [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map(d => parseFloat((base + d).toFixed(1)));
  }, [inp.wacc]);
  const tgRange = useMemo(() => {
    const base = parseFloat(inp.tGrowth);
    return [-1, -0.5, 0, 0.5, 1].map(d => parseFloat((base + d).toFixed(1)));
  }, [inp.tGrowth]);
  const sensitivity = useMemo(() => buildSensitivity(inp, waccRange, tgRange), [inp, waccRange, tgRange]);

  const runMonteCarlo = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const r = runMC(inp, 8000);
      setMcResults(r);
      setRan(true);
      setRunning(false);
    }, 50);
  }, [inp]);

  const histogram = useMemo(() => buildHistogram(mcResults, 42), [mcResults]);
  const mcMean = useMemo(() => mcResults.length ? mean(mcResults) : 0, [mcResults]);
  const mcStd = useMemo(() => mcResults.length ? stddev(mcResults) : 0, [mcResults]);
  const mc5 = useMemo(() => mcResults.length ? percentile(mcResults, 5) : 0, [mcResults]);
  const mc25 = useMemo(() => mcResults.length ? percentile(mcResults, 25) : 0, [mcResults]);
  const mc75 = useMemo(() => mcResults.length ? percentile(mcResults, 75) : 0, [mcResults]);
  const mc95 = useMemo(() => mcResults.length ? percentile(mcResults, 95) : 0, [mcResults]);

  const pps = dcf?.pricePerShare;
  const upside = pps && inp.currentPrice ? ((pps - inp.currentPrice) / inp.currentPrice * 100) : null;

  const tabStyle = (t) => ({
    padding: "8px 20px", border: "none", borderBottom: tab === t ? `2px solid ${A}` : "2px solid transparent",
    background: "transparent", color: tab === t ? A : MUTED,
    fontSize: 12, letterSpacing: "1.5px", textTransform: "uppercase",
    fontFamily: "monospace", cursor: "pointer", transition: "all 0.2s",
  });

  const fcfChartData = dcf?.rows.map(r => ({
    year: r.year,
    FCF: parseFloat((r.fcf).toFixed(1)),
    "PV of FCF": parseFloat((r.pvFCF).toFixed(1)),
  })) ?? [];

  const waterfall = dcf ? [
    ...dcf.rows.map(r => ({ name: r.year, value: parseFloat(r.pvFCF.toFixed(1)), type: "fcf" })),
    { name: "Terminal", value: parseFloat(dcf.pvTV.toFixed(1)), type: "tv" },
  ] : [];

  function sensitivityColor(val) {
    if (!dcf || !val || !pps) return "rgba(255,255,255,0.04)";
    const ratio = val / pps;
    if (ratio >= 1.2) return "rgba(16,185,129,0.35)";
    if (ratio >= 1.05) return "rgba(16,185,129,0.18)";
    if (ratio >= 0.95) return `rgba(245,158,11,0.2)`;
    if (ratio >= 0.8) return "rgba(239,68,68,0.18)";
    return "rgba(239,68,68,0.35)";
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", color: "#e8e0d0" }}>
      {/* ── HEADER ── */}
      <div style={{ background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ padding: "6px 12px", background: "rgba(245,158,11,0.15)", border: `1px solid ${A}`, borderRadius: 4, fontSize: 12, color: A, fontFamily: "monospace", letterSpacing: 2 }}>DCF</div>
          <div>
            <div style={{ fontSize: 18, color: "#f5f0e0", fontFamily: "'Georgia', serif", letterSpacing: 0.5 }}>Valuation Engine</div>
            <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: 2, marginTop: 2 }}>DCF + MONTE CARLO + SENSITIVITY</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {dcf && [
            ["Enterprise Value", fmt(dcf.ev * 1e6)],
            ["Equity Value", fmt(dcf.equity * 1e6)],
            ["Price / Share", pps ? fmtP(pps) : "—"],
            ["TV% of EV", pct(dcf.tvPct)],
          ].map(([l, v]) => (
            <div key={l} style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", letterSpacing: 1 }}>{l}</div>
              <div style={{ fontSize: 16, color: A, fontFamily: "'Georgia', serif", fontWeight: "bold" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 65px)", minHeight: 700 }}>
        {/* ── LEFT PANEL ── */}
        <div style={{ width: 280, flexShrink: 0, background: CARD, borderRight: `1px solid ${BORDER}`, overflowY: "auto", padding: "20px 18px" }}>
          <Label>Company</Label>
          <div style={{ marginBottom: 16 }}>
            <input value={inp.company} onChange={e => set("company", e.target.value)}
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 10px", color: "#e8e0d0", fontFamily: "monospace", fontSize: 13, boxSizing: "border-box" }} />
            <input value={inp.ticker} onChange={e => set("ticker", e.target.value)}
              placeholder="Ticker" style={{ width: "100%", marginTop: 6, background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, padding: "7px 10px", color: A, fontFamily: "monospace", fontSize: 13, letterSpacing: 2, boxSizing: "border-box" }} />
          </div>

          <Label>Base Revenue ($M)</Label>
          <InputField label="Revenue" value={inp.revenue} onChange={v => set("revenue", v)} min={10} max={10000} step={10} unit="M" />

          <Label>Revenue Growth Rates</Label>
          {inp.growthRates.map((g, i) => (
            <InputField key={i} label={`Year ${i + 1}`} value={g} onChange={v => setGrowth(i, v)} min={-10} max={60} step={0.5} unit="%" />
          ))}

          <Label>Profitability</Label>
          <InputField label="EBIT Margin" value={inp.ebitMargin} onChange={v => set("ebitMargin", v)} min={1} max={60} step={0.5} unit="%" />
          <InputField label="Tax Rate" value={inp.taxRate} onChange={v => set("taxRate", v)} min={0} max={40} step={0.5} unit="%" />
          <InputField label="D&A (% Rev)" value={inp.daPercent} onChange={v => set("daPercent", v)} min={0} max={20} step={0.25} unit="%" />
          <InputField label="CapEx (% Rev)" value={inp.capexPercent} onChange={v => set("capexPercent", v)} min={0} max={30} step={0.25} unit="%" />
          <InputField label="ΔNWC (% Rev)" value={inp.nwcPercent} onChange={v => set("nwcPercent", v)} min={0} max={25} step={0.25} unit="%" />

          <Label>Discount Assumptions</Label>
          <InputField label="WACC" value={inp.wacc} onChange={v => set("wacc", v)} min={4} max={25} step={0.25} unit="%" />
          <InputField label="Terminal Growth" value={inp.tGrowth} onChange={v => set("tGrowth", v)} min={0} max={5} step={0.1} unit="%" />

          <Label>Capital Structure</Label>
          <InputField label="Shares Out (M)" value={inp.sharesOut} onChange={v => set("sharesOut", v)} min={1} max={10000} step={1} unit="M" />
          <InputField label="Net Debt ($M)" value={inp.netDebt} onChange={v => set("netDebt", v)} min={-5000} max={10000} step={10} unit="M" />
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {/* Tab bar */}
          <div style={{ borderBottom: `1px solid rgba(255,255,255,0.07)`, display: "flex", background: CARD, flexShrink: 0 }}>
            {[["dcf", "DCF Model"], ["mc", "Monte Carlo"], ["sens", "Sensitivity"]].map(([t, l]) => (
              <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>

          <div style={{ padding: "24px 28px", flex: 1 }}>

            {/* ══ DCF TAB ══════════════════════════════════════════════════════ */}
            {tab === "dcf" && dcf && (
              <div>
                {/* KPI Row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 28 }}>
                  <StatBox label="Enterprise Value" value={fmt(dcf.ev * 1e6)} sub={`PV FCFs: ${fmt(dcf.pvFCFs * 1e6)} + TV: ${fmt(dcf.pvTV * 1e6)}`} color={A} />
                  <StatBox label="Equity Value" value={fmt(dcf.equity * 1e6)} sub={`EV − Net Debt $${inp.netDebt}M`} color={G} />
                  <StatBox label="Intrinsic Price" value={pps ? fmtP(pps) : "N/A"} sub={`${inp.sharesOut}M shares`} color="#60a5fa" />
                  <StatBox label="TV % of EV" value={pct(dcf.tvPct)} sub={`Terminal Growth: ${inp.tGrowth}%`} color={dcf.tvPct > 75 ? R : A} />
                </div>

                {/* Waterfall chart */}
                <Label>Value Build-Up ($M)</Label>
                <div style={{ height: 220, marginBottom: 28 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={waterfall} margin={{ top: 4, right: 20, bottom: 0, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#5a6a7a", fontSize: 11, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#5a6a7a", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}M`} />
                      <Tooltip
                        contentStyle={{ background: "#0c1220", border: `1px solid ${BORDER}`, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}
                        formatter={(v) => [`$${v}M`, "PV"]}
                        labelStyle={{ color: A }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {waterfall.map((entry, i) => (
                          <Cell key={i} fill={entry.type === "tv" ? "rgba(245,158,11,0.7)" : "rgba(96,165,250,0.65)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* FCF Table */}
                <Label>Projected Free Cash Flows</Label>
                <div style={{ overflowX: "auto", marginBottom: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace" }}>
                    <thead>
                      <tr>
                        {["", "Revenue", "EBIT", "NOPAT", "D&A", "CapEx", "ΔNWC", "FCF", "PV(FCF)"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: h === "" ? "left" : "right", color: A, fontSize: 10, letterSpacing: 1.5, borderBottom: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dcf.rows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          {[r.year, r.rev, r.ebit, r.nopat, r.da, r.capex, r.dNWC, r.fcf, r.pvFCF].map((v, j) => (
                            <td key={j} style={{
                              padding: "9px 12px",
                              textAlign: j === 0 ? "left" : "right",
                              color: j === 0 ? "#7a8a9a" : j === 7 ? G : j === 8 ? "#60a5fa" : "#b8c8d8",
                              fontWeight: j >= 7 ? "bold" : "normal",
                            }}>
                              {j === 0 ? v : `$${parseFloat(v.toFixed(1))}M`}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(245,158,11,0.04)" }}>
                        <td colSpan={8} style={{ padding: "9px 12px", color: A, textAlign: "right", fontSize: 11, letterSpacing: 1 }}>TERMINAL VALUE (PV)</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", color: A, fontWeight: "bold" }}>{`$${dcf.pvTV.toFixed(1)}M`}</td>
                      </tr>
                      <tr style={{ background: "rgba(245,158,11,0.08)" }}>
                        <td colSpan={8} style={{ padding: "10px 12px", color: "#f5f0e0", textAlign: "right", fontWeight: "bold", letterSpacing: 1 }}>ENTERPRISE VALUE</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: A, fontWeight: "bold", fontSize: 14 }}>{`$${dcf.ev.toFixed(1)}M`}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ══ MONTE CARLO TAB ══════════════════════════════════════════════ */}
            {tab === "mc" && (
              <div>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, color: "#f0ebe0", fontFamily: "'Georgia', serif", marginBottom: 4 }}>Monte Carlo Simulation</div>
                    <div style={{ fontSize: 12, color: MUTED, fontFamily: "monospace" }}>8,000 simulations · Perturbing WACC, margin, growth, terminal rate</div>
                  </div>
                  <button onClick={runMonteCarlo} disabled={running}
                    style={{ padding: "10px 24px", background: running ? "rgba(245,158,11,0.1)" : "rgba(245,158,11,0.2)", border: `1px solid ${A}`, borderRadius: 6, color: A, fontFamily: "monospace", fontSize: 12, letterSpacing: 2, cursor: running ? "wait" : "pointer", transition: "all 0.2s" }}>
                    {running ? "RUNNING..." : ran ? "RE-RUN SIM" : "▶ RUN SIMULATION"}
                  </button>
                </div>

                {!ran && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, border: `1px dashed rgba(245,158,11,0.2)`, borderRadius: 12, color: MUTED, fontFamily: "monospace", fontSize: 13, letterSpacing: 1 }}>
                    Press "RUN SIMULATION" to generate 8,000 price paths
                  </div>
                )}

                {ran && mcResults.length > 0 && (
                  <div>
                    {/* Stats row */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 24 }}>
                      <StatBox label="Mean Price" value={fmtP(mcMean)} color={A} small />
                      <StatBox label="Std Dev" value={fmtP(mcStd)} color="#8a9bb0" small />
                      <StatBox label="5th Pct (Bear)" value={fmtP(mc5)} color={R} small />
                      <StatBox label="25th Pct" value={fmtP(mc25)} color="#f97316" small />
                      <StatBox label="75th Pct" value={fmtP(mc75)} color={G} small />
                      <StatBox label="95th Pct (Bull)" value={fmtP(mc95)} color="#34d399" small />
                    </div>

                    {/* Histogram */}
                    <Label>Price Distribution ({mcResults.length.toLocaleString()} valid simulations)</Label>
                    <div style={{ height: 280, marginBottom: 24 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={histogram} margin={{ top: 4, right: 20, bottom: 20, left: 10 }} barCategoryGap="2%">
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="x" tick={{ fill: "#5a6a7a", fontSize: 10, fontFamily: "monospace" }}
                            tickFormatter={v => `$${v.toFixed(0)}`} axisLine={false} tickLine={false}
                            interval="preserveStartEnd" />
                          <YAxis tick={{ fill: "#5a6a7a", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: "#0c1220", border: `1px solid ${BORDER}`, borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                            formatter={(v, n, p) => [`${v} paths`, "Count"]}
                            labelFormatter={v => `~$${parseFloat(v).toFixed(1)}`}
                            labelStyle={{ color: A }}
                          />
                          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                            {histogram.map((entry, i) => {
                              const x = entry.x;
                              let fill;
                              if (x < mc5) fill = "rgba(239,68,68,0.7)";
                              else if (x < mc25) fill = "rgba(249,115,22,0.65)";
                              else if (x < mc75) fill = "rgba(245,158,11,0.65)";
                              else if (x < mc95) fill = "rgba(52,211,153,0.65)";
                              else fill = "rgba(16,185,129,0.75)";
                              return <Cell key={i} fill={fill} />;
                            })}
                          </Bar>
                          {pps && <ReferenceLine x={histogram.reduce((best, h) => Math.abs(h.x - pps) < Math.abs(best.x - pps) ? h : best, histogram[0])?.x}
                            stroke="#60a5fa" strokeDasharray="4 4" strokeWidth={2} label={{ value: "Base", fill: "#60a5fa", fontSize: 10, fontFamily: "monospace" }} />}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Probability table */}
                    <Label>Probability Distribution</Label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {pps && [
                        [`P(price > $${(pps * 1.2).toFixed(0)}) — 20% upside`, mcResults.filter(v => v > pps * 1.2).length / mcResults.length],
                        [`P(price > $${(pps).toFixed(0)}) — at base`, mcResults.filter(v => v > pps).length / mcResults.length],
                        [`P(price > $${(pps * 0.9).toFixed(0)}) — 10% downside`, mcResults.filter(v => v > pps * 0.9).length / mcResults.length],
                        [`P(price < $${(pps * 0.8).toFixed(0)}) — 20% loss`, mcResults.filter(v => v < pps * 0.8).length / mcResults.length],
                      ].map(([label, prob]) => (
                        <div key={label} style={{ padding: "10px 14px", background: "rgba(255,255,255,0.03)", border: `1px solid rgba(255,255,255,0.07)`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#7a8a9a", fontFamily: "monospace" }}>{label}</span>
                          <span style={{ fontSize: 15, color: prob > 0.5 ? G : R, fontWeight: "bold", fontFamily: "'Georgia', serif" }}>{pct(prob * 100)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ══ SENSITIVITY TAB ══════════════════════════════════════════════ */}
            {tab === "sens" && dcf && (
              <div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 15, color: "#f0ebe0", fontFamily: "'Georgia', serif", marginBottom: 4 }}>Sensitivity Analysis</div>
                  <div style={{ fontSize: 12, color: MUTED, fontFamily: "monospace" }}>Price per Share · WACC (x-axis) vs. Terminal Growth Rate (y-axis)</div>
                </div>

                {/* Legend */}
                <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                  {[["rgba(16,185,129,0.35)", "> +20%"], ["rgba(16,185,129,0.18)", "+5% to +20%"], ["rgba(245,158,11,0.2)", "±5%"], ["rgba(239,68,68,0.18)", "−5% to −20%"], ["rgba(239,68,68,0.35)", "< −20%"]].map(([bg, label]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 14, height: 14, background: bg, borderRadius: 3, border: "1px solid rgba(255,255,255,0.1)" }} />
                      <span style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>{label}</span>
                    </div>
                  ))}
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12, minWidth: 500 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "10px 14px", color: "#5a6a7a", textAlign: "center", fontSize: 10, letterSpacing: 1, borderBottom: `1px solid ${BORDER}` }}>
                          TG \ WACC →
                        </th>
                        {waccRange.map(w => (
                          <th key={w} style={{ padding: "10px 14px", color: Math.abs(w - inp.wacc) < 0.01 ? A : "#5a6a7a", textAlign: "center", fontSize: 11, borderBottom: `1px solid ${BORDER}`, fontWeight: Math.abs(w - inp.wacc) < 0.01 ? "bold" : "normal" }}>
                            {w}%
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tgRange.map((tg, ri) => (
                        <tr key={tg}>
                          <td style={{ padding: "10px 14px", color: Math.abs(tg - inp.tGrowth) < 0.01 ? A : "#5a6a7a", textAlign: "center", borderRight: `1px solid ${BORDER}`, fontWeight: Math.abs(tg - inp.tGrowth) < 0.01 ? "bold" : "normal" }}>{tg}%</td>
                          {sensitivity[ri].map((val, ci) => {
                            const isBase = Math.abs(waccRange[ci] - inp.wacc) < 0.01 && Math.abs(tg - inp.tGrowth) < 0.01;
                            return (
                              <td key={ci} style={{
                                padding: "10px 14px",
                                textAlign: "center",
                                background: isBase ? "rgba(245,158,11,0.25)" : sensitivityColor(val),
                                color: isBase ? A : val && pps ? (val > pps ? G : val > pps * 0.85 ? "#e8e0d0" : R) : "#e8e0d0",
                                fontWeight: isBase ? "bold" : "normal",
                                border: isBase ? `1px solid ${A}` : "1px solid transparent",
                                borderRadius: isBase ? 4 : 0,
                              }}>
                                {val != null ? fmtP(val) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 24 }}>
                  <Label>Implied EV at Different WACC Scenarios</Label>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={waccRange.map(w => {
                        const r = calcDCF({ ...inp, wacc: w });
                        return { wacc: `${w}%`, ev: r ? parseFloat(r.ev.toFixed(1)) : null, price: r ? parseFloat((r.pricePerShare ?? 0).toFixed(2)) : null };
                      })} margin={{ top: 4, right: 20, bottom: 0, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="wacc" tick={{ fill: "#5a6a7a", fontSize: 11, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#5a6a7a", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                        <Tooltip
                          contentStyle={{ background: "#0c1220", border: `1px solid ${BORDER}`, borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                          formatter={(v, n) => [`$${v}${n === "ev" ? "M" : ""}`, n === "ev" ? "EV" : "Price/Share"]}
                          labelStyle={{ color: A }}
                        />
                        <Line type="monotone" dataKey="price" stroke={A} strokeWidth={2} dot={{ fill: A, r: 3 }} name="price" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
