// Motor Financeiro Renda Fracionada v3 (ES Module — 100% compatível offline no Safari/iOS/Desktop)

export const TagType = Object.freeze({
  FIXED: 'FIXED',
  VARIABLE: 'VARIABLE',
  UNEXPECTED: 'UNEXPECTED',
  CREDIT_CARD: 'CREDIT_CARD'
});

export const TAG_TYPE_LABELS = Object.freeze({
  FIXED: 'Fixo',
  VARIABLE: 'Variável',
  UNEXPECTED: 'Imprevisto',
  CREDIT_CARD: 'Cartão de Crédito'
});

export const PaymentMethod = Object.freeze({
  CASH_PIX_DEBIT: 'CASH_PIX_DEBIT',
  CREDIT_CARD: 'CREDIT_CARD'
});

export const FundingSource = Object.freeze({
  BALANCE: 'BALANCE',
  RESERVE: 'RESERVE',
  GOAL: 'GOAL'
});

export const ExpenseSource = Object.freeze({
  MANUAL: 'MANUAL',
  FIXED_BILL: 'FIXED_BILL',
  GOAL_PURCHASE: 'GOAL_PURCHASE'
});

export const ReserveMovementType = Object.freeze({
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL'
});

export const BillStatus = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID'
});

export const ReserveTargetMode = Object.freeze({
  PERCENT: 'PERCENT',
  FIXED: 'FIXED'
});

export const TAG_COLOR_PALETTE = [
  '#16A34A', '#2563EB', '#F59E0B', '#DC2626',
  '#7C3AED', '#0D9488', '#DB2777', '#EA580C',
  '#0284C7', '#4F46E5'
];

// O app inicia 100% em branco — todas as etiquetas e classificações de projetos são criadas pelo próprio usuário.
export const DEFAULT_TAGS = [];
export const DEFAULT_EXTRA_CATEGORIES = [];

export const DEFAULT_SETTINGS = {
  monthlyIncomeGoal: 0,
  reserveTargetMode: ReserveTargetMode.PERCENT,
  reserveTargetValue: 0,
  creditCardDueDay: 10,
  anomalySigmaThreshold: 1.5,
  extraordinaryMonthlyCap: 0
};

export function createEmptySnapshot() {
  return {
    tags: [],
    incomes: [],
    expenses: [],
    reserveMovements: [],
    goals: [],
    goalContributions: [],
    fixedBills: [],
    billOccurrences: [],
    creditCardInvoices: [],
    settings: { ...DEFAULT_SETTINGS },
    plannedIncomes: [],
    extraExpenses: [],
    extraRecurrings: [],
    extraCategories: [],
    nextId: 100
  };
}

// ============================================================
// Datas (YYYY-MM / dd/MM/aaaa em fuso horário local)
// ============================================================

const MONTHS_PT_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const MONTHS_PT_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function currentYearMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function parseYearMonth(ymStr) {
  const [y, m] = String(ymStr).split('-').map(Number);
  return { year: y, month: m };
}

export function stepYearMonth(ymStr, deltaMonths) {
  const { year, month } = parseYearMonth(ymStr);
  const d = new Date(year, month - 1 + deltaMonths, 1, 12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysInYearMonth(ymStr) {
  const { year, month } = parseYearMonth(ymStr);
  return new Date(year, month, 0).getDate();
}

export function monthBoundsMillis(ymStr) {
  const { year, month } = parseYearMonth(ymStr);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month, 1, 0, 0, 0, 0).getTime() - 1;
  return [start, end];
}

export function localDateAtNoonMillis(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

export function dueDateMillisForMonth(ymStr, dueDay) {
  const { year, month } = parseYearMonth(ymStr);
  const maxDay = daysInYearMonth(ymStr);
  const safeDay = Math.max(1, Math.min(Number(dueDay) || 1, maxDay));
  return localDateAtNoonMillis(year, month, safeDay);
}

export function formatYearMonthBr(ymStr) {
  const { year, month } = parseYearMonth(ymStr);
  return `${MONTHS_PT_FULL[month - 1]} de ${year}`;
}

export function formatYearMonthShortBr(ymStr) {
  const { year, month } = parseYearMonth(ymStr);
  return `${MONTHS_PT_SHORT[month - 1]}/${String(year % 100).padStart(2, '0')}`;
}

export function formatDateBr(millis) {
  const d = new Date(millis);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateTimeBr(millis) {
  const d = new Date(millis);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${formatDateBr(millis)} ${hh}:${min}`;
}

export function toIsoInputDate(millis) {
  const d = new Date(millis);
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseBrOrIsoDateMillis(input, referenceMillis = Date.now()) {
  const trimmed = String(input || '').trim();
  let day, month, year;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    [year, month, day] = trimmed.split('-').map(Number);
  } else {
    const parts = trimmed.split('/');
    if (parts.length !== 3) return null;
    day = Number(parts[0]);
    month = Number(parts[1]);
    year = Number(parts[2]);
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  const ref = new Date(referenceMillis);
  if (ref.getFullYear() === year && ref.getMonth() === month - 1 && ref.getDate() === day) {
    return referenceMillis;
  }
  return check.getTime();
}

export function daysBetweenTodayAnd(targetMillis, today = new Date()) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  const t = new Date(targetMillis);
  const t1 = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12, 0, 0, 0);
  return Math.round((t1.getTime() - t0.getTime()) / 86400000);
}

// ============================================================
// Formatadores Brasileiros
// ============================================================

function formatDecimalPtBr(value, decimals, useThousands) {
  const safe = Number.isFinite(value) ? value : 0;
  const factor = Math.pow(10, decimals);
  const scaled = Math.round(Math.abs(safe) * factor);
  const sign = safe < 0 && scaled !== 0 ? '-' : '';
  if (decimals <= 0) {
    const s = String(scaled);
    return sign + (useThousands ? s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : s);
  }
  const intPart = Math.floor(scaled / factor);
  const fracPart = String(scaled % factor).padStart(decimals, '0');
  const grouped = useThousands
    ? String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(intPart);
  return `${sign}${grouped},${fracPart}`;
}

export function formatBrl(value) {
  const safe = !Number.isFinite(value) || Math.abs(value) < 0.005 ? 0 : value;
  const formattedAbs = formatDecimalPtBr(Math.abs(safe), 2, true);
  return safe < 0 ? `-R$ ${formattedAbs}` : `R$ ${formattedAbs}`;
}

export function formatCompactBrl(value) {
  const absVal = Math.abs(Number(value) || 0);
  const sign = value < 0 ? '-' : '';
  if (absVal >= 1_000_000) return `${sign}R$ ${formatDecimalPtBr(absVal / 1_000_000, 1, false)}M`;
  if (absVal >= 1_000) return `${sign}R$ ${formatDecimalPtBr(absVal / 1_000, 1, false)}k`;
  return formatBrl(value);
}

export function formatPercent(fraction, decimals = 0) {
  return `${formatDecimalPtBr((Number(fraction) || 0) * 100, decimals, false)}%`;
}

export function formatInputNumber(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) return '';
  return formatDecimalPtBr(value, 2, false);
}

export function parseBrlInput(raw) {
  const cleaned = String(raw ?? '')
    .replace(/r\$/gi, '')
    .replace(/\u00A0/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return null;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;
  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    normalized = cleaned.replace(/\./g, '');
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

// ============================================================
// Estatística e Semanas
// ============================================================

export function summarizeStats(values) {
  if (!values || values.length === 0) {
    return { count: 0, mean: 0, stdDev: 0 };
  }
  const count = values.length;
  const mean = values.reduce((acc, v) => acc + v, 0) / count;
  if (count < 2) {
    return { count, mean, stdDev: 0 };
  }
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (count - 1);
  return { count, mean, stdDev: Math.sqrt(variance) };
}

export function isAnomalous(currentValue, stats, sigmaThreshold) {
  if (!stats || stats.count < 2) return false;
  if (stats.stdDev <= 0.01) {
    return currentValue > stats.mean * 1.25;
  }
  return currentValue > stats.mean + sigmaThreshold * stats.stdDev;
}

export function weeksInMonth(ymStr) {
  const { year, month } = parseYearMonth(ymStr);
  const totalDays = daysInYearMonth(ymStr);
  const weeks = [];
  let startDay = 1;
  let idx = 1;
  while (startDay <= totalDays) {
    const endDay = Math.min(startDay + 6, totalDays);
    const startMillis = new Date(year, month - 1, startDay, 0, 0, 0, 0).getTime();
    const endMillis = new Date(year, month - 1, endDay, 23, 59, 59, 999).getTime();
    weeks.push({
      weekNumber: idx,
      startDay,
      endDay,
      dayCount: endDay - startDay + 1,
      label: `Semana ${idx} (${startDay}–${endDay})`,
      startMillis,
      endMillis
    });
    startDay = endDay + 1;
    idx += 1;
  }
  return weeks;
}

export function activeWeekWindow(ymStr, today = new Date()) {
  const weeks = weeksInMonth(ymStr);
  const { year, month } = parseYearMonth(ymStr);
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  if (ty === year && tm === month) {
    const d = today.getDate();
    return weeks.find((w) => d >= w.startDay && d <= w.endDay) || weeks[0];
  }
  if (ty > year || (ty === year && tm > month)) {
    return weeks[weeks.length - 1];
  }
  return weeks[0];
}

export function suggestReserveFromIncome(incomeAmount, settings, depositedReserveInMonth) {
  if (incomeAmount <= 0) return 0;
  const monthlyTarget = Math.max(
    0,
    settings.reserveTargetMode === ReserveTargetMode.PERCENT
      ? settings.monthlyIncomeGoal * (settings.reserveTargetValue / 100)
      : settings.reserveTargetValue
  );
  const remainingTarget = Math.max(0, monthlyTarget - depositedReserveInMonth);
  if (remainingTarget <= 0) return 0;
  const ratio = settings.monthlyIncomeGoal > 0
    ? Math.max(0, Math.min(1, monthlyTarget / settings.monthlyIncomeGoal))
    : 0.10;
  return Math.min(remainingTarget, incomeAmount * ratio);
}

// ============================================================
// Motor Financeiro Completo (Paridade 1:1 com BudgetEngine.kt)
// ============================================================

export function computeOverview(snapshot, selectedMonth, today = new Date()) {
  const settings = { ...DEFAULT_SETTINGS, ...(snapshot.settings || {}) };
  const [monthStart, monthEnd] = monthBoundsMillis(selectedMonth);
  const tagMap = new Map();
  for (const t of snapshot.tags || []) {
    tagMap.set(t.id, t);
  }

  const incomes = snapshot.incomes || [];
  const expenses = snapshot.expenses || [];
  const extraExpenses = snapshot.extraExpenses || [];
  const reserveMovements = snapshot.reserveMovements || [];
  const goals = snapshot.goals || [];
  const goalContributions = snapshot.goalContributions || [];
  const fixedBills = snapshot.fixedBills || [];
  const billOccurrences = snapshot.billOccurrences || [];
  const creditCardInvoices = snapshot.creditCardInvoices || [];
  const plannedIncomes = snapshot.plannedIncomes || [];
  const extraRecurrings = snapshot.extraRecurrings || [];
  const extraCategories = snapshot.extraCategories || [];
  const activeExtraCategories = extraCategories.filter((c) => !c.isArchived);
  const extraCatMap = new Map();
  for (const c of extraCategories) {
    extraCatMap.set(c.id, c);
  }

  // 1. Saldo Real em Mãos
  let totalIncomeUntilMonthEnd = 0;
  for (const inc of incomes) {
    if (inc.receivedAt <= monthEnd) totalIncomeUntilMonthEnd += inc.amount;
  }

  let cashFromBalanceUntilMonthEnd = 0;
  let cashFromReserveUntilMonthEnd = 0;
  let cashFromGoalUntilMonthEnd = 0;
  for (const exp of expenses) {
    if (exp.spentAt <= monthEnd && exp.paymentMethod === PaymentMethod.CASH_PIX_DEBIT) {
      if (exp.fundingSource === FundingSource.BALANCE) cashFromBalanceUntilMonthEnd += exp.amount;
      else if (exp.fundingSource === FundingSource.RESERVE) cashFromReserveUntilMonthEnd += exp.amount;
      else if (exp.fundingSource === FundingSource.GOAL) cashFromGoalUntilMonthEnd += exp.amount;
    }
  }

  let extraCashFromBalanceUntilMonthEnd = 0;
  for (const ext of extraExpenses) {
    if (ext.spentAt <= monthEnd && ext.paymentMethod === PaymentMethod.CASH_PIX_DEBIT) {
      if (ext.fundingSource === FundingSource.BALANCE) extraCashFromBalanceUntilMonthEnd += ext.amount;
      else if (ext.fundingSource === FundingSource.RESERVE) cashFromReserveUntilMonthEnd += ext.amount;
    }
  }

  let paidInvoicesUntilMonthEnd = 0;
  for (const inv of creditCardInvoices) {
    if (inv.isPaid && inv.yearMonth <= selectedMonth) {
      paidInvoicesUntilMonthEnd += inv.paidAmount || 0;
    }
  }

  let reserveNet = 0;
  for (const mov of reserveMovements) {
    if (mov.createdAt <= monthEnd) {
      reserveNet += mov.type === ReserveMovementType.DEPOSIT ? mov.amount : -mov.amount;
    }
  }
  const reserveBalance = Math.max(0, reserveNet);

  const goalBalanceMap = new Map();
  let netAllGoalContributions = 0;
  for (const c of goalContributions) {
    if (c.createdAt <= monthEnd) {
      netAllGoalContributions += c.amount;
      goalBalanceMap.set(c.goalId, (goalBalanceMap.get(c.goalId) || 0) + c.amount);
    }
  }
  let goalsTotalBalance = 0;
  for (const g of goals) {
    if (!g.isCompleted) {
      goalsTotalBalance += Math.max(0, goalBalanceMap.get(g.id) || 0);
    }
  }

  const cashInHand = totalIncomeUntilMonthEnd -
    cashFromBalanceUntilMonthEnd -
    extraCashFromBalanceUntilMonthEnd -
    paidInvoicesUntilMonthEnd -
    reserveBalance -
    cashFromReserveUntilMonthEnd -
    netAllGoalContributions -
    cashFromGoalUntilMonthEnd;

  // 2. Renda do Mês e Previsão (passagem única nos 6 meses anteriores)
  const monthIncomes = incomes
    .filter((i) => i.receivedAt >= monthStart && i.receivedAt <= monthEnd)
    .sort((a, b) => b.receivedAt - a.receivedAt);
  const receivedInMonth = monthIncomes.reduce((s, i) => s + i.amount, 0);

  const prev6Bounds = [];
  for (let offset = 6; offset >= 1; offset--) {
    const ym = stepYearMonth(selectedMonth, -offset);
    prev6Bounds.push(monthBoundsMillis(ym));
  }
  const prev6Start = prev6Bounds[0][0];
  const prev6End = prev6Bounds[prev6Bounds.length - 1][1];
  const prevIncomeBuckets = new Array(6).fill(0);
  for (const inc of incomes) {
    const ts = inc.receivedAt;
    if (ts >= prev6Start && ts <= prev6End) {
      for (let i = 0; i < 6; i++) {
        if (ts >= prev6Bounds[i][0] && ts <= prev6Bounds[i][1]) {
          prevIncomeBuckets[i] += inc.amount;
          break;
        }
      }
    }
  }
  const historicalMonthlyIncomes = prevIncomeBuckets.filter((v) => v > 0);
  const incomeHistoryStats = summarizeStats(historicalMonthlyIncomes);
  const projectedTotal = incomeHistoryStats.count >= 2
    ? Math.max(receivedInMonth, Math.min(settings.monthlyIncomeGoal, Math.max(0, incomeHistoryStats.mean - incomeHistoryStats.stdDev)))
    : Math.max(receivedInMonth, settings.monthlyIncomeGoal);
  const expectedMinTotal = incomeHistoryStats.count >= 2
    ? Math.max(receivedInMonth, Math.max(0, incomeHistoryStats.mean - incomeHistoryStats.stdDev))
    : projectedTotal;
  const expectedMaxTotal = incomeHistoryStats.count >= 2
    ? Math.max(receivedInMonth, Math.min(settings.monthlyIncomeGoal * 1.2, incomeHistoryStats.mean + incomeHistoryStats.stdDev))
    : Math.max(receivedInMonth, settings.monthlyIncomeGoal);

  const incomeProjection = {
    monthlyGoal: settings.monthlyIncomeGoal,
    receivedInMonth,
    remainingToGoal: Math.max(0, settings.monthlyIncomeGoal - receivedInMonth),
    projectedTotal,
    expectedMinTotal,
    expectedMaxTotal,
    historyStats: incomeHistoryStats
  };

  // 3. Reserva no mês
  const reserveMonthlyTarget = Math.max(
    0,
    settings.reserveTargetMode === ReserveTargetMode.PERCENT
      ? settings.monthlyIncomeGoal * (settings.reserveTargetValue / 100)
      : settings.reserveTargetValue
  );
  const depositedReserveInMonth = reserveMovements
    .filter((m) => m.createdAt >= monthStart && m.createdAt <= monthEnd && m.type === ReserveMovementType.DEPOSIT)
    .reduce((s, m) => s + m.amount, 0);
  const remainingReserveTarget = Math.max(0, reserveMonthlyTarget - depositedReserveInMonth);
  const weeksOfMonthWindows = weeksInMonth(selectedMonth);
  const currentWin = activeWeekWindow(selectedMonth, today);
  const remainingWeeksCount = Math.max(1, weeksOfMonthWindows.filter((w) => w.weekNumber >= currentWin.weekNumber).length);
  const reserveSummary = {
    monthlyTarget: reserveMonthlyTarget,
    depositedInMonth: depositedReserveInMonth,
    remainingMonthlyTarget: remainingReserveTarget,
    suggestedWeeklySeparation: remainingReserveTarget / remainingWeeksCount
  };

  // 4. Despesas do Mês & Cartão de Crédito
  const monthExpenses = expenses
    .filter((e) => e.spentAt >= monthStart && e.spentAt <= monthEnd)
    .sort((a, b) => b.spentAt - a.spentAt);
  const monthExtraExpenses = extraExpenses
    .filter((e) => e.spentAt >= monthStart && e.spentAt <= monthEnd)
    .sort((a, b) => b.spentAt - a.spentAt);

  const cardRegular = monthExpenses.filter((e) => e.paymentMethod === PaymentMethod.CREDIT_CARD);
  const cardExtra = monthExtraExpenses.filter((e) => e.paymentMethod === PaymentMethod.CREDIT_CARD);
  const cardPurchasesTotal = cardRegular.reduce((s, e) => s + e.amount, 0) + cardExtra.reduce((s, e) => s + e.amount, 0);
  const invoiceEntity = creditCardInvoices.find((i) => i.yearMonth === selectedMonth) || null;
  const effectiveCardTotal = Math.max(cardPurchasesTotal, invoiceEntity?.declaredAmount ?? cardPurchasesTotal);
  const creditCard = {
    yearMonth: selectedMonth,
    dueDateMillis: dueDateMillisForMonth(selectedMonth, settings.creditCardDueDay),
    expensesOnCardTotal: cardPurchasesTotal,
    declaredAmount: invoiceEntity?.declaredAmount ?? null,
    effectiveTotal: effectiveCardTotal,
    isPaid: invoiceEntity?.isPaid || false,
    paidAmount: invoiceEntity?.paidAmount || 0,
    paidAt: invoiceEntity?.paidAt ?? null,
    expensesCount: cardRegular.length + cardExtra.length
  };

  // 5. Contas Fixas
  const occByBill = new Map();
  for (const occ of billOccurrences) {
    if (!occByBill.has(occ.fixedBillId)) occByBill.set(occ.fixedBillId, []);
    occByBill.get(occ.fixedBillId).push(occ);
  }
  const anomalyAlerts = [];
  const fixedBillsStatus = fixedBills
    .filter((b) => b.isActive)
    .map((bill) => {
      const list = occByBill.get(bill.id) || [];
      const occurrence = list.find((o) => o.yearMonth === selectedMonth) || null;
      const dueDateMillis = occurrence?.dueDateMillis ?? dueDateMillisForMonth(selectedMonth, bill.dueDay);
      const historyAmounts = list
        .filter((o) => o.status === BillStatus.PAID && o.yearMonth < selectedMonth && (o.amount || 0) > 0)
        .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
        .slice(0, 6)
        .map((o) => o.amount);
      const stats = summarizeStats(historyAmounts);
      const currentAmount = occurrence?.amount ?? (stats.count >= 2 && stats.mean > 0 ? stats.mean : bill.expectedAmount);
      const anomalous = occurrence?.amount != null && isAnomalous(occurrence.amount, stats, settings.anomalySigmaThreshold);
      if (anomalous) {
        anomalyAlerts.push(`${bill.name} veio em ${formatBrl(currentAmount)} (média histórica ${formatBrl(stats.mean)})`);
      }
      return {
        bill,
        occurrence,
        tag: tagMap.get(bill.tagId) || null,
        dueDateMillis,
        currentAmount,
        status: occurrence?.status || BillStatus.PENDING,
        stats,
        isAnomalous: anomalous,
        daysUntilDue: daysBetweenTodayAnd(dueDateMillis, today)
      };
    })
    .sort((a, b) => a.dueDateMillis - b.dueDateMillis);

  const pendingFixedBillsTotal = fixedBillsStatus
    .filter((b) => b.status === BillStatus.PENDING)
    .reduce((s, b) => s + b.currentAmount, 0);
  const pendingCardTotal = creditCard.isPaid ? 0 : creditCard.effectiveTotal;
  const pendingBillsTotal = pendingFixedBillsTotal + pendingCardTotal;

  // 5b. Entradas Planejadas
  const plannedIncomesStatus = plannedIncomes
    .filter((p) => p.isActive && p.yearMonth === selectedMonth)
    .map((item) => {
      const expectedDateMillis = dueDateMillisForMonth(selectedMonth, item.expectedDay);
      const effectiveAmount = item.status === BillStatus.PAID
        ? (item.receivedAmount ?? item.expectedAmount)
        : item.expectedAmount;
      return {
        item,
        expectedDateMillis,
        effectiveAmount,
        daysUntilExpected: daysBetweenTodayAnd(expectedDateMillis, today)
      };
    })
    .sort((a, b) => {
      const pa = a.item.status === BillStatus.PAID ? 1 : 0;
      const pb = b.item.status === BillStatus.PAID ? 1 : 0;
      return pa !== pb ? pa - pb : a.expectedDateMillis - b.expectedDateMillis;
    });

  const pendingPlannedIncomesTotal = plannedIncomesStatus
    .filter((p) => p.item.status === BillStatus.PENDING)
    .reduce((s, p) => s + p.effectiveAmount, 0);

  // 5c. Projetos & Despesas Extraordinárias (classificação 100% definida pelo usuário)
  const extraMonthTotal = monthExtraExpenses.reduce((s, e) => s + e.amount, 0);
  const extraAllTimeTotal = extraExpenses.reduce((s, e) => s + e.amount, 0);

  const extraBreakdowns = activeExtraCategories.map((cat) => {
    const items = monthExtraExpenses.filter((e) => e.categoryId === cat.id);
    const spent = items.reduce((s, e) => s + e.amount, 0);
    const rawCap = Number(cat.monthlyCap) || 0;
    const cap = rawCap > 0 ? rawCap : null;
    const ratio = cap != null ? spent / cap : null;
    if (ratio != null && ratio >= 0.80) {
      const pct = Math.min(999, Math.trunc(ratio * 100));
      anomalyAlerts.push(
        ratio >= 1
          ? `Teto de "${cat.name}" ultrapassado: ${formatBrl(spent)} de ${formatBrl(cap)}`
          : `"${cat.name}" atingiu ${pct}% do teto (${formatBrl(spent)} / ${formatBrl(cap)})`
      );
    }
    return {
      category: cat,
      spentMonth: spent,
      cap,
      ratio,
      count: items.length
    };
  });

  const unclassifiedExtraItems = monthExtraExpenses.filter((e) => {
    if (e.categoryId == null) return true;
    const cat = extraCatMap.get(e.categoryId);
    return !cat || cat.isArchived;
  });
  if (unclassifiedExtraItems.length > 0) {
    const spent = unclassifiedExtraItems.reduce((s, e) => s + e.amount, 0);
    extraBreakdowns.push({
      category: null,
      spentMonth: spent,
      cap: null,
      ratio: null,
      count: unclassifiedExtraItems.length
    });
  }

  const extraMonthlyCap = Math.max(0, settings.extraordinaryMonthlyCap || 0);
  const extraMonthlyRatio = extraMonthlyCap > 0 ? extraMonthTotal / extraMonthlyCap : 0;
  if (extraMonthlyCap > 0 && extraMonthlyRatio >= 0.80) {
    const pct = Math.min(999, Math.trunc(extraMonthlyRatio * 100));
    anomalyAlerts.push(
      extraMonthlyRatio >= 1
        ? `Teto mensal de Projetos/Extras ultrapassado: ${formatBrl(extraMonthTotal)} de ${formatBrl(extraMonthlyCap)}`
        : `Projetos/Extras atingiram ${pct}% do teto (${formatBrl(extraMonthTotal)} / ${formatBrl(extraMonthlyCap)})`
    );
  }

  const totalReceiptsCount =
    monthExtraExpenses.reduce((s, e) => s + (e.receipts?.length || 0), 0) +
    monthExpenses.reduce((s, e) => s + (e.receipts?.length || 0), 0);
  const totalCouponsCount =
    monthExtraExpenses.filter((e) => e.coupon != null).length +
    monthExpenses.filter((e) => e.coupon != null).length;

  const projectMap = new Map();
  for (const e of monthExtraExpenses) {
    const pName = (e.projectName && e.projectName.trim()) || 'Sem projeto';
    projectMap.set(pName, (projectMap.get(pName) || 0) + e.amount);
  }
  const projectTotals = Array.from(projectMap.entries()).sort((a, b) => b[1] - a[1]);

  const topMap = new Map();
  for (const e of monthExtraExpenses) {
    const catName = e.categoryId != null ? extraCatMap.get(e.categoryId)?.name : null;
    const label = (e.description && e.description.trim()) || catName || 'Sem classificação';
    topMap.set(label, (topMap.get(label) || 0) + e.amount);
  }
  const topItems = Array.from(topMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const extraordinary = {
    monthTotal: extraMonthTotal,
    allTimeTotal: extraAllTimeTotal,
    monthlyCap: extraMonthlyCap,
    monthlyCapRatio: extraMonthlyRatio,
    remainingCap: extraMonthlyCap > 0 ? Math.max(0, extraMonthlyCap - extraMonthTotal) : 0,
    totalReceiptsCount,
    totalCouponsCount,
    activeCategories: activeExtraCategories,
    categoryBreakdowns: extraBreakdowns,
    projectTotals,
    expensesInMonth: monthExtraExpenses,
    activeRecurrings: extraRecurrings.filter((r) => r.isActive),
    topItems
  };

  // 6. Ciclo Semanal ancorado no Saldo Real em Mãos
  const recentExpenses = monthExpenses.map((expense) => ({
    expense,
    tag: tagMap.get(expense.tagId) || null
  }));

  const operationalExpenses = monthExpenses.filter((e) => {
    const t = tagMap.get(e.tagId)?.type || TagType.VARIABLE;
    if (t === TagType.FIXED || t === TagType.CREDIT_CARD) return false;
    return e.fundingSource === FundingSource.BALANCE;
  });

  const availableCashNow = Math.max(0, cashInHand - pendingFixedBillsTotal);
  const totalOperationalSpent = operationalExpenses.reduce((s, e) => s + e.amount, 0);
  const monthFreeBudget = availableCashNow + totalOperationalSpent;

  const daysInMonth = daysInYearMonth(selectedMonth);
  const activeVariableTags = (snapshot.tags || []).filter((t) => !t.isArchived && t.type === TagType.VARIABLE);
  const allHaveWeeklyCap = activeVariableTags.length > 0 && activeVariableTags.every((t) => (t.weeklyCap || 0) > 0);
  const sumWeeklyCaps = activeVariableTags.reduce((s, t) => s + (t.weeklyCap || 0), 0);

  const weeksOfMonth = weeksOfMonthWindows.map((week) => {
    let spentBeforeWeek = 0;
    let spentInWeek = 0;
    for (const exp of operationalExpenses) {
      if (exp.spentAt < week.startMillis) spentBeforeWeek += exp.amount;
      else if (exp.spentAt <= week.endMillis) spentInWeek += exp.amount;
    }

    const weekExpenses = recentExpenses.filter((r) =>
      r.expense.spentAt >= week.startMillis &&
      r.expense.spentAt <= week.endMillis &&
      r.tag?.type !== TagType.CREDIT_CARD
    );
    let cyclicTotal = 0;
    let fixedSpent = 0;
    for (const r of weekExpenses) {
      cyclicTotal += r.expense.amount;
      if (r.tag?.type === TagType.FIXED) fixedSpent += r.expense.amount;
    }
    const weekExtraExpenses = monthExtraExpenses.filter(
      (e) => e.spentAt >= week.startMillis && e.spentAt <= week.endMillis
    );
    const extraSpentInWeek = weekExtraExpenses.reduce((s, e) => s + e.amount, 0);
    const totalSpentInWeek = cyclicTotal + extraSpentInWeek;
    const incomesInWeek = monthIncomes
      .filter((i) => i.receivedAt >= week.startMillis && i.receivedAt <= week.endMillis)
      .reduce((s, i) => s + i.amount, 0);

    const remainingFromStart = Math.max(0, monthFreeBudget - spentBeforeWeek);
    const daysRemFromStart = Math.max(1, daysInMonth - week.startDay + 1);
    const proportionalLimit = remainingFromStart * (week.dayCount / daysRemFromStart);
    const weeklyLimit = allHaveWeeklyCap ? Math.min(proportionalLimit, sumWeeklyCaps) : proportionalLimit;
    const rawRemaining = weeklyLimit - spentInWeek;
    const remainingInWeek = rawRemaining > 0 ? Math.min(availableCashNow, rawRemaining) : rawRemaining;

    return {
      week,
      isCurrentWeek: week.weekNumber === currentWin.weekNumber,
      weeklyLimit,
      spentInWeek,
      remainingInWeek,
      totalSpentInWeek,
      fixedSpentInWeek: fixedSpent,
      extraSpentInWeek,
      incomesInWeek,
      expenses: weekExpenses,
      extraExpenses: weekExtraExpenses
    };
  });

  const currentWeek = weeksOfMonth.find((w) => w.isCurrentWeek) || weeksOfMonth[0];
  const reservedForFutureWeeks = Math.max(0, availableCashNow - Math.max(0, currentWeek.remainingInWeek));

  // 7. Etiquetas & Desvio Padrão
  const monthExpByTag = new Map();
  for (const e of monthExpenses) {
    if (!monthExpByTag.has(e.tagId)) monthExpByTag.set(e.tagId, []);
    monthExpByTag.get(e.tagId).push(e);
  }
  const fixedTagIds = new Set(
    (snapshot.tags || []).filter((t) => !t.isArchived && t.type === TagType.FIXED).map((t) => t.id)
  );
  const fixedBuckets = new Map();
  for (const id of fixedTagIds) fixedBuckets.set(id, new Array(6).fill(0));
  if (fixedTagIds.size > 0) {
    for (const e of expenses) {
      if (!fixedTagIds.has(e.tagId)) continue;
      if (e.spentAt >= prev6Start && e.spentAt <= prev6End) {
        for (let i = 0; i < 6; i++) {
          if (e.spentAt >= prev6Bounds[i][0] && e.spentAt <= prev6Bounds[i][1]) {
            fixedBuckets.get(e.tagId)[i] += e.amount;
            break;
          }
        }
      }
    }
  }

  const activeWeekStart = currentWeek.week.startMillis;
  const activeWeekEnd = currentWeek.week.endMillis;
  const tagStatuses = (snapshot.tags || [])
    .filter((t) => !t.isArchived)
    .map((tag) => {
      const tagMonth = monthExpByTag.get(tag.id) || [];
      const tagSum = tagMonth.reduce((s, e) => s + e.amount, 0);
      const spentMonth = tag.type === TagType.CREDIT_CARD ? Math.max(effectiveCardTotal, tagSum) : tagSum;
      const spentCurrentWeek = tagMonth
        .filter((e) => e.spentAt >= activeWeekStart && e.spentAt <= activeWeekEnd)
        .reduce((s, e) => s + e.amount, 0);

      let historicalStats = null;
      if (tag.type === TagType.FIXED) {
        const totals = (fixedBuckets.get(tag.id) || []).filter((v) => v > 0);
        if (totals.length > 0) historicalStats = summarizeStats(totals);
      }
      const tagAnomalous = historicalStats != null && isAnomalous(spentMonth, historicalStats, settings.anomalySigmaThreshold);
      if (tagAnomalous) {
        const msg = `${tag.name} está em ${formatBrl(spentMonth)} (média ${formatBrl(historicalStats.mean)})`;
        if (!anomalyAlerts.includes(msg)) anomalyAlerts.push(msg);
      }

      return {
        tag,
        spentMonth,
        spentCurrentWeek,
        monthlyCap: tag.monthlyCap,
        weeklyCap: tag.weeklyCap,
        monthlyRatio: tag.monthlyCap > 0 ? spentMonth / tag.monthlyCap : null,
        weeklyRatio: tag.weeklyCap > 0 ? spentCurrentWeek / tag.weeklyCap : null,
        historicalStats,
        isAnomalous: tagAnomalous
      };
    });

  const donutSlices = tagStatuses
    .filter((s) => s.tag.type !== TagType.CREDIT_CARD && s.spentMonth > 0)
    .sort((a, b) => b.spentMonth - a.spentMonth);

  // 8. Metas Planejadas
  const contribByGoal = new Map();
  for (const c of goalContributions) {
    contribByGoal.set(c.goalId, (contribByGoal.get(c.goalId) || 0) + c.amount);
  }
  const goalStatuses = goals
    .map((goal) => {
      const savedAmount = Math.max(0, contribByGoal.get(goal.id) || 0);
      const progress = goal.targetAmount > 0 ? Math.max(0, Math.min(1, savedAmount / goal.targetAmount)) : 0;
      return {
        goal,
        tag: goal.tagId != null ? (tagMap.get(goal.tagId) || null) : null,
        savedAmount,
        remainingAmount: Math.max(0, goal.targetAmount - savedAmount),
        progress
      };
    })
    .sort((a, b) => {
      if (a.goal.isCompleted !== b.goal.isCompleted) return a.goal.isCompleted ? 1 : -1;
      return b.progress - a.progress;
    });

  // 9. Consolidado Família (Casa + Extraordinárias)
  const monthTotalExpenses =
    monthExpenses.reduce((s, e) => s + (tagMap.get(e.tagId)?.type !== TagType.CREDIT_CARD ? e.amount : 0), 0) +
    Math.max(0, effectiveCardTotal - cardPurchasesTotal);
  const monthFamilyTotalExpenses = monthTotalExpenses + extraMonthTotal;

  const monthCashOutflows =
    monthExpenses.reduce((s, e) => s + (e.paymentMethod === PaymentMethod.CASH_PIX_DEBIT && e.fundingSource === FundingSource.BALANCE ? e.amount : 0), 0) +
    monthExtraExpenses.reduce((s, e) => s + (e.paymentMethod === PaymentMethod.CASH_PIX_DEBIT && e.fundingSource === FundingSource.BALANCE ? e.amount : 0), 0) +
    (creditCard.isPaid ? creditCard.paidAmount : 0);

  // 10. Comparativo 6 meses em passagem única O(N)
  const invByMonth = new Map();
  for (const inv of creditCardInvoices) invByMonth.set(inv.yearMonth, inv);
  const lastSixMonths = [];
  const sixBounds = [];
  for (let i = 5; i >= 0; i--) {
    const ym = stepYearMonth(selectedMonth, -i);
    lastSixMonths.push(ym);
    sixBounds.push(monthBoundsMillis(ym));
  }
  const compStart = sixBounds[0][0];
  const compEnd = sixBounds[5][1];
  const incByMonth = new Array(6).fill(0);
  const cardByMonth = new Array(6).fill(0);
  const nonCardByMonth = new Array(6).fill(0);
  const extraByMonth = new Array(6).fill(0);

  const bucketFor = (ts) => {
    if (ts < compStart || ts > compEnd) return -1;
    for (let i = 0; i < 6; i++) {
      if (ts >= sixBounds[i][0] && ts <= sixBounds[i][1]) return i;
    }
    return -1;
  };

  for (const inc of incomes) {
    const idx = bucketFor(inc.receivedAt);
    if (idx >= 0) incByMonth[idx] += inc.amount;
  }
  for (const exp of expenses) {
    const idx = bucketFor(exp.spentAt);
    if (idx >= 0) {
      if (exp.paymentMethod === PaymentMethod.CREDIT_CARD) cardByMonth[idx] += exp.amount;
      if (tagMap.get(exp.tagId)?.type !== TagType.CREDIT_CARD) nonCardByMonth[idx] += exp.amount;
    }
  }
  for (const ext of extraExpenses) {
    const idx = bucketFor(ext.spentAt);
    if (idx >= 0) {
      extraByMonth[idx] += ext.amount;
      if (ext.paymentMethod === PaymentMethod.CREDIT_CARD) cardByMonth[idx] += ext.amount;
    }
  }

  const monthlyComparison = lastSixMonths.map((ym, idx) => {
    const declared = invByMonth.get(ym)?.declaredAmount ?? cardByMonth[idx];
    const extraCard = Math.max(0, declared - cardByMonth[idx]);
    const expenseTotal = nonCardByMonth[idx] + extraCard;
    const extraExpenseTotal = extraByMonth[idx];
    return {
      yearMonth: ym,
      label: formatYearMonthShortBr(ym),
      incomeTotal: incByMonth[idx],
      expenseTotal,
      extraExpenseTotal,
      familyExpenseTotal: expenseTotal + extraExpenseTotal
    };
  });

  return {
    selectedMonth,
    cashInHand,
    reserveBalance,
    goalsTotalBalance,
    incomeProjection,
    reserveSummary,
    currentWeek,
    weeksOfMonth,
    monthFreeBudget,
    monthTotalExpenses,
    monthFamilyTotalExpenses,
    monthCashOutflows,
    tagStatuses,
    donutSlices,
    creditCard,
    fixedBills: fixedBillsStatus,
    pendingBillsTotal,
    anomalyAlerts,
    goals: goalStatuses,
    recentIncomes: monthIncomes,
    recentExpenses,
    recentReserveMovements: [...reserveMovements].sort((a, b) => b.createdAt - a.createdAt),
    recentGoalContributions: [...goalContributions].sort((a, b) => b.createdAt - a.createdAt),
    monthlyComparison,
    settings,
    reservedForFutureWeeks,
    plannedIncomes: plannedIncomesStatus,
    pendingPlannedIncomesTotal,
    extraordinary
  };
}
