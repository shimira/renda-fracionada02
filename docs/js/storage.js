import {
  BillStatus,
  DEFAULT_SETTINGS,
  DEFAULT_TAGS,
  ExpenseSource,
  FundingSource,
  PaymentMethod,
  ReserveMovementType,
  TAG_COLOR_PALETTE,
  TagType,
  computeOverview,
  createEmptySnapshot,
  currentYearMonth,
  dueDateMillisForMonth
} from './engine.js';
import { clearAllReceipts, deleteReceiptBlob } from './receipts-db.js';

const STORAGE_KEY = 'renda_fracionada_v3_snapshot';

export class FinanceStore {
  constructor() {
    this.snapshot = this.#load();
    this.selectedMonth = currentYearMonth();
    this.listeners = new Set();
    this.ensureOccurrences(this.selectedMonth);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.listeners) fn(this.getOverview());
  }

  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = createEmptySnapshot();
        this.#saveRaw(fresh);
        return fresh;
      }
      const parsed = JSON.parse(raw);
      const safeTags = Array.isArray(parsed.tags) && parsed.tags.length > 0
        ? parsed.tags
        : DEFAULT_TAGS.map((t) => ({ ...t }));
      const base = createEmptySnapshot();
      const merged = {
        ...base,
        ...parsed,
        tags: safeTags,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
      };
      const maxId = Math.max(
        merged.nextId || 100,
        ...[
          ...merged.tags,
          ...merged.incomes,
          ...merged.expenses,
          ...merged.reserveMovements,
          ...merged.goals,
          ...merged.goalContributions,
          ...merged.fixedBills,
          ...merged.billOccurrences,
          ...merged.plannedIncomes,
          ...merged.extraExpenses,
          ...merged.extraRecurrings
        ].map((x) => Number(x?.id) || 0)
      );
      merged.nextId = Math.max(100, maxId + 1);
      return merged;
    } catch {
      return createEmptySnapshot();
    }
  }

  #saveRaw(snap) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch {
      // ignore quota fallback
    }
  }

  #commit(updater, { notify = true } = {}) {
    updater(this.snapshot);
    this.#saveRaw(this.snapshot);
    if (notify) this.#notify();
  }

  #allocId() {
    const id = Math.max(100, this.snapshot.nextId || 100);
    this.snapshot.nextId = id + 1;
    return id;
  }

  getOverview() {
    return computeOverview(this.snapshot, this.selectedMonth);
  }

  setMonth(ymStr) {
    this.selectedMonth = ymStr;
    this.ensureOccurrences(ymStr, { notify: false });
    this.#notify();
  }

  ensureOccurrences(ymStr, { notify = false } = {}) {
    let changed = false;
    const activeBills = this.snapshot.fixedBills.filter((b) => b.isActive);
    const existingOcc = new Set(
      this.snapshot.billOccurrences.filter((o) => o.yearMonth === ymStr).map((o) => o.fixedBillId)
    );
    for (const bill of activeBills) {
      if (!existingOcc.has(bill.id)) {
        this.snapshot.billOccurrences.push({
          id: this.#allocId(),
          fixedBillId: bill.id,
          yearMonth: ymStr,
          dueDateMillis: dueDateMillisForMonth(ymStr, bill.dueDay),
          amount: null,
          status: BillStatus.PENDING,
          paidAt: null,
          expenseId: null
        });
        changed = true;
      }
    }

    const activePlanned = this.snapshot.plannedIncomes.filter((p) => p.isActive);
    const existingNames = new Set(
      activePlanned.filter((p) => p.yearMonth === ymStr).map((p) => p.name.toLowerCase())
    );
    const templates = new Map();
    for (const p of activePlanned) {
      if (p.isRecurring && p.yearMonth !== ymStr) {
        const key = p.name.toLowerCase();
        const prev = templates.get(key);
        if (!prev || p.yearMonth > prev.yearMonth) templates.set(key, p);
      }
    }
    for (const [key, tpl] of templates.entries()) {
      if (!existingNames.has(key)) {
        this.snapshot.plannedIncomes.push({
          id: this.#allocId(),
          name: tpl.name,
          expectedDay: tpl.expectedDay,
          expectedAmount: tpl.expectedAmount,
          yearMonth: ymStr,
          isRecurring: true,
          status: BillStatus.PENDING,
          receivedAmount: null,
          receivedAt: null,
          incomeFractionId: null,
          isActive: true
        });
        changed = true;
      }
    }

    if (changed) {
      this.#saveRaw(this.snapshot);
      if (notify) this.#notify();
    }
  }

  #assignReceiptsAndCoupon(receipts = [], coupon = null) {
    const assignedReceipts = receipts.map((r) => (r.id > 0 ? r : { ...r, id: this.#allocId() }));
    const assignedCoupon = coupon
      ? {
          ...coupon,
          id: coupon.id > 0 ? coupon.id : this.#allocId(),
          items: (coupon.items || []).map((item) =>
            item.id > 0 ? item : { ...item, id: this.#allocId() }
          )
        }
      : null;
    return { assignedReceipts, assignedCoupon };
  }

  // Entradas Fracionadas
  addIncomeFraction({ amount, description, receivedAt, reserveDepositAmount = 0, goalAllocation = null }) {
    this.#commit((s) => {
      const safeDesc = (description || '').trim() || 'Entrada fracionada';
      const incomeId = this.#allocId();
      s.incomes.push({ id: incomeId, amount, description: safeDesc, receivedAt });
      if (reserveDepositAmount > 0) {
        s.reserveMovements.push({
          id: this.#allocId(),
          amount: reserveDepositAmount,
          type: ReserveMovementType.DEPOSIT,
          note: `Fração da entrada: ${(description || '').trim() || 'Renda'}`,
          createdAt: receivedAt,
          incomeFractionId: incomeId,
          expenseId: null
        });
      }
      if (goalAllocation && goalAllocation.amount > 0) {
        s.goalContributions.push({
          id: this.#allocId(),
          goalId: goalAllocation.goalId,
          amount: goalAllocation.amount,
          note: `Destino da entrada: ${(description || '').trim() || 'Renda'}`,
          createdAt: receivedAt,
          incomeFractionId: incomeId
        });
      }
    });
  }

  updateIncomeFraction(incomeId, { amount, description, receivedAt }) {
    this.#commit((s) => {
      const safeDesc = (description || '').trim() || 'Entrada fracionada';
      s.incomes = s.incomes.map((i) => (i.id === incomeId ? { ...i, amount, description: safeDesc, receivedAt } : i));
      s.plannedIncomes = s.plannedIncomes.map((p) =>
        p.incomeFractionId === incomeId ? { ...p, receivedAmount: amount, receivedAt } : p
      );
    });
  }

  deleteIncomeFraction(incomeId) {
    this.#commit((s) => {
      s.incomes = s.incomes.filter((i) => i.id !== incomeId);
      s.reserveMovements = s.reserveMovements.filter((m) => m.incomeFractionId !== incomeId);
      s.goalContributions = s.goalContributions.filter((c) => c.incomeFractionId !== incomeId);
      s.plannedIncomes = s.plannedIncomes.map((p) =>
        p.incomeFractionId === incomeId
          ? { ...p, status: BillStatus.PENDING, receivedAmount: null, receivedAt: null, incomeFractionId: null }
          : p
      );
    });
  }

  // Gastos Comuns (Casa)
  addManualExpense({ amount, description, tagId, paymentMethod, fundingSource, spentAt, receipts = [], coupon = null }) {
    const effectiveFunding = paymentMethod === PaymentMethod.CREDIT_CARD ? FundingSource.BALANCE : fundingSource;
    this.#commit((s) => {
      const safeDesc = (description || '').trim() || 'Gasto registrado';
      const expenseId = this.#allocId();
      const { assignedReceipts, assignedCoupon } = this.#assignReceiptsAndCoupon(receipts, coupon);
      s.expenses.push({
        id: expenseId,
        amount,
        description: safeDesc,
        tagId,
        paymentMethod,
        fundingSource: effectiveFunding,
        source: ExpenseSource.MANUAL,
        spentAt,
        billOccurrenceId: null,
        receipts: assignedReceipts,
        coupon: assignedCoupon
      });
      if (effectiveFunding === FundingSource.RESERVE) {
        s.reserveMovements.push({
          id: this.#allocId(),
          amount,
          type: ReserveMovementType.WITHDRAWAL,
          note: `Imprevisto via Reserva: ${safeDesc}`,
          createdAt: spentAt,
          incomeFractionId: null,
          expenseId
        });
      }
    });
  }

  updateExpense(expenseId, { amount, description, tagId, paymentMethod, fundingSource, spentAt, receipts = [], coupon = null }) {
    const effectiveFunding = paymentMethod === PaymentMethod.CREDIT_CARD ? FundingSource.BALANCE : fundingSource;
    const orphaned = [];
    this.#commit((s) => {
      const target = s.expenses.find((e) => e.id === expenseId);
      if (!target) return;
      const safeDesc = (description || '').trim() || 'Gasto registrado';
      const { assignedReceipts, assignedCoupon } = this.#assignReceiptsAndCoupon(receipts, coupon);
      const keptKeys = new Set(assignedReceipts.map((r) => r.blobKey || r.fullPath));
      for (const old of target.receipts || []) {
        if (!keptKeys.has(old.blobKey || old.fullPath) && old.blobKey) orphaned.push(old.blobKey);
      }
      s.expenses = s.expenses.map((e) =>
        e.id === expenseId
          ? {
              ...e,
              amount,
              description: safeDesc,
              tagId,
              paymentMethod,
              fundingSource: effectiveFunding,
              spentAt,
              receipts: assignedReceipts,
              coupon: assignedCoupon
            }
          : e
      );
      s.reserveMovements = s.reserveMovements.filter((m) => m.expenseId !== expenseId);
      if (effectiveFunding === FundingSource.RESERVE) {
        s.reserveMovements.push({
          id: this.#allocId(),
          amount,
          type: ReserveMovementType.WITHDRAWAL,
          note: `Imprevisto via Reserva: ${safeDesc}`,
          createdAt: spentAt,
          incomeFractionId: null,
          expenseId
        });
      }
      if (target.billOccurrenceId != null) {
        s.billOccurrences = s.billOccurrences.map((o) =>
          o.id === target.billOccurrenceId ? { ...o, amount, paidAt: spentAt } : o
        );
      }
    });
    orphaned.forEach((k) => deleteReceiptBlob(k));
  }

  deleteExpense(expenseId) {
    const toDelete = [];
    this.#commit((s) => {
      const target = s.expenses.find((e) => e.id === expenseId);
      if (!target) return;
      for (const r of target.receipts || []) {
        if (r.blobKey) toDelete.push(r.blobKey);
      }
      if (target.billOccurrenceId != null) {
        s.billOccurrences = s.billOccurrences.map((o) =>
          o.id === target.billOccurrenceId ? { ...o, status: BillStatus.PENDING, paidAt: null, expenseId: null } : o
        );
      }
      s.expenses = s.expenses.filter((e) => e.id !== expenseId);
      s.reserveMovements = s.reserveMovements.filter((m) => m.expenseId !== expenseId);
    });
    toDelete.forEach((k) => deleteReceiptBlob(k));
  }

  // Despesas Extraordinárias
  updateExtraordinaryCaps({ monthlyCap, materialCap, laborCap, equipmentCap }) {
    this.#commit((s) => {
      s.settings = {
        ...s.settings,
        extraordinaryMonthlyCap: Math.max(0, monthlyCap || 0),
        extraMaterialCap: Math.max(0, materialCap || 0),
        extraLaborCap: Math.max(0, laborCap || 0),
        extraEquipmentCap: Math.max(0, equipmentCap || 0)
      };
    });
  }

  addExtraExpense({
    description, categoryType, quantity, unit, unitPrice, amount,
    supplierOrPerson, projectName, paymentMethod, fundingSource, spentAt,
    receipts = [], coupon = null, recurringId = null
  }) {
    const effectiveFunding = paymentMethod === PaymentMethod.CREDIT_CARD ? FundingSource.BALANCE : fundingSource;
    this.#commit((s) => {
      const safeDesc = (description || '').trim() || 'Despesa extraordinária';
      const extraId = this.#allocId();
      const { assignedReceipts, assignedCoupon } = this.#assignReceiptsAndCoupon(receipts, coupon);
      s.extraExpenses.push({
        id: extraId,
        description: safeDesc,
        categoryType,
        quantity: Math.max(0.01, quantity || 1),
        unit: (unit || '').trim() || 'un',
        unitPrice: Math.max(0, unitPrice || 0),
        amount: Math.max(0, amount || 0),
        supplierOrPerson: (supplierOrPerson || '').trim(),
        projectName: (projectName || '').trim(),
        paymentMethod,
        fundingSource: effectiveFunding,
        spentAt,
        receipts: assignedReceipts,
        coupon: assignedCoupon,
        recurringId
      });
      if (effectiveFunding === FundingSource.RESERVE) {
        s.reserveMovements.push({
          id: this.#allocId(),
          amount: Math.max(0, amount || 0),
          type: ReserveMovementType.WITHDRAWAL,
          note: `Despesa extraordinária via Reserva: ${safeDesc}`,
          createdAt: spentAt,
          incomeFractionId: null,
          expenseId: -extraId
        });
      }
    });
  }

  updateExtraExpense(extraId, {
    description, categoryType, quantity, unit, unitPrice, amount,
    supplierOrPerson, projectName, paymentMethod, fundingSource, spentAt,
    receipts = [], coupon = null
  }) {
    const effectiveFunding = paymentMethod === PaymentMethod.CREDIT_CARD ? FundingSource.BALANCE : fundingSource;
    const orphaned = [];
    this.#commit((s) => {
      const target = s.extraExpenses.find((e) => e.id === extraId);
      if (!target) return;
      const safeDesc = (description || '').trim() || target.description;
      const { assignedReceipts, assignedCoupon } = this.#assignReceiptsAndCoupon(receipts, coupon);
      const keptKeys = new Set(assignedReceipts.map((r) => r.blobKey || r.fullPath));
      for (const old of target.receipts || []) {
        if (!keptKeys.has(old.blobKey || old.fullPath) && old.blobKey) orphaned.push(old.blobKey);
      }
      s.extraExpenses = s.extraExpenses.map((e) =>
        e.id === extraId
          ? {
              ...e,
              description: safeDesc,
              categoryType,
              quantity: Math.max(0.01, quantity || 1),
              unit: (unit || '').trim() || 'un',
              unitPrice: Math.max(0, unitPrice || 0),
              amount: Math.max(0, amount || 0),
              supplierOrPerson: (supplierOrPerson || '').trim(),
              projectName: (projectName || '').trim(),
              paymentMethod,
              fundingSource: effectiveFunding,
              spentAt,
              receipts: assignedReceipts,
              coupon: assignedCoupon
            }
          : e
      );
      s.reserveMovements = s.reserveMovements.filter((m) => m.expenseId !== -extraId);
      if (effectiveFunding === FundingSource.RESERVE) {
        s.reserveMovements.push({
          id: this.#allocId(),
          amount: Math.max(0, amount || 0),
          type: ReserveMovementType.WITHDRAWAL,
          note: `Despesa extraordinária via Reserva: ${safeDesc}`,
          createdAt: spentAt,
          incomeFractionId: null,
          expenseId: -extraId
        });
      }
    });
    orphaned.forEach((k) => deleteReceiptBlob(k));
  }

  deleteExtraExpense(extraId) {
    const toDelete = [];
    this.#commit((s) => {
      const target = s.extraExpenses.find((e) => e.id === extraId);
      if (!target) return;
      for (const r of target.receipts || []) {
        if (r.blobKey) toDelete.push(r.blobKey);
      }
      s.extraExpenses = s.extraExpenses.filter((e) => e.id !== extraId);
      s.reserveMovements = s.reserveMovements.filter((m) => m.expenseId !== -extraId);
    });
    toDelete.forEach((k) => deleteReceiptBlob(k));
  }

  createExtraRecurring({ name, categoryType, personOrCompany, ratePerUnit, unitLabel }) {
    this.#commit((s) => {
      s.extraRecurrings.push({
        id: this.#allocId(),
        name: (name || '').trim() || 'Recorrente',
        categoryType,
        personOrCompany: (personOrCompany || '').trim(),
        ratePerUnit: Math.max(0, ratePerUnit || 0),
        unitLabel: (unitLabel || '').trim() || 'diária',
        isActive: true
      });
    });
  }

  updateExtraRecurring(id, { name, categoryType, personOrCompany, ratePerUnit, unitLabel }) {
    this.#commit((s) => {
      s.extraRecurrings = s.extraRecurrings.map((r) =>
        r.id === id
          ? {
              ...r,
              name: (name || '').trim() || r.name,
              categoryType,
              personOrCompany: (personOrCompany || '').trim(),
              ratePerUnit: Math.max(0, ratePerUnit || 0),
              unitLabel: (unitLabel || '').trim() || r.unitLabel
            }
          : r
      );
    });
  }

  deleteExtraRecurring(id) {
    this.#commit((s) => {
      s.extraRecurrings = s.extraRecurrings.filter((r) => r.id !== id);
    });
  }

  // Etiquetas
  createTag({ name, type, colorHex, weeklyCap, monthlyCap }) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('Informe um nome para a etiqueta.');
    let createdId = 0;
    this.#commit((s) => {
      const existing = s.tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        if (!existing.isArchived) throw new Error(`Já existe uma etiqueta chamada "${trimmed}".`);
        createdId = existing.id;
        s.tags = s.tags.map((t) =>
          t.id === existing.id ? { ...t, type, colorHex, weeklyCap, monthlyCap, isArchived: false } : t
        );
      } else {
        createdId = this.#allocId();
        s.tags.push({
          id: createdId,
          name: trimmed,
          type,
          colorHex: colorHex || TAG_COLOR_PALETTE[0],
          weeklyCap: weeklyCap > 0 ? weeklyCap : null,
          monthlyCap: monthlyCap > 0 ? monthlyCap : null,
          isSystem: false,
          isArchived: false
        });
      }
    });
    return createdId;
  }

  updateTagCaps(tagId, { name, type, colorHex, weeklyCap, monthlyCap }) {
    this.#commit((s) => {
      const target = s.tags.find((t) => t.id === tagId);
      if (!target) throw new Error('Etiqueta não encontrada.');
      const finalName = (name || '').trim() || target.name;
      const dup = s.tags.find((t) => t.id !== tagId && !t.isArchived && t.name.toLowerCase() === finalName.toLowerCase());
      if (dup) throw new Error(`Já existe uma etiqueta chamada "${finalName}".`);
      s.tags = s.tags.map((t) =>
        t.id === tagId
          ? {
              ...t,
              name: finalName,
              type,
              colorHex: colorHex || t.colorHex,
              weeklyCap: weeklyCap > 0 ? weeklyCap : null,
              monthlyCap: monthlyCap > 0 ? monthlyCap : null
            }
          : t
      );
    });
  }

  archiveTag(tagId) {
    this.#commit((s) => {
      if (s.tags.filter((t) => !t.isArchived && t.id !== tagId).length < 1) {
        throw new Error('Mantenha pelo menos uma etiqueta ativa.');
      }
      s.tags = s.tags.map((t) => (t.id === tagId ? { ...t, isArchived: true } : t));
    });
  }

  // Cartão de Crédito
  setCreditCardDeclaredAmount(declaredAmount) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      const existing = s.creditCardInvoices.find((i) => i.yearMonth === ymStr);
      if (existing) {
        s.creditCardInvoices = s.creditCardInvoices.map((i) =>
          i.yearMonth === ymStr ? { ...i, declaredAmount } : i
        );
      } else {
        s.creditCardInvoices.push({
          yearMonth: ymStr,
          declaredAmount,
          isPaid: false,
          paidAmount: 0,
          paidAt: null
        });
      }
    });
  }

  payCreditCardInvoice(paidAmount, paidAt = Date.now()) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      const existing = s.creditCardInvoices.find((i) => i.yearMonth === ymStr);
      const updated = {
        yearMonth: ymStr,
        declaredAmount: Math.max(existing?.declaredAmount || 0, paidAmount),
        isPaid: true,
        paidAmount,
        paidAt
      };
      if (existing) {
        s.creditCardInvoices = s.creditCardInvoices.map((i) => (i.yearMonth === ymStr ? updated : i));
      } else {
        s.creditCardInvoices.push(updated);
      }
    });
  }

  undoPayCreditCardInvoice() {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      s.creditCardInvoices = s.creditCardInvoices.map((i) =>
        i.yearMonth === ymStr ? { ...i, isPaid: false, paidAmount: 0, paidAt: null } : i
      );
    });
  }

  // Reserva
  addReserveDeposit(amount, note, createdAt = Date.now()) {
    this.#commit((s) => {
      s.reserveMovements.push({
        id: this.#allocId(),
        amount,
        type: ReserveMovementType.DEPOSIT,
        note: (note || '').trim() || 'Aporte na Reserva',
        createdAt,
        incomeFractionId: null,
        expenseId: null
      });
    });
  }

  addReserveWithdrawal(amount, note, createdAt = Date.now()) {
    this.#commit((s) => {
      s.reserveMovements.push({
        id: this.#allocId(),
        amount,
        type: ReserveMovementType.WITHDRAWAL,
        note: (note || '').trim() || 'Retirada da Reserva',
        createdAt,
        incomeFractionId: null,
        expenseId: null
      });
    });
  }

  updateReserveMovement(id, { amount, type, note, createdAt }) {
    this.#commit((s) => {
      const fallback = type === ReserveMovementType.DEPOSIT ? 'Aporte na Reserva' : 'Retirada da Reserva';
      s.reserveMovements = s.reserveMovements.map((m) =>
        m.id === id ? { ...m, amount, type, note: (note || '').trim() || fallback, createdAt } : m
      );
    });
  }

  deleteReserveMovement(id) {
    this.#commit((s) => {
      s.reserveMovements = s.reserveMovements.filter((m) => m.id !== id);
    });
  }

  // Gastos Planejados (Caixinhas/Metas)
  createPlannedGoal({ name, targetAmount, tagId, notes }) {
    this.#commit((s) => {
      s.goals.push({
        id: this.#allocId(),
        name: (name || '').trim(),
        targetAmount: Math.max(1, targetAmount || 1),
        tagId: tagId ?? null,
        notes: (notes || '').trim(),
        isCompleted: false,
        createdAt: Date.now()
      });
    });
  }

  updatePlannedGoal(goalId, { name, targetAmount, tagId, notes }) {
    this.#commit((s) => {
      s.goals = s.goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              name: (name || '').trim() || g.name,
              targetAmount: Math.max(1, targetAmount || 1),
              tagId: tagId ?? null,
              notes: (notes || '').trim()
            }
          : g
      );
    });
  }

  deletePlannedGoal(goalId) {
    this.#commit((s) => {
      s.goals = s.goals.filter((g) => g.id !== goalId);
      s.goalContributions = s.goalContributions.filter((c) => c.goalId !== goalId);
    });
  }

  contributeToGoal(goalId, { amount, note, createdAt = Date.now() }) {
    this.#commit((s) => {
      s.goalContributions.push({
        id: this.#allocId(),
        goalId,
        amount,
        note: (note || '').trim() || (amount >= 0 ? 'Aporte na meta' : 'Resgate para saldo livre'),
        createdAt,
        incomeFractionId: null
      });
    });
  }

  updateGoalContribution(contribId, { amount, note, createdAt }) {
    this.#commit((s) => {
      s.goalContributions = s.goalContributions.map((c) =>
        c.id === contribId
          ? {
              ...c,
              amount,
              note: (note || '').trim() || (amount >= 0 ? 'Aporte na meta' : 'Resgate para saldo livre'),
              createdAt
            }
          : c
      );
    });
  }

  deleteGoalContribution(contribId) {
    this.#commit((s) => {
      s.goalContributions = s.goalContributions.filter((c) => c.id !== contribId);
    });
  }

  completeGoalPurchase(goalId, { purchaseAmount, tagId, note, purchasedAt = Date.now() }) {
    this.#commit((s) => {
      const goal = s.goals.find((g) => g.id === goalId);
      if (!goal) return;
      const saved = Math.max(0, s.goalContributions.filter((c) => c.goalId === goalId).reduce((sum, c) => sum + c.amount, 0));
      const fromGoal = Math.min(saved, purchaseAmount);
      const fromBalance = Math.max(0, purchaseAmount - fromGoal);
      const desc = (note || '').trim() || `Compra planejada: ${goal.name}`;
      if (fromGoal > 0) {
        s.goalContributions.push({
          id: this.#allocId(),
          goalId,
          amount: -fromGoal,
          note: `Utilizado na compra: ${goal.name}`,
          createdAt: purchasedAt,
          incomeFractionId: null
        });
        s.expenses.push({
          id: this.#allocId(),
          amount: fromGoal,
          description: desc,
          tagId,
          paymentMethod: PaymentMethod.CASH_PIX_DEBIT,
          fundingSource: FundingSource.GOAL,
          source: ExpenseSource.GOAL_PURCHASE,
          spentAt: purchasedAt,
          billOccurrenceId: null,
          receipts: [],
          coupon: null
        });
      }
      if (fromBalance > 0) {
        s.expenses.push({
          id: this.#allocId(),
          amount: fromBalance,
          description: `${desc} (complemento do saldo)`,
          tagId,
          paymentMethod: PaymentMethod.CASH_PIX_DEBIT,
          fundingSource: FundingSource.BALANCE,
          source: ExpenseSource.GOAL_PURCHASE,
          spentAt: purchasedAt,
          billOccurrenceId: null,
          receipts: [],
          coupon: null
        });
      }
      s.goals = s.goals.map((g) => (g.id === goalId ? { ...g, isCompleted: true } : g));
    });
  }

  reopenGoal(goalId) {
    this.#commit((s) => {
      s.goals = s.goals.map((g) => (g.id === goalId ? { ...g, isCompleted: false } : g));
    });
  }

  // Contas Fixas
  createFixedBill({ name, tagId, dueDay, expectedAmount }) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      const safeDay = Math.max(1, Math.min(31, Number(dueDay) || 1));
      const billId = this.#allocId();
      s.fixedBills.push({
        id: billId,
        name: (name || '').trim(),
        tagId,
        dueDay: safeDay,
        expectedAmount: Math.max(0, expectedAmount || 0),
        isActive: true
      });
      s.billOccurrences.push({
        id: this.#allocId(),
        fixedBillId: billId,
        yearMonth: ymStr,
        dueDateMillis: dueDateMillisForMonth(ymStr, safeDay),
        amount: null,
        status: BillStatus.PENDING,
        paidAt: null,
        expenseId: null
      });
    });
  }

  updateFixedBill(billId, { name, tagId, dueDay, expectedAmount }) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      const oldBill = s.fixedBills.find((b) => b.id === billId);
      if (!oldBill) return;
      const safeDay = Math.max(1, Math.min(31, Number(dueDay) || 1));
      s.fixedBills = s.fixedBills.map((b) =>
        b.id === billId
          ? { ...b, name: (name || '').trim() || b.name, tagId, dueDay: safeDay, expectedAmount: Math.max(0, expectedAmount || 0) }
          : b
      );
      const dueMillis = dueDateMillisForMonth(ymStr, safeDay);
      s.billOccurrences = s.billOccurrences.map((o) =>
        o.fixedBillId === billId && o.yearMonth === ymStr
          ? { ...o, dueDateMillis: dueMillis, amount: o.status === BillStatus.PENDING && o.amount === oldBill.expectedAmount ? null : o.amount }
          : o
      );
    });
  }

  deactivateFixedBill(billId) {
    this.#commit((s) => {
      s.fixedBills = s.fixedBills.map((b) => (b.id === billId ? { ...b, isActive: false } : b));
    });
  }

  setOccurrenceExpectedAmount(fixedBillId, amount) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      const bill = s.fixedBills.find((b) => b.id === fixedBillId);
      if (!bill) return;
      const existing = s.billOccurrences.find((o) => o.fixedBillId === fixedBillId && o.yearMonth === ymStr);
      if (existing) {
        s.billOccurrences = s.billOccurrences.map((o) =>
          o.fixedBillId === fixedBillId && o.yearMonth === ymStr ? { ...o, amount } : o
        );
      } else {
        s.billOccurrences.push({
          id: this.#allocId(),
          fixedBillId,
          yearMonth: ymStr,
          dueDateMillis: dueDateMillisForMonth(ymStr, bill.dueDay),
          amount,
          status: BillStatus.PENDING,
          paidAt: null,
          expenseId: null
        });
      }
    });
  }

  payFixedBill(fixedBillId, { actualAmount, paymentMethod, paidAt = Date.now() }) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      const bill = s.fixedBills.find((b) => b.id === fixedBillId);
      if (!bill) return;
      const existing = s.billOccurrences.find((o) => o.fixedBillId === fixedBillId && o.yearMonth === ymStr);
      const occId = existing?.id || this.#allocId();
      if (existing?.expenseId != null) {
        s.expenses = s.expenses.filter((e) => e.id !== existing.expenseId);
      }
      const expenseId = this.#allocId();
      s.expenses.push({
        id: expenseId,
        amount: actualAmount,
        description: `${bill.name} (${ymStr})`,
        tagId: bill.tagId,
        paymentMethod,
        fundingSource: FundingSource.BALANCE,
        source: ExpenseSource.FIXED_BILL,
        spentAt: paidAt,
        billOccurrenceId: occId,
        receipts: [],
        coupon: null
      });
      const paidOcc = {
        id: occId,
        fixedBillId,
        yearMonth: ymStr,
        dueDateMillis: existing?.dueDateMillis ?? dueDateMillisForMonth(ymStr, bill.dueDay),
        amount: actualAmount,
        status: BillStatus.PAID,
        paidAt,
        expenseId
      };
      if (existing) {
        s.billOccurrences = s.billOccurrences.map((o) => (o.id === occId ? paidOcc : o));
      } else {
        s.billOccurrences.push(paidOcc);
      }
    });
  }

  undoPayFixedBill(occurrenceId) {
    this.#commit((s) => {
      const occ = s.billOccurrences.find((o) => o.id === occurrenceId);
      if (!occ) return;
      if (occ.expenseId != null) s.expenses = s.expenses.filter((e) => e.id !== occ.expenseId);
      s.billOccurrences = s.billOccurrences.map((o) =>
        o.id === occurrenceId ? { ...o, status: BillStatus.PENDING, paidAt: null, expenseId: null } : o
      );
    });
  }

  // Entradas Planejadas
  createPlannedIncome({ name, expectedDay, expectedAmount, isRecurring }) {
    const ymStr = this.selectedMonth;
    this.#commit((s) => {
      s.plannedIncomes.push({
        id: this.#allocId(),
        name: (name || '').trim() || 'Entrada planejada',
        expectedDay: Math.max(1, Math.min(31, Number(expectedDay) || 1)),
        expectedAmount: Math.max(0, expectedAmount || 0),
        yearMonth: ymStr,
        isRecurring: !!isRecurring,
        status: BillStatus.PENDING,
        receivedAmount: null,
        receivedAt: null,
        incomeFractionId: null,
        isActive: true
      });
    });
  }

  updatePlannedIncome(id, { name, expectedDay, expectedAmount, isRecurring }) {
    this.#commit((s) => {
      s.plannedIncomes = s.plannedIncomes.map((p) =>
        p.id === id
          ? {
              ...p,
              name: (name || '').trim() || p.name,
              expectedDay: Math.max(1, Math.min(31, Number(expectedDay) || 1)),
              expectedAmount: Math.max(0, expectedAmount || 0),
              isRecurring: !!isRecurring
            }
          : p
      );
    });
  }

  deletePlannedIncome(id) {
    this.#commit((s) => {
      const target = s.plannedIncomes.find((p) => p.id === id);
      if (!target) return;
      s.plannedIncomes = s.plannedIncomes
        .filter((p) => p.id !== id)
        .map((p) =>
          target.isRecurring && p.name.toLowerCase() === target.name.toLowerCase()
            ? { ...p, isActive: false, isRecurring: false }
            : p
        );
    });
  }

  receivePlannedIncome(id, { actualAmount, receivedAt = Date.now() }) {
    this.#commit((s) => {
      const target = s.plannedIncomes.find((p) => p.id === id);
      if (!target) return;
      if (target.incomeFractionId != null) {
        s.incomes = s.incomes.filter((i) => i.id !== target.incomeFractionId);
      }
      const incId = this.#allocId();
      s.incomes.push({ id: incId, amount: actualAmount, description: target.name, receivedAt });
      s.plannedIncomes = s.plannedIncomes.map((p) =>
        p.id === id ? { ...p, status: BillStatus.PAID, receivedAmount: actualAmount, receivedAt, incomeFractionId: incId } : p
      );
    });
  }

  undoReceivePlannedIncome(id) {
    this.#commit((s) => {
      const target = s.plannedIncomes.find((p) => p.id === id);
      if (!target) return;
      const incId = target.incomeFractionId;
      if (incId != null) {
        s.incomes = s.incomes.filter((i) => i.id !== incId);
        s.reserveMovements = s.reserveMovements.filter((m) => m.incomeFractionId !== incId);
        s.goalContributions = s.goalContributions.filter((c) => c.incomeFractionId !== incId);
      }
      s.plannedIncomes = s.plannedIncomes.map((p) =>
        p.id === id ? { ...p, status: BillStatus.PENDING, receivedAmount: null, receivedAt: null, incomeFractionId: null } : p
      );
    });
  }

  // Configurações & Backup
  updateSettings({ monthlyIncomeGoal, reserveTargetMode, reserveTargetValue, creditCardDueDay, anomalySigmaThreshold }) {
    this.#commit((s) => {
      s.settings = {
        ...s.settings,
        monthlyIncomeGoal: Math.max(0, monthlyIncomeGoal || 0),
        reserveTargetMode,
        reserveTargetValue: Math.max(0, reserveTargetValue || 0),
        creditCardDueDay: Math.max(1, Math.min(31, Number(creditCardDueDay) || 10)),
        anomalySigmaThreshold: Math.max(0.5, Math.min(4.0, Number(anomalySigmaThreshold) || 1.5))
      };
    });
  }

  exportBackupJson() {
    return JSON.stringify(this.snapshot, null, 2);
  }

  importBackupJson(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tags)) {
      throw new Error('Arquivo de backup inválido.');
    }
    const base = createEmptySnapshot();
    this.snapshot = {
      ...base,
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
    };
    this.#saveRaw(this.snapshot);
    this.ensureOccurrences(this.selectedMonth, { notify: false });
    this.#notify();
  }

  clearAllUserData() {
    this.snapshot = createEmptySnapshot();
    this.#saveRaw(this.snapshot);
    clearAllReceipts();
    this.#notify();
  }
}
