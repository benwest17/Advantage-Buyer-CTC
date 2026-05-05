import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Calculator, Download, Info, Plus, Trash2 } from "lucide-react";
import jsPDF from "jspdf";

type TransactionType = "mortgage" | "cash";
type DownPaymentType = "amount" | "percent";
type TaxProrateThrough = "day_before" | "closing_date";

type FeeItem = {
  label: string;
  amount: number;
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

const MORTGAGE_FEES = {
  closingFee: 225,
  closingProcessing: 100,
  cplBuyer: 50,
  loanPolicy: 120,
  endorsementPer: 50,
  simplifile: 8.5,
  tieff: 5,
  recordingFees: 80,
  transferFee: 30,
} as const;

const CASH_FEES = {
  closingFee: 125,
  closingProcessing: 100,
  cplBuyer: 25,
  simplifile: 4.25,
  recordingFees: 25,
  transferFee: 30,
} as const;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toMoney(n: number) {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "$0.00";
}

function parseNumber(value: string) {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyInput(value: string) {
  return value.replace(/[^0-9.,$]/g, "");
}

function formatPercentInput(value: string) {
  return value.replace(/[^0-9.]/g, "");
}

function isLeapYear(year: number) {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function dateFromInput(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function ymd(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDaysUTC(date: Date, days: number) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function daysBetweenInclusiveUTC(start: Date, end: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  if (e < s) return 0;
  return Math.floor((e - s) / msPerDay) + 1;
}

function calcTaxCredit(args: {
  closingUTC: Date;
  priorYearTax: number;
  springPaid: boolean;
  springPaidAmount: number;
  fallPaid: boolean;
  fallPaidAmount: number;
  prorateThrough: TaxProrateThrough;
  force365: boolean;
}): TaxBreakdown {
  const year = args.closingUTC.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const prorationEnd = args.prorateThrough === "day_before" ? addDaysUTC(args.closingUTC, -1) : args.closingUTC;
  const daysInYear = args.force365 ? 365 : isLeapYear(year) ? 366 : 365;
  const dailyRate = Math.max(args.priorYearTax, 0) / daysInYear;
  const daysAccrued = prorationEnd.getTime() < jan1.getTime() ? 0 : daysBetweenInclusiveUTC(jan1, prorationEnd);
  const accruedThisYear = dailyRate * daysAccrued;
  const paidTotal =
    (args.springPaid ? Math.max(args.springPaidAmount, 0) : 0) +
    (args.fallPaid ? Math.max(args.fallPaidAmount, 0) : 0);
  const unpaidPriorYear = Math.max(args.priorYearTax - paidTotal, 0);

  return {
    prorationEndYMD: ymd(prorationEnd),
    daysInYear,
    dailyRate,
    daysAccrued,
    accruedThisYear,
    paidTotal,
    unpaidPriorYear,
    totalCredit: unpaidPriorYear + accruedThisYear,
  };
}

function calcFees(args: {
  transactionType: TransactionType;
  includeClosingFee: boolean;
  includeClosingProcessing: boolean;
  includeCPLBuyer: boolean;
  includeLoanPolicy: boolean;
  includeSimplifile: boolean;
  includeTIEFF: boolean;
  includeRecordingFees: boolean;
  includeTransferFee: boolean;
  endorsementCount: number;
}) {
  const items: FeeItem[] = [];

  if (args.transactionType === "mortgage") {
    if (args.includeClosingFee) items.push({ label: "Closing fee", amount: MORTGAGE_FEES.closingFee });
    if (args.includeClosingProcessing) items.push({ label: "Closing processing fee", amount: MORTGAGE_FEES.closingProcessing });
    if (args.includeCPLBuyer) items.push({ label: "CPL (buyer)", amount: MORTGAGE_FEES.cplBuyer });
    if (args.includeLoanPolicy) items.push({ label: "Loan policy", amount: MORTGAGE_FEES.loanPolicy });

    const count = Math.max(0, Math.min(4, Math.floor(args.endorsementCount || 0)));
    if (count > 0) items.push({ label: `Endorsements (${count} @ $50)`, amount: count * MORTGAGE_FEES.endorsementPer });

    if (args.includeSimplifile) items.push({ label: "Simplifile e-recording", amount: MORTGAGE_FEES.simplifile });
    if (args.includeTIEFF) items.push({ label: "TIEFF", amount: MORTGAGE_FEES.tieff });
    if (args.includeRecordingFees) items.push({ label: "Recording fees", amount: MORTGAGE_FEES.recordingFees });
    if (args.includeTransferFee) items.push({ label: "Sales disclosure / transfer", amount: MORTGAGE_FEES.transferFee });
  } else {
    if (args.includeClosingFee) items.push({ label: "Closing fee", amount: CASH_FEES.closingFee });
    if (args.includeClosingProcessing) items.push({ label: "Closing processing fee", amount: CASH_FEES.closingProcessing });
    if (args.includeCPLBuyer) items.push({ label: "CPL (buyer)", amount: CASH_FEES.cplBuyer });
    if (args.includeSimplifile) items.push({ label: "Simplifile e-recording", amount: CASH_FEES.simplifile });
    if (args.includeRecordingFees) items.push({ label: "Recording fees", amount: CASH_FEES.recordingFees });
    if (args.includeTransferFee) items.push({ label: "Sales disclosure / transfer", amount: CASH_FEES.transferFee });
  }

  return { items, total: round2(items.reduce((sum, item) => sum + item.amount, 0)) };
}

function buildPdf(args: {
  transactionType: TransactionType;
  purchasePrice: number;
  closingYMD: string;
  downPayment: number;
  earnestMoney: number;
  sellerCredit: number;
  fees: FeeItem[];
  feeTotal: number;
  otherCosts: FeeItem[];
  tax: TaxBreakdown;
  taxCredit: number;
  cashToClose: number;
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const rightX = pageW - margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Advantage Title", margin, 64);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text("Buyer Net Sheet (Estimate)", margin, 86);
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(
    "This is an estimate, all lender/financing costs specific to the borrower's individual loan product are not included.",
    margin,
    106,
    { maxWidth: pageW - margin * 2 }
  );
  doc.setTextColor(0);
  doc.line(margin, 124, rightX, 124);

  const otherTotal = args.otherCosts.reduce((sum, item) => sum + item.amount, 0);
  const rows: Array<[string, string]> = [
    ["Transaction type", args.transactionType === "mortgage" ? "Mortgage" : "Cash"],
    ["Purchase price", toMoney(args.purchasePrice)],
    ["Closing date", args.closingYMD],
    [args.transactionType === "mortgage" ? "Down payment" : "Funds needed to close", toMoney(args.downPayment)],
    ["Earnest money", `(${toMoney(args.earnestMoney)})`],
    ["Seller credit", `(${toMoney(args.sellerCredit)})`],
    ["Buyer title fees", toMoney(args.feeTotal)],
    ["Other buyer costs", toMoney(otherTotal)],
    ["Tax proration credit", `(${toMoney(args.taxCredit)})`],
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Deal Summary", margin, 152);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  let y = 176;
  rows.forEach(([label, value]) => {
    doc.text(label, margin, y);
    doc.text(value, rightX, y, { align: "right" });
    y += 18;
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Estimated Cash to Close", margin, y + 10);
  doc.text(toMoney(args.cashToClose), rightX, y + 10, { align: "right" });

  y += 46;
  doc.setFontSize(12);
  doc.text("Buyer Fees", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  y += 18;

  args.fees.forEach((item) => {
    doc.text(item.label, margin, y);
    doc.text(toMoney(item.amount), rightX, y, { align: "right" });
    y += 16;
  });

  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Tax Proration Detail", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  y += 18;

  const taxRows: Array<[string, string]> = [
    ["Proration through", args.tax.prorationEndYMD],
    ["Days accrued", String(args.tax.daysAccrued)],
    ["Days in year", String(args.tax.daysInYear)],
    ["Daily rate", toMoney(round2(args.tax.dailyRate))],
    ["Accrued this year", toMoney(round2(args.tax.accruedThisYear))],
    ["Unpaid prior-year", toMoney(round2(args.tax.unpaidPriorYear))],
    ["Total tax credit", toMoney(args.taxCredit)],
  ];

  taxRows.forEach(([label, value]) => {
    doc.text(label, margin, y);
    doc.text(value, rightX, y, { align: "right" });
    y += 16;
  });

  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text("Estimate only. Lender/prepaid costs are intentionally excluded in this version.", margin, 732, {
    maxWidth: pageW - margin * 2,
  });

  return doc;
}

export default function App() {
  const [transactionType, setTransactionType] = useState<TransactionType>("mortgage");
  const [purchasePriceInput, setPurchasePriceInput] = useState("0");
  const [downPaymentInput, setDownPaymentInput] = useState("0");
  const [downPaymentType, setDownPaymentType] = useState<DownPaymentType>("amount");
  const [mortgageDownPaymentInput, setMortgageDownPaymentInput] = useState("0");
  const [earnestMoneyInput, setEarnestMoneyInput] = useState("0");
  const [sellerCreditInput, setSellerCreditInput] = useState("0");
  const [closingInput, setClosingInput] = useState(() => ymd(addDaysUTC(new Date(), 10)));

  const [includeClosingFee, setIncludeClosingFee] = useState(true);
  const [includeClosingProcessing, setIncludeClosingProcessing] = useState(true);
  const [includeCPLBuyer, setIncludeCPLBuyer] = useState(true);
  const [includeLoanPolicy, setIncludeLoanPolicy] = useState(true);
  const [includeSimplifile, setIncludeSimplifile] = useState(true);
  const [includeTIEFF, setIncludeTIEFF] = useState(true);
  const [includeRecordingFees, setIncludeRecordingFees] = useState(true);
  const [includeTransferFee, setIncludeTransferFee] = useState(true);
  const [endorsementCountInput, setEndorsementCountInput] = useState("2");

  const [otherCosts, setOtherCosts] = useState<Array<{ id: string; label: string; amountInput: string }>>([
    { id: "1", label: "Other buyer cost", amountInput: "0" },
  ]);

  const [priorYearTaxInput, setPriorYearTaxInput] = useState("0");
  const [springPaid, setSpringPaid] = useState(false);
  const [fallPaid, setFallPaid] = useState(false);
  const [springPaidInput, setSpringPaidInput] = useState("0");
  const [fallPaidInput, setFallPaidInput] = useState("0");
  const [prorateThrough, setProrateThrough] = useState<TaxProrateThrough>("day_before");
  const [force365, setForce365] = useState(false);

  const purchasePrice = useMemo(() => parseNumber(purchasePriceInput), [purchasePriceInput]);

  useEffect(() => {
    const target = transactionType === "cash" ? purchasePriceInput || "0" : mortgageDownPaymentInput;
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
  const sellerCredit = useMemo(() => parseNumber(sellerCreditInput), [sellerCreditInput]);
  const closingUTC = useMemo(() => dateFromInput(closingInput) ?? new Date(), [closingInput]);
  const endorsementCount = useMemo(() => Math.max(0, Math.min(4, Math.floor(parseNumber(endorsementCountInput)))), [endorsementCountInput]);

  const feeCalc = useMemo(
    () =>
      calcFees({
        transactionType,
        includeClosingFee,
        includeClosingProcessing,
        includeCPLBuyer,
        includeLoanPolicy,
        includeSimplifile,
        includeTIEFF,
        includeRecordingFees,
        includeTransferFee,
        endorsementCount,
      }),
    [
      transactionType,
      includeClosingFee,
      includeClosingProcessing,
      includeCPLBuyer,
      includeLoanPolicy,
      includeSimplifile,
      includeTIEFF,
      includeRecordingFees,
      includeTransferFee,
      endorsementCount,
    ]
  );

  const otherCostItems = useMemo(
    () => otherCosts.map((item) => ({ label: item.label, amount: round2(parseNumber(item.amountInput)) })),
    [otherCosts]
  );

  const otherTotal = useMemo(() => otherCostItems.reduce((sum, item) => sum + item.amount, 0), [otherCostItems]);

  const tax = useMemo(
    () =>
      calcTaxCredit({
        closingUTC,
        priorYearTax: parseNumber(priorYearTaxInput),
        springPaid,
        springPaidAmount: parseNumber(springPaidInput),
        fallPaid,
        fallPaidAmount: parseNumber(fallPaidInput),
        prorateThrough,
        force365,
      }),
    [closingUTC, priorYearTaxInput, springPaid, springPaidInput, fallPaid, fallPaidInput, prorateThrough, force365]
  );

  const taxCredit = useMemo(() => round2(tax.totalCredit), [tax.totalCredit]);
  const cashToClose = useMemo(
    () => round2(downPayment + feeCalc.total + otherTotal - earnestMoney - sellerCredit - taxCredit),
    [downPayment, feeCalc.total, otherTotal, earnestMoney, sellerCredit, taxCredit]
  );

  function addOtherCost() {
    setOtherCosts((prev) => [...prev, { id: Math.random().toString(16), label: "Other buyer cost", amountInput: "0" }]);
  }

  function removeOtherCost(id: string) {
    setOtherCosts((prev) => prev.filter((item) => item.id !== id));
  }

  function downloadPdf() {
    const doc = buildPdf({
      transactionType,
      purchasePrice,
      closingYMD: ymd(closingUTC),
      downPayment,
      earnestMoney,
      sellerCredit,
      fees: feeCalc.items,
      feeTotal: feeCalc.total,
      otherCosts: otherCostItems,
      tax,
      taxCredit,
      cashToClose,
    });
    doc.save(`Advantage_Buyer_Net_Sheet_${ymd(closingUTC)}.pdf`);
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-neutral-900 text-white shadow-sm">
              <Calculator size={18} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Advantage Buyer Net Sheet</h1>
              <p className="text-sm text-neutral-600">Advantage Title buyer estimate with buyer-side title fees and Indiana tax credit.</p>
            </div>
          </div>
          <button onClick={downloadPdf} className="inline-flex items-center gap-2 rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800" type="button">
            <Download size={16} /> Download PDF
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="text-lg font-semibold">1) Deal</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Transaction type">
                <div className="flex flex-wrap gap-2">
                  <Pill active={transactionType === "mortgage"} onClick={() => setTransactionType("mortgage")} label="Mortgage" />
                  <Pill active={transactionType === "cash"} onClick={() => setTransactionType("cash")} label="Cash" />
                </div>
              </Field>

              <Field label="Closing date">
                <div className="relative">
                  <input type="date" value={closingInput} onChange={(e) => setClosingInput(e.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm outline-none focus:border-neutral-900" />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
                </div>
              </Field>

              <Field label="Purchase price">
                <input value={purchasePriceInput} onChange={(e) => setPurchasePriceInput(formatMoneyInput(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
              </Field>

              <Field label={transactionType === "mortgage" ? "Down payment" : "Funds needed to close"}>
                {transactionType === "mortgage" ? (
                  <div className="space-y-2">
                    <div className="inline-flex rounded-2xl bg-neutral-100 p-1">
                      <button type="button" onClick={() => {
                        const currentAmount = downPaymentType === "percent" ? String(round2(downPayment)) : mortgageDownPaymentInput;
                        setDownPaymentType("amount");
                        setMortgageDownPaymentInput(currentAmount);
                        setDownPaymentInput(currentAmount);
                      }} className={cx("rounded-2xl px-3 py-2 text-sm", downPaymentType === "amount" ? "bg-white shadow-sm" : "text-neutral-600")}>$</button>
                      <button type="button" onClick={() => {
                        const pct = purchasePrice > 0 ? String(round2((downPayment / purchasePrice) * 100)) : "0";
                        setDownPaymentType("percent");
                        setMortgageDownPaymentInput(pct);
                        setDownPaymentInput(pct);
                      }} className={cx("rounded-2xl px-3 py-2 text-sm", downPaymentType === "percent" ? "bg-white shadow-sm" : "text-neutral-600")}>%</button>
                    </div>
                    <input value={mortgageDownPaymentInput} onChange={(e) => {
                      const next = downPaymentType === "percent" ? formatPercentInput(e.target.value) : formatMoneyInput(e.target.value);
                      setMortgageDownPaymentInput(next);
                      setDownPaymentInput(next);
                    }} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
                    {downPaymentType === "percent" && <div className="text-xs text-neutral-500">Calculated down payment: {toMoney(round2(downPayment))}</div>}
                  </div>
                ) : (
                  <input value={downPaymentInput} disabled className="w-full rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-3 text-sm text-neutral-500 outline-none" />
                )}
              </Field>

              <Field label="Earnest money">
                <input value={earnestMoneyInput} onChange={(e) => setEarnestMoneyInput(formatMoneyInput(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
              </Field>

              <Field label="Seller credit">
                <input value={sellerCreditInput} onChange={(e) => setSellerCreditInput(formatMoneyInput(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-900" inputMode="decimal" />
              </Field>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Other buyer costs</h3>
                <button onClick={addOtherCost} className="inline-flex items-center gap-2 rounded-2xl bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200" type="button"><Plus size={16} /> Add</button>
              </div>
              <div className="mt-3 space-y-3">
                {otherCosts.map((item) => (
                  <div key={item.id} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                    <input value={item.label} onChange={(e) => setOtherCosts((prev) => prev.map((x) => (x.id === item.id ? { ...x, label: e.target.value } : x)))} className="sm:col-span-3 rounded-2xl border border-neutral-200 px-4 py-3 text-sm" />
                    <input value={item.amountInput} onChange={(e) => setOtherCosts((prev) => prev.map((x) => (x.id === item.id ? { ...x, amountInput: formatMoneyInput(e.target.value) } : x)))} className="sm:col-span-2 rounded-2xl border border-neutral-200 px-4 py-3 text-sm" />
                    {otherCosts.length > 1 && <button onClick={() => removeOtherCost(item.id)} className="sm:col-span-5 ml-auto inline-flex items-center gap-2 text-xs text-neutral-600" type="button"><Trash2 size={14} /> Remove</button>}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-3xl bg-neutral-50 p-5 ring-1 ring-black/5">
              <h2 className="text-lg font-semibold">2) Advantage Buyer Title Fees</h2>
              <p className="mt-1 text-sm text-neutral-600">{transactionType === "mortgage" ? "Mortgage transaction fees are active." : "Cash transaction fees are active."}</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid grid-cols-1 gap-2">
                  <CheckRow label={`Closing fee (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.closingFee : CASH_FEES.closingFee)})`} checked={includeClosingFee} onChange={setIncludeClosingFee} />
                  <CheckRow label={`Closing processing fee (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.closingProcessing : CASH_FEES.closingProcessing)})`} checked={includeClosingProcessing} onChange={setIncludeClosingProcessing} />
                  <CheckRow label={`CPL (buyer) (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.cplBuyer : CASH_FEES.cplBuyer)})`} checked={includeCPLBuyer} onChange={setIncludeCPLBuyer} />
                  {transactionType === "mortgage" && <CheckRow label={`Loan policy (${toMoney(MORTGAGE_FEES.loanPolicy)})`} checked={includeLoanPolicy} onChange={setIncludeLoanPolicy} />}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <CheckRow label={`Simplifile e-recording (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.simplifile : CASH_FEES.simplifile)})`} checked={includeSimplifile} onChange={setIncludeSimplifile} />
                  {transactionType === "mortgage" && <CheckRow label={`TIEFF (${toMoney(MORTGAGE_FEES.tieff)})`} checked={includeTIEFF} onChange={setIncludeTIEFF} />}
                  <CheckRow label={`Recording fees (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.recordingFees : CASH_FEES.recordingFees)})`} checked={includeRecordingFees} onChange={setIncludeRecordingFees} />
                  <CheckRow label={`Sales disclosure / transfer (${toMoney(transactionType === "mortgage" ? MORTGAGE_FEES.transferFee : CASH_FEES.transferFee)})`} checked={includeTransferFee} onChange={setIncludeTransferFee} />
                  {transactionType === "mortgage" && (
                    <Field label={<span className="inline-flex items-center gap-2">Endorsement count <span className="group relative inline-flex"><Info size={14} className="cursor-help text-neutral-600" /><span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-64 -translate-x-1/2 rounded-2xl bg-white p-3 text-xs text-neutral-600 shadow-lg ring-1 ring-black/5 group-hover:block">Endorsements are required by your lender. Lenders typically request at least 2 endorsements. The maximum allowable endorsements is 4. Ask your lender for the specific amount they will require.</span></span></span>} hint="Default 2, max 4">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setEndorsementCountInput(String(Math.max(0, endorsementCount - 1)))} className="rounded-2xl bg-neutral-100 px-3 py-2">-</button>
                        <input value={endorsementCountInput} onChange={(e) => setEndorsementCountInput(formatPercentInput(e.target.value))} className="w-24 rounded-2xl border border-neutral-200 px-4 py-3 text-center text-sm" />
                        <button type="button" onClick={() => setEndorsementCountInput(String(Math.min(4, endorsementCount + 1)))} className="rounded-2xl bg-neutral-100 px-3 py-2">+</button>
                      </div>
                    </Field>
                  )}
                </div>
                <div className="sm:col-span-2 rounded-3xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-sm font-semibold">Fee detail</div>
                  <div className="mt-2 space-y-2 text-sm">
                    {feeCalc.items.map((item) => <Detail key={item.label} k={item.label} v={toMoney(item.amount)} />)}
                    <div className="border-t border-neutral-200 pt-2"><Detail k="Total buyer title fees" v={toMoney(feeCalc.total)} strong /></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-3xl bg-neutral-50 p-5 ring-1 ring-black/5">
              <h2 className="text-lg font-semibold">3) Indiana Property Taxes (Buyer Credit)</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Prior-year annual tax amount">
                  <input value={priorYearTaxInput} onChange={(e) => setPriorYearTaxInput(formatMoneyInput(e.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm" />
                </Field>
                <div>
                  <div className="text-sm font-medium">Prorate through</div>
                  <div className="mt-2 flex gap-2">
                    <Pill active={prorateThrough === "day_before"} onClick={() => setProrateThrough("day_before")} label="Day before closing" />
                    <Pill active={prorateThrough === "closing_date"} onClick={() => setProrateThrough("closing_date")} label="Closing date" />
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={force365} onChange={(e) => setForce365(e.target.checked)} /> Force 365-day year</label>
                </div>
                <TaxInstallment title="Spring installment" subtitle="Typically due May 10" paid={springPaid} onPaid={setSpringPaid} amount={springPaidInput} onAmount={setSpringPaidInput} />
                <TaxInstallment title="Fall installment" subtitle="Typically due Nov 10" paid={fallPaid} onPaid={setFallPaid} amount={fallPaidInput} onAmount={setFallPaidInput} />
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 lg:sticky lg:top-6 lg:h-fit">
            <h2 className="text-lg font-semibold">4) Results</h2>
            <div className="mt-4 space-y-3">
              <Row k="Transaction type" v={transactionType === "mortgage" ? "Mortgage" : "Cash"} />
              <Row k="Purchase price" v={toMoney(purchasePrice)} />
              <Row k={transactionType === "mortgage" ? "Down payment" : "Funds needed to close"} v={toMoney(downPayment)} />
              <Row k="Earnest money" v={`(${toMoney(earnestMoney)})`} />
              <Row k="Seller credit" v={`(${toMoney(sellerCredit)})`} />
              <Row k="Buyer title fees" v={toMoney(feeCalc.total)} />
              <Row k="Other buyer costs" v={toMoney(otherTotal)} />
              <Row k="Tax proration credit" v={`(${toMoney(taxCredit)})`} />
            </div>
            <div className="mt-4 rounded-3xl bg-neutral-50 p-4 ring-1 ring-black/5">
              <div className="text-xs font-medium text-neutral-600">Estimated cash to close</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{toMoney(cashToClose)}</div>
            </div>
            <button onClick={downloadPdf} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800" type="button">
              <Download size={16} /> Download PDF
            </button>
          </div>
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
        {hint && <div className="text-xs text-neutral-500">{hint}</div>}
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

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function Detail({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-neutral-600">{k}</div>
      <div className={(strong ? "font-semibold" : "font-medium") + " text-neutral-900"}>{v}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="text-neutral-700">{k}</div>
      <div className="font-medium text-neutral-900">{v}</div>
    </div>
  );
}

function TaxInstallment({
  title,
  subtitle,
  paid,
  onPaid,
  amount,
  onAmount,
}: {
  title: string;
  subtitle: string;
  paid: boolean;
  onPaid: (v: boolean) => void;
  amount: string;
  onAmount: (v: string) => void;
}) {
  return (
    <div className="rounded-3xl bg-white p-4 ring-1 ring-black/5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-neutral-500">{subtitle}</div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={(e) => onPaid(e.target.checked)} /> Paid</label>
      </div>
      <input value={amount} onChange={(e) => onAmount(formatMoneyInput(e.target.value))} disabled={!paid} className={cx("mt-3 w-full rounded-2xl border px-4 py-3 text-sm", paid ? "bg-white" : "bg-neutral-100 text-neutral-400")} />
    </div>
  );
}
