
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Download, Plus, Trash2, Calculator, Info } from "lucide-react";
import jsPDF from "jspdf";

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function toMoney(n: number) { return !Number.isFinite(n) ? "$0.00" : n.toLocaleString(undefined, { style: "currency", currency: "USD" }); }
function parseNumber(value: string) { const n = Number(value.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; }
function formatInputMoney(value: string) { return value.replace(/[^0-9.,$]/g, ""); }
function formatInputPercent(value: string) { return value.replace(/[^0-9.]/g, ""); }
function isLeapYear(year: number) { return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0); }
function dateFromInput(v: string) { const [y,m,d] = v.split("-").map(Number); if(!y||!m||!d) return null; const dt = new Date(Date.UTC(y,m-1,d)); return Number.isFinite(dt.getTime()) ? dt : null; }
function ymd(dt: Date) { return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`; }
function addDaysUTC(dt: Date, days: number) { const copy = new Date(dt.getTime()); copy.setUTCDate(copy.getUTCDate()+days); return copy; }
function daysBetweenInclusiveUTC(start: Date, end: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  if (e < s) return 0;
  return Math.floor((e - s) / msPerDay) + 1;
}
function cx(...parts: Array<string | false | null | undefined>) { return parts.filter(Boolean).join(" "); }


type TransactionType = "mortgage" | "cash";

type TaxSettings = {
  priorYearTax: number;
  springPaid: boolean;
  springPaidAmount: number;
  fallPaid: boolean;
  fallPaidAmount: number;
  prorateThrough: "day_before" | "closing_date";
  force365: boolean;
};
type TaxBreakdown = {
  prorationEndYMD: string;
  daysInYear: number;
  dailyRate: number;
  daysAccrued: number;
  accruedThisYear: number;
  paidTotal: number;
  unpaidPriorYear: number;
  totalCredit: number;
};
function calcIndianaBuyerTaxCredit(closingUTC: Date, tax: TaxSettings): TaxBreakdown {
  const year = closingUTC.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const prorationEnd = tax.prorateThrough === "day_before" ? addDaysUTC(closingUTC, -1) : closingUTC;
  const daysInYear = tax.force365 ? 365 : isLeapYear(year) ? 366 : 365;
  const TY = Math.max(tax.priorYearTax || 0, 0);
  const dailyRate = TY / daysInYear;
  const daysAccrued = prorationEnd.getTime() < jan1.getTime() ? 0 : daysBetweenInclusiveUTC(jan1, prorationEnd);
  const accruedThisYear = dailyRate * daysAccrued;
  const paidTotal = (tax.springPaid ? Math.max(tax.springPaidAmount || 0, 0) : 0) + (tax.fallPaid ? Math.max(tax.fallPaidAmount || 0, 0) : 0);
  const unpaidPriorYear = Math.max(TY - paidTotal, 0);
  const totalCredit = unpaidPriorYear + accruedThisYear;
  return { prorationEndYMD: ymd(prorationEnd), daysInYear, dailyRate, daysAccrued, accruedThisYear, paidTotal, unpaidPriorYear, totalCredit };
}

type BuyerFeeItem = { label: string; amount: number };
type BuyerFeeSettings = {
  transactionType: TransactionType;
  includeClosingFee: boolean;
  includeClosingProcessing: boolean;
  includeTitleProcessing: boolean;
  includeCPLBorrower: boolean;
  includeLenderPolicy: boolean;
  includeCPLLender: boolean;
  includeLenderPolicy: boolean;
  includeSimplifile: boolean;
  includeTIEFF: boolean;
  includeRecordingFees: boolean;
  includeSalesDisclosureTransfer: boolean;
  endorsementCount: number;
};

const MORTGAGE_FEES = {
  closingFee: 225,
  closingProcessing: 100,
  cplBorrower: 50,
  cplLender: 0,
  lenderPolicy: 120,
  endorsementPer: 50,
  simplifile: 8.50,
  tieff: 5,
  recordingFees: 80,
  salesDisclosureTransfer: 30,
} as const;

const CASH_FEES = {
  closingFee: 125,
  closingProcessing: 100,
  cplBorrower: 25,
  simplifile: 4.25,
  recordingFees: 25,
  salesDisclosureTransfer: 30,
} as const;

function calcBuyerFees(s: BuyerFeeSettings): { items: BuyerFeeItem[]; total: number } {
  const items: BuyerFeeItem[] = [];

  if (s.transactionType === "mortgage") {
    if (s.includeClosingFee) items.push({ label: "Closing fee", amount: MORTGAGE_FEES.closingFee });
    if (s.includeClosingProcessing) items.push({ label: "Closing processing fee", amount: MORTGAGE_FEES.closingProcessing });
        if (s.includeCPLBorrower) items.push({ label: "CPL (buyer)", amount: MORTGAGE_FEES.cplBorrower });
    if (s.includeLenderPolicy) items.push({ label: "Loan policy", amount: MORTGAGE_FEES.lenderPolicy });
    const count = Math.max(0, Math.min(4, Math.floor(s.endorsementCount || 0)));
    if (count > 0) items.push({ label: `Endorsements (${count} @ $50)`, amount: count * MORTGAGE_FEES.endorsementPer });
    if (s.includeSimplifile) items.push({ label: "Simplifile e-recording", amount: MORTGAGE_FEES.simplifile });
    if (s.includeTIEFF) items.push({ label: "TIEFF", amount: MORTGAGE_FEES.tieff });
    if (s.includeRecordingFees) items.push({ label: "Recording fees", amount: MORTGAGE_FEES.recordingFees });
    if (s.includeSalesDisclosureTransfer) items.push({ label: "Sales disclosure / transfer", amount: MORTGAGE_FEES.salesDisclosureTransfer });
  } else {
    if (s.includeClosingFee) items.push({ label: "Closing fee", amount: CASH_FEES.closingFee });
    if (s.includeClosingProcessing) items.push({ label: "Closing processing fee", amount: CASH_FEES.closingProcessing });
        if (s.includeCPLBorrower) items.push({ label: "CPL (buyer)", amount: CASH_FEES.cplBorrower });
    if (s.includeSimplifile) items.push({ label: "Simplifile e-recording", amount: CASH_FEES.simplifile });
    if (s.includeRecordingFees) items.push({ label: "Recording fees", amount: CASH_FEES.recordingFees });
    if (s.includeSalesDisclosureTransfer) items.push({ label: "Sales disclosure / transfer", amount: CASH_FEES.salesDisclosureTransfer });
  }

  const total = round2(items.reduce((sum, item) => sum + item.amount, 0));
  return { items, total };
}

function buildPdf(opts: {
  transactionType: TransactionType;
  purchasePrice: number;
  closingYMD: string;
  downPayment: number;
  earnestMoney: number;
  otherBuyerCosts: { label: string; amount: number }[];
  buyerFees: BuyerFeeItem[];
  buyerFeesTotal: number;
  tax: TaxBreakdown;
  taxCreditRounded: number;
  cashToClose: number;
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const leftX = margin;
  const rightX = pageW - margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Advantage Title", margin, 64);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text("Buyer Net Sheet (Estimate)", margin, 86);
  doc.setDrawColor(0);
  doc.setLineWidth(0.75);
  doc.line(margin, 98, pageW - margin, 98);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Deal Summary", margin, 132);

  const otherTotal = opts.otherBuyerCosts.reduce((a, b) => a + b.amount, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const rows: Array<[string, string]> = [
    ["Transaction type", opts.transactionType === "mortgage" ? "Mortgage" : "Cash"],
    ["Purchase price", toMoney(opts.purchasePrice)],
    ["Closing date", opts.closingYMD],
    ["Down payment / funds needed to close", toMoney(opts.downPayment)],
    ["Earnest money", `(${toMoney(opts.earnestMoney)})`],
    ["Buyer title fees", toMoney(opts.buyerFeesTotal)],
    ["Other buyer costs", toMoney(otherTotal)],
    ["Tax proration credit", `(${toMoney(opts.taxCreditRounded)})`],
  ];

  let y = 156;
  for (const [k, v] of rows) {
    doc.text(k, leftX, y);
    doc.text(v, rightX, y, { align: "right" });
    y += 18;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Estimated Cash to Close", leftX, y + 10);
  doc.text(toMoney(opts.cashToClose), rightX, y + 10, { align: "right" });

  const tfTop = y + 44;
  doc.setFontSize(12);
  doc.text("Buyer Fees (Detail)", margin, tfTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  let tfy = tfTop + 18;
  for (const item of opts.buyerFees.slice(0, 14)) {
    doc.text(item.label, leftX, tfy);
    doc.text(toMoney(item.amount), rightX, tfy, { align: "right" });
    tfy += 16;
  }

  const taxTop = tfy + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Indiana Tax Proration Detail", margin, taxTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  const details: Array<[string, string]> = [
    ["Proration through", opts.tax.prorationEndYMD],
    ["Days accrued", String(opts.tax.daysAccrued)],
    ["Days in year", String(opts.tax.daysInYear)],
    ["Daily rate", toMoney(round2(opts.tax.dailyRate))],
    ["Accrued this year", toMoney(round2(opts.tax.accruedThisYear))],
    ["Unpaid prior-year", toMoney(round2(opts.tax.unpaidPriorYear))],
    ["Total tax credit", toMoney(opts.taxCreditRounded)],
  ];
  let yy = taxTop + 18;
  for (const [k, v] of details) {
    doc.text(k, leftX, yy);
    doc.text(v, rightX, yy, { align: "right" });
    yy += 16;
  }

  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(
    "Estimate only. Lender/prepaid costs are intentionally excluded in this version.",
    margin,
    732,
    { maxWidth: pageW - margin * 2 }
  );
  return doc;
}

export default function App() {
  const [purchasePriceInput, setPurchasePriceInput] = useState("0");
  const [closingInput, setClosingInput] = useState(() => {
    const now = new Date();
    const dt = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    return ymd(addDaysUTC(dt, 10));
  });
  const [transactionType, setTransactionType] = useState<TransactionType>("mortgage");
  const [downPaymentInput, setDownPaymentInput] = useState("0");
  const [downPaymentType, setDownPaymentType] = useState<"amount" | "percent">("amount");
  const [mortgageDownPaymentInput, setMortgageDownPaymentInput] = useState("0");
  const [earnestMoneyInput, setEarnestMoneyInput] = useState("0");

  const [otherBuyerCosts, setOtherBuyerCosts] = useState<Array<{ id: string; label: string; amountInput: string }>>([{ id: "c1", label: "Other buyer cost", amountInput: "0" }]);

  const [includeClosingFee, setIncludeClosingFee] = useState(true);
  const [includeClosingProcessing, setIncludeClosingProcessing] = useState(true);
  const [includeCPLBorrower,
    includeLenderPolicy, setIncludeCPLBorrower] = useState(true);
  const [includeCPLLender, setIncludeCPLLender] = useState(true);
  const [includeLenderPolicy, setIncludeLenderPolicy] = useState(true);
  const [includeSimplifile, setIncludeSimplifile] = useState(true);
  const [includeTIEFF, setIncludeTIEFF] = useState(true);
  const [includeRecordingFees, setIncludeRecordingFees] = useState(true);
  const [includeSalesDisclosureTransfer, setIncludeSalesDisclosureTransfer] = useState(true);
  const [endorsementCountInput, setEndorsementCountInput] = useState("2");

  const [priorYearTaxInput, setPriorYearTaxInput] = useState("0");
  const [springPaid, setSpringPaid] = useState(false);
  const [fallPaid, setFallPaid] = useState(false);
  const [springPaidInput, setSpringPaidInput] = useState("0");
  const [fallPaidInput, setFallPaidInput] = useState("0");
  const [prorateThrough, setProrateThrough] = useState<"day_before" | "closing_date">("day_before");
  const [force365, setForce365] = useState(false);

  const purchasePrice = useMemo(() => parseNumber(purchasePriceInput), [purchasePriceInput]);
  useEffect(() => {
    const target = transactionType === "cash" ? (purchasePriceInput || "0") : mortgageDownPaymentInput;
    if (downPaymentInput !== target) {
      setDownPaymentInput(target);
    }
  }, [transactionType, purchasePriceInput, mortgageDownPaymentInput, downPaymentInput]);
  const downPayment = useMemo(() => {
    if (transactionType === "mortgage" && downPaymentType === "percent") {
      return purchasePrice * (parseNumber(mortgageDownPaymentInput) / 100);
    }
    return parseNumber(downPaymentInput);
  }, [transactionType, downPaymentType, mortgageDownPaymentInput, downPaymentInput, purchasePrice]);
  const earnestMoney = useMemo(() => parseNumber(earnestMoneyInput), [earnestMoneyInput]);
  const priorYearTax = useMemo(() => parseNumber(priorYearTaxInput), [priorYearTaxInput]);
  const springPaidAmount = useMemo(() => parseNumber(springPaidInput), [springPaidInput]);
  const fallPaidAmount = useMemo(() => parseNumber(fallPaidInput), [fallPaidInput]);

  const closingUTC = useMemo(() => {
    const dt = dateFromInput(closingInput);
    return dt ?? new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  }, [closingInput]);

  const endorsementCount = useMemo(() => Math.max(0, Math.min(4, Math.floor(parseNumber(endorsementCountInput)))), [endorsementCountInput]);

  const buyerFeeCalc = useMemo(() => calcBuyerFees({
    transactionType,
    includeClosingFee,
    includeClosingProcessing,
    includeCPLBorrower,
    includeLenderPolicy,
    includeCPLLender,
    includeLenderPolicy,
    includeSimplifile,
    includeTIEFF,
    includeRecordingFees,
    includeSalesDisclosureTransfer,
    endorsementCount,
  }), [
    transactionType, includeClosingFee, includeClosingProcessing,
    includeCPLBorrower,
    includeLenderPolicy, includeCPLLender, includeLenderPolicy, includeSimplifile,
    includeTIEFF, includeRecordingFees, includeSalesDisclosureTransfer, endorsementCount,
  ]);

  const otherBuyerCostsTotal = useMemo(() => round2(otherBuyerCosts.reduce((sum, item) => sum + parseNumber(item.amountInput), 0)), [otherBuyerCosts]);

  const tax = useMemo(() => calcIndianaBuyerTaxCredit(closingUTC, {
    priorYearTax, springPaid, springPaidAmount, fallPaid, fallPaidAmount, prorateThrough, force365
  }), [closingUTC, priorYearTax, springPaid, springPaidAmount, fallPaid, fallPaidAmount, prorateThrough, force365]);

  const taxCreditRounded = useMemo(() => round2(tax.totalCredit), [tax.totalCredit]);
  const cashToClose = useMemo(() => round2(downPayment + buyerFeeCalc.total + otherBuyerCostsTotal - earnestMoney - taxCreditRounded), [downPayment, buyerFeeCalc.total, otherBuyerCostsTotal, earnestMoney, taxCreditRounded]);

  function addOtherBuyerCost() {
    setOtherBuyerCosts((prev) => [...prev, { id: `c${Math.random().toString(16).slice(2)}`, label: "Other buyer cost", amountInput: "0" }]);
  }
  function removeOtherBuyerCost(id: string) {
    setOtherBuyerCosts((prev) => prev.filter((x) => x.id !== id));
  }
  function downloadPdf() {
    const doc = buildPdf({
      transactionType,
      purchasePrice,
      closingYMD: ymd(closingUTC),
      downPayment,
      earnestMoney,
      otherBuyerCosts: otherBuyerCosts.map((c) => ({ label: c.label, amount: round2(parseNumber(c.amountInput)) })),
      buyerFees: buyerFeeCalc.items,
      buyerFeesTotal: buyerFeeCalc.total,
      tax,
      taxCreditRounded,
      cashToClose,
    });
    doc.save(`Advantage_Buyer_Net_Sheet_${ymd(closingUTC)}.pdf`);
  }

  const cardMotion = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <motion.div {...cardMotion} className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-neutral-900 text-white shadow-sm">
              <Calculator size={18} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Advantage Buyer Net Sheet</h1>
              <p className="text-sm text-neutral-600">Advantage Title buyer estimate with tax proration credit and buyer-side title fees.</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button onClick={downloadPdf} className="inline-flex items-center gap-2 rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800" type="button">
              <Download size={16} /> Download PDF
            </button>
            <p className="text-[11px] text-neutral-500 max-w-[360px] text-right">Estimate only. Lender/prepaid costs are intentionally excluded in this version.</p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <motion.div {...cardMotion} className="lg:col-span-2">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-lg font-semibold">1) Deal</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Closing date" hint="Used for tax proration credit">
                  <div className="relative">
                    <input type="date" value={closingInput} onChange={(e) => setClosingInput(e.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm outline-none focus:border-neutral-900" />
                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
                  </div>
                </Field>
                <Field label="Transaction type">
                  <div className="flex flex-wrap gap-2">
                    <Pill active={transactionType === "mortgage"} onClick={() => setTransactionType("mortgage")} label="Mortgage" />
                    <Pill active={transactionType === "cash"} onClick={() => setTransactionType("cash")} label="Cash" />
                  </div>
                </Field>
                <Field label={transactionType === "mortgage" ? "Down payment" : "Funds needed to close"}>
                  {transactionType === "mortgage" ? (
                    <div className="space-y-2">
                      <div className="inline-flex rounded-2xl bg-neutral-100 p-1">
                        <button
                          type="button"
                          onClick={() => {
                            const currentAmount = downPaymentType === "percent" ? String(round2(downPayment)) : mortgageDownPaymentInput;
                            setDownPaymentType("amount");
                            setMortgageDownPaymentInput(currentAmount);
                            setDownPaymentInput(currentAmount);
                          }}
                          className={cx("rounded-2xl px-3 py-2 text-sm", downPaymentType === "amount" ? "bg-white shadow-sm" : "text-neutral-600")}
                        >
                          $
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const pct = purchasePrice > 0 ? String(round2((downPayment / purchasePrice) * 100)) : "0";
                            setDownPaymentType("percent");
                            setMortgageDownPaymentInput(pct);
                            setDownPaymentInput(pct);
                          }}
                          className={cx("rounded-2xl px-3 py-2 text-sm", downPaymentType === "percent" ? "bg-white shadow-sm" : "text-neutral-600")}
                        >
                          %
                        </button>
                      </div>
                      <input
                        value={mortgageDownPaymentInput}
                        onChange={(e) => {
                          const next = downPaymentType === "percent" ? formatInputPercent(e.target.value) : formatInputMoney(e.target.value);
                          setMortgageDownPaymentInput(next);
                          setDownPaymentInput(next);
                        }}
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900"
                        inputMode="decimal"
                      />
                      {downPaymentType === "percent" && (
                        <div className="text-xs text-neutral-500">
                          Calculated down payment: {toMoney(round2(downPayment))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      value={downPaymentInput}
                      className="w-full rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-500 outline-none"
                      inputMode="decimal"
                      disabled
                    />
                  )}
                </Field>
                <Field label="Purchase price">
                  <input value={purchasePriceInput} onChange={(e) => setPurchasePriceInput(formatInputMoney(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
                </Field>
                <Field label="Earnest money">
                  <input value={earnestMoneyInput} onChange={(e) => setEarnestMoneyInput(formatInputMoney(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
                </Field>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Other buyer costs</h3>
                  <button onClick={addOtherBuyerCost} className="inline-flex items-center gap-2 rounded-2xl bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-200" type="button">
                    <Plus size={16} /> Add
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {otherBuyerCosts.map((c) => (
                    <div key={c.id} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                      <input value={c.label} onChange={(e) => setOtherBuyerCosts((prev) => prev.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x))} className="sm:col-span-3 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" placeholder="Label" />
                      <input value={c.amountInput} onChange={(e) => setOtherBuyerCosts((prev) => prev.map((x) => x.id === c.id ? { ...x, amountInput: formatInputMoney(e.target.value) } : x))} className="sm:col-span-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" placeholder="0" inputMode="decimal" />
                      <div className="sm:col-span-5 -mt-1 flex justify-end">
                        {otherBuyerCosts.length > 1 && (
                          <button onClick={() => removeOtherBuyerCost(c.id)} className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100" type="button">
                            <Trash2 size={14} /> Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-neutral-500">Other buyer costs total: {toMoney(otherBuyerCostsTotal)}</div>
              </div>

              <div className="mt-8 rounded-3xl bg-neutral-50 p-5 ring-1 ring-black/5">
                <h2 className="text-lg font-semibold">2) Advantage Buyer Title Fees</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  {transactionType === "mortgage"
                    ? "Mortgage transaction fees are active."
                    : "Cash transaction fees are active."}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="grid grid-cols-1 gap-2">
                      <CheckRow label={`Closing fee (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.closingFee : CASH_FEES.closingFee)})`} checked={includeClosingFee} onChange={setIncludeClosingFee} />
                      <CheckRow label={`Closing processing fee (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.closingProcessing : CASH_FEES.closingProcessing)})`} checked={includeClosingProcessing} onChange={setIncludeClosingProcessing} />
                      <CheckRow label={`CPL (buyer) (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.cplBorrower : CASH_FEES.cplBorrower)})`} checked={includeCPLBorrower} onChange={setIncludeCPLBorrower} />
                      {transactionType === "mortgage" && <CheckRow label={`Loan policy (${toMoney(MORTGAGE_FEES.lenderPolicy)})`} checked={includeLenderPolicy} onChange={setIncludeLenderPolicy} />}
                    </div>
                  </div>
                  <div>
                    <div className="grid grid-cols-1 gap-2">
                      <CheckRow label={`Simplifile e-recording (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.simplifile : CASH_FEES.simplifile)})`} checked={includeSimplifile} onChange={setIncludeSimplifile} />
                      {transactionType === "mortgage" && <CheckRow label="TIEFF" checked={includeTIEFF} onChange={setIncludeTIEFF} />}
                      <CheckRow label={`Recording fees (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.recordingFees : CASH_FEES.recordingFees)})`} checked={includeRecordingFees} onChange={setIncludeRecordingFees} />
                      <CheckRow label="Sales disclosure / transfer" checked={includeSalesDisclosureTransfer} onChange={setIncludeSalesDisclosureTransfer} />
                      {transactionType === "mortgage" && (
                        <Field
                          label={
                            <span className="inline-flex items-center gap-2">
                              Endorsement count
                              <span className="group relative inline-flex">
                                <span
                                  className="rounded-full p-1 text-neutral-600 hover:bg-neutral-100 cursor-help"
                                  aria-label="Endorsement info"
                                >
                                  <Info size={14} />
                                </span>
                                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-64 -translate-x-1/2 rounded-2xl bg-white p-3 text-xs text-neutral-600 shadow-lg ring-1 ring-black/5 group-hover:block">
                                  Endorsements are required by your lender. Lenders typically request at least 2 endorsements. The maximum allowable endorsements is 4. Ask your lender for the specific amount they will require.
                                </span>
                              </span>
                            </span> as any
                          }
                          hint="Default 2, max 4"
                        >
                          <div className="flex items-center gap-2">
                            <button type="button" className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm" onClick={() => setEndorsementCountInput(String(Math.max(0, endorsementCount - 1)))}>-</button>
                            <input value={endorsementCountInput} onChange={(e) => setEndorsementCountInput(formatInputPercent(e.target.value))} className="w-24 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900 text-center" inputMode="numeric" />
                            <button type="button" className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm" onClick={() => setEndorsementCountInput(String(Math.min(4, endorsementCount + 1)))}>+</button>
                          </div>
                        </Field>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2 rounded-3xl bg-white p-4 ring-1 ring-black/5">
                    <div className="text-sm font-semibold">Fee detail</div>
                    <div className="mt-2 space-y-2 text-sm">
                      {buyerFeeCalc.items.map((x) => <Detail key={x.label} k={x.label} v={toMoney(x.amount)} />)}
                      <div className="border-t border-neutral-200 pt-2">
                        <Detail k="Total buyer title fees" v={toMoney(buyerFeeCalc.total)} strong />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-3xl bg-neutral-50 p-5 ring-1 ring-black/5">
                <h2 className="text-lg font-semibold">3) Indiana Property Taxes (Buyer Credit)</h2>
                <p className="mt-1 text-sm text-neutral-600">This estimate treats Indiana taxes as paid in arrears and shows a buyer credit from seller.</p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Prior-year annual tax amount">
                    <input value={priorYearTaxInput} onChange={(e) => setPriorYearTaxInput(formatInputMoney(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
                  </Field>
                  <div>
                    <div className="text-sm font-medium">Prorate through</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Pill active={prorateThrough === "day_before"} onClick={() => setProrateThrough("day_before")} label="Day before closing" />
                      <Pill active={prorateThrough === "closing_date"} onClick={() => setProrateThrough("closing_date")} label="Closing date" />
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
                      <input type="checkbox" checked={force365} onChange={(e) => setForce365(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
                      Force 365-day year
                    </label>
                  </div>
                  <div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TaxInstallment title="Spring installment" subtitle="Typically due May 10" paid={springPaid} onPaid={setSpringPaid} amount={springPaidInput} onAmount={setSpringPaidInput} />
                    <TaxInstallment title="Fall installment" subtitle="Typically due Nov 10" paid={fallPaid} onPaid={setFallPaid} amount={fallPaidInput} onAmount={setFallPaidInput} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div {...cardMotion} className="lg:col-span-1">
            <div className="sticky top-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-lg font-semibold">4) Results</h2>
              <div className="mt-4 space-y-3">
                <Row k="Transaction type" v={transactionType === "mortgage" ? "Mortgage" : "Cash"} />
                <Row k="Purchase price" v={toMoney(round2(purchasePrice))} />
                <Row k={transactionType === "mortgage" ? "Down payment" : "Funds needed to close"} v={toMoney(round2(downPayment))} />
                <Row k="Earnest money" v={`(${toMoney(round2(earnestMoney))})`} />
                <Row k="Buyer title fees" v={toMoney(round2(buyerFeeCalc.total))} />
                <Row k="Other buyer costs" v={toMoney(round2(otherBuyerCostsTotal))} />
                <Row k="Tax proration credit" v={`(${toMoney(round2(taxCreditRounded))})`} />
              </div>
              <div className="mt-4 rounded-3xl bg-neutral-50 p-4 ring-1 ring-black/5">
                <div className="text-xs font-medium text-neutral-600">Estimated cash to close</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">{toMoney(cashToClose)}</div>
              </div>
              <div className="mt-6">
                <div className="text-sm font-semibold">Tax proration detail</div>
                <div className="mt-2 rounded-3xl bg-white p-4 ring-1 ring-black/5">
                  <div className="space-y-2 text-sm">
                    <Detail k="Proration through" v={tax.prorationEndYMD} />
                    <Detail k="Days accrued" v={String(tax.daysAccrued)} />
                    <Detail k="Days in year" v={String(tax.daysInYear)} />
                    <Detail k="Daily rate" v={toMoney(round2(tax.dailyRate))} />
                    <Detail k="Accrued this year" v={toMoney(round2(tax.accruedThisYear))} />
                    <Detail k="Unpaid prior-year" v={toMoney(round2(tax.unpaidPriorYear))} />
                    <div className="border-t border-neutral-200 pt-2">
                      <Detail k="Total tax credit" v={toMoney(round2(taxCreditRounded))} strong />
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={downloadPdf} className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800" type="button">
                <Download size={16} /> Download PDF
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-neutral-500">{hint}</div> : null}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cx("rounded-2xl px-3 py-2 text-sm ring-1 transition", active ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50")} type="button">
      {label}
    </button>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between gap-3 text-sm"><div className="text-neutral-700">{k}</div><div className="font-medium text-neutral-900">{v}</div></div>;
}
function Detail({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><div className="text-neutral-600">{k}</div><div className={(strong ? "font-semibold" : "font-medium") + " text-neutral-900"}>{v}</div></div>;
}
function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />{label}</label>;
}
function TaxInstallment({ title, subtitle, paid, onPaid, amount, onAmount }: { title: string; subtitle: string; paid: boolean; onPaid: (v: boolean) => void; amount: string; onAmount: (v: string) => void; }) {
  return (
    <div className="rounded-3xl bg-white p-4 ring-1 ring-black/5">
      <div className="flex items-center justify-between">
        <div><div className="text-sm font-semibold">{title}</div><div className="text-xs text-neutral-500">{subtitle}</div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={(e) => onPaid(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />Paid</label>
      </div>
      <div className="mt-3">
        <div className="text-xs font-medium text-neutral-600">Amount paid</div>
        <input value={amount} onChange={(e) => onAmount(formatInputMoney(e.target.value))} disabled={!paid} className={cx("mt-1 w-full rounded-2xl border px-4 py-3 text-sm outline-none", paid ? "border-neutral-200 bg-white focus:border-neutral-900" : "border-neutral-200 bg-neutral-100 text-neutral-400")} inputMode="decimal" />
      </div>
    </div>
  );
}
