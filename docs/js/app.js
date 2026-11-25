import {
  BillStatus,
  EXTRA_CATEGORIES,
  ExpenseSource,
  ExtraCategoryType,
  FundingSource,
  PaymentMethod,
  ReserveMovementType,
  ReserveTargetMode,
  TAG_COLOR_PALETTE,
  TAG_TYPE_LABELS,
  TagType,
  currentYearMonth,
  formatBrl,
  formatCompactBrl,
  formatDateBr,
  formatDateTimeBr,
  formatInputNumber,
  formatPercent,
  formatYearMonthBr,
  parseBrOrIsoDateMillis,
  parseBrlInput,
  stepYearMonth,
  suggestReserveFromIncome,
  toIsoInputDate
} from './engine.js';
import {
  getReceiptObjectUrl,
  saveReceiptBlob,
  shareOrDownloadReceipt
} from './receipts-db.js';
import { FinanceStore } from './storage.js';

const TABS = [
  { id: 'HOME', label: 'Início', icon: '⌂' },
  { id: 'TRANSACTIONS', label: 'Extrato', icon: '☰' },
  { id: 'EXTRAS', label: 'Extras', icon: '🛠' },
  { id: 'BUDGET', label: 'Orçamento', icon: '▤' },
  { id: 'GOALS', label: 'Reserva', icon: '◈' },
  { id: 'REPORTS', label: 'Relatórios', icon: '▥' }
];

const store = new FinanceStore();

const state = {
  tab: 'HOME',
  fabExpanded: false,
  iosBannerDismissed: false,
  // Dashboard week selection
  selectedWeekNumber: null,
  showWeekExpenses: false,
  // Transactions filters
  txFilter: 'ALL',
  txTagId: null,
  txWeekNumber: null,
  txQuery: '',
  // Extras filters
  extraFilter: 'ALL',
  // Reports week expand
  expandedReportWeek: null
};

const dom = {
  sideRail: document.getElementById('sideRail'),
  bottomNav: document.getElementById('bottomNav'),
  lblMonthTitle: document.getElementById('lblMonthTitle'),
  mainContent: document.getElementById('mainContent'),
  fabScrim: document.getElementById('fabScrim'),
  fabMenu: document.getElementById('fabMenu'),
  fabMain: document.getElementById('fabMain'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalSheet: document.getElementById('modalSheet'),
  subModalSheet: document.getElementById('subModalSheet'),
  toastHost: document.getElementById('toastHost')
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
function showToast(msg) {
  dom.toastHost.textContent = msg;
  dom.toastHost.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toastHost.classList.add('hidden'), 2800);
}

function setFabExpanded(expanded) {
  state.fabExpanded = expanded;
  dom.fabMenu.classList.toggle('hidden', !expanded);
  dom.fabScrim.classList.toggle('hidden', !expanded);
  dom.fabMain.textContent = expanded ? '×' : '+';
}

function switchTab(tabId) {
  state.tab = tabId;
  setFabExpanded(false);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeModal() {
  dom.modalBackdrop.classList.add('hidden');
  dom.modalSheet.classList.remove('hidden');
  dom.modalSheet.innerHTML = '';
  dom.subModalSheet.classList.add('hidden');
  dom.subModalSheet.innerHTML = '';
}

function closeSubModal() {
  dom.subModalSheet.classList.add('hidden');
  dom.subModalSheet.innerHTML = '';
  dom.modalSheet.classList.remove('hidden');
}

function openSubModalHtml(html, onReady) {
  dom.modalSheet.classList.add('hidden');
  dom.subModalSheet.innerHTML = html;
  dom.subModalSheet.classList.remove('hidden');
  dom.subModalSheet.querySelectorAll('[data-close-submodal]').forEach((btn) => {
    btn.addEventListener('click', closeSubModal);
  });
  if (onReady) onReady(dom.subModalSheet);
}

function openModalHtml(html, onReady) {
  dom.modalSheet.innerHTML = html;
  dom.modalBackdrop.classList.remove('hidden');
  dom.modalSheet.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });
  if (onReady) onReady(dom.modalSheet);
}

function openConfirmDelete({ title, message, confirmLabel = 'Excluir', onConfirm }) {
  openModalHtml(`
    <div class="row-between">
      <div class="title-md">${esc(title)}</div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <p class="muted" style="margin:0">${esc(message)}</p>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
      <button class="btn btn-danger" type="button" id="btnConfirmDel">${esc(confirmLabel)}</button>
    </div>
  `, (sheet) => {
    sheet.querySelector('#btnConfirmDel').addEventListener('click', () => {
      closeModal();
      onConfirm();
    });
  });
}

// ============================================================
// Gráficos SVG inline
// ============================================================

function renderDonutSvg(slices, centerTitle, centerValue) {
  const nonZero = slices.filter((s) => s.amount > 0);
  const total = nonZero.reduce((sum, s) => sum + s.amount, 0);
  const size = 136;
  const cx = size / 2;
  const cy = size / 2;
  const r = 52;
  const circ = 2 * Math.PI * r;

  if (total <= 0 || nonZero.length === 0) {
    return `
      <div style="text-align:center">
        <div class="donut-svg-box" style="margin:0 auto">
          <svg viewBox="0 0 ${size} ${size}" width="100%" height="100%">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="20"/>
          </svg>
          <div class="donut-center">
            <span class="small muted">${esc(centerTitle)}</span>
            <strong style="font-size:13px">${esc(centerValue)}</strong>
          </div>
        </div>
        <div class="muted small" style="margin-top:6px">Sem lançamentos no período</div>
      </div>
    `;
  }

  const gap = nonZero.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = nonZero.map((slice) => {
    const len = (slice.amount / total) * circ;
    const drawLen = Math.max(2, len - gap);
    const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${esc(slice.color)}" stroke-width="20" stroke-dasharray="${drawLen.toFixed(2)} ${(circ - drawLen).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`;
    offset += len;
    return circle;
  }).join('');

  const legend = nonZero.slice(0, 6).map((s) => `
    <div class="legend-item">
      <div class="row" style="min-width:0;flex:1">
        <span class="badge-dot" style="background:${esc(s.color)};flex-shrink:0"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label)}</span>
      </div>
      <strong>${esc(formatBrl(s.amount))} (${esc(formatPercent(s.amount / total, 0))})</strong>
    </div>
  `).join('');

  return `
    <div class="donut-wrap">
      <div class="donut-svg-box">
        <svg viewBox="0 0 ${size} ${size}" width="100%" height="100%">${arcs}</svg>
        <div class="donut-center">
          <span class="small muted">${esc(centerTitle)}</span>
          <strong style="font-size:12.5px">${esc(centerValue)}</strong>
        </div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

function renderGroupedBarsSvg(bars) {
  const maxVal = Math.max(1, ...bars.flatMap((b) => [b.incomeTotal, b.familyExpenseTotal]));
  const w = 360;
  const h = 148;
  const groupW = w / bars.length;
  const barW = Math.min(18, Math.max(8, groupW * 0.28));
  const gap = 4;

  const gridLines = [0, 0.33, 0.66, 1].map((ratio) => {
    const y = (h - 22) * ratio + 4;
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
  }).join('');

  const rects = bars.map((pair, idx) => {
    const center = groupW * idx + groupW / 2;
    const maxBarH = h - 26;
    const h1 = Math.max(0, (pair.incomeTotal / maxVal) * maxBarH);
    const h2 = Math.max(0, (pair.familyExpenseTotal / maxVal) * maxBarH);
    const baseY = h - 20;
    return `
      ${h1 > 0 ? `<rect x="${(center - barW - gap / 2).toFixed(1)}" y="${(baseY - h1).toFixed(1)}" width="${barW}" height="${h1.toFixed(1)}" rx="4" fill="var(--income)" />` : ''}
      ${h2 > 0 ? `<rect x="${(center + gap / 2).toFixed(1)}" y="${(baseY - h2).toFixed(1)}" width="${barW}" height="${h2.toFixed(1)}" rx="4" fill="var(--expense)" />` : ''}
      <text x="${center.toFixed(1)}" y="${h - 4}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${esc(pair.label)}</text>
    `;
  }).join('');

  return `
    <div class="row-between small muted">
      <div class="row">
        <span class="row"><span class="badge-dot" style="background:var(--income)"></span> Entradas</span>
        <span class="row"><span class="badge-dot" style="background:var(--expense)"></span> Saídas (Família)</span>
      </div>
      <span>Topo: ${esc(formatCompactBrl(maxVal))}</span>
    </div>
    <svg class="bar-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${gridLines}${rects}</svg>
  `;
}

// ============================================================
// Renderização de Itens & Badges de Comprovante/Cupom
// ============================================================

function renderReceiptsAndCouponRow(receipts = [], coupon = null, refType, refId) {
  if ((!receipts || receipts.length === 0) && !coupon) return '';
  const recPills = (receipts || []).map((r, idx) => `
    <button class="attach-pill receipt" type="button" data-open-receipt="${esc(refType)}:${refId}:${idx}">
      📎 Comprovante: ${esc(r.relativePath)}
    </button>
  `).join('');
  const cpPill = coupon ? `
    <button class="attach-pill coupon" type="button" data-open-coupon="${esc(refType)}:${refId}">
      🧾 Cupom ${esc(coupon.storeOrSupplier || 'Compra')} · ${coupon.items?.length || 0} itens (${esc(formatBrl(couponItemsTotal(coupon)))})
    </button>
  ` : '';
  return `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${recPills}${cpPill}</div>`;
}

function couponItemsTotal(coupon) {
  if (!coupon || !coupon.items) return 0;
  return coupon.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
}

function renderIncomeCard(income) {
  return `
    <div class="record-card">
      <div class="row-between">
        <div class="flex-1">
          <div class="record-title">${esc(income.description)}</div>
          <div class="muted small">Entrada · ${esc(formatDateBr(income.receivedAt))}</div>
        </div>
        <strong class="c-income">+ ${esc(formatBrl(income.amount))}</strong>
        <button class="btn-text btn-sm" type="button" data-edit-income="${income.id}" title="Editar">✎</button>
        <button class="btn-text btn-sm c-expense" type="button" data-del-income="${income.id}" title="Excluir">🗑</button>
      </div>
    </div>
  `;
}

function renderExpenseCard(record) {
  const exp = record.expense;
  const tag = record.tag;
  const subParts = [
    formatDateBr(exp.spentAt),
    exp.paymentMethod === PaymentMethod.CREDIT_CARD ? 'Crédito' : 'Pix/Débito'
  ];
  if (exp.fundingSource === FundingSource.RESERVE) subParts.push('Via Reserva');
  if (exp.source === ExpenseSource.FIXED_BILL) subParts.push('Conta Fixa');

  return `
    <div class="record-card">
      <div class="row-between">
        <div class="flex-1">
          <div class="record-title">${esc(exp.description)}</div>
          <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:3px">
            <span class="badge" style="background:${esc(tag?.colorHex || '#059669')}22;color:${esc(tag?.colorHex || '#059669')}">
              <span class="badge-dot" style="background:${esc(tag?.colorHex || '#059669')}"></span>
              ${esc(tag?.name || 'Etiqueta')}
            </span>
            <span class="muted small">${esc(subParts.join(' · '))}</span>
          </div>
        </div>
        <strong class="c-expense">- ${esc(formatBrl(exp.amount))}</strong>
        <button class="btn-text btn-sm" type="button" data-edit-expense="${exp.id}" title="Editar">✎</button>
        <button class="btn-text btn-sm c-expense" type="button" data-del-expense="${exp.id}" title="Excluir">🗑</button>
      </div>
      ${renderReceiptsAndCouponRow(exp.receipts, exp.coupon, 'exp', exp.id)}
    </div>
  `;
}

function renderExtraCard(item) {
  const cat = EXTRA_CATEGORIES[item.categoryType] || EXTRA_CATEGORIES.OTHER_EXTRA;
  const methodLabel = item.paymentMethod === PaymentMethod.CREDIT_CARD
    ? 'Crédito'
    : item.fundingSource === FundingSource.RESERVE
      ? 'Via Reserva'
      : 'Pix/Débito';

  return `
    <div class="record-card">
      <div class="row-between">
        <div class="flex-1">
          <div class="record-title">${esc(item.description)}</div>
          <div class="muted small">
            ${esc(formatDateBr(item.spentAt))} · ${esc(formatInputNumber(item.quantity) || '1')} ${esc(item.unit)} × ${esc(formatBrl(item.unitPrice))}${item.supplierOrPerson ? ` · ${esc(item.supplierOrPerson)}` : ''}
          </div>
        </div>
        <strong class="c-expense">- ${esc(formatBrl(item.amount))}</strong>
        <button class="btn-text btn-sm" type="button" data-edit-extra="${item.id}" title="Editar">✎</button>
        <button class="btn-text btn-sm c-expense" type="button" data-del-extra="${item.id}" title="Excluir">🗑</button>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <span class="badge" style="background:${esc(cat.colorHex)}22;color:${esc(cat.colorHex)}">${esc(cat.shortLabel)}</span>
        ${item.projectName ? `<span class="badge" style="background:var(--surface-2)">${esc(item.projectName)}</span>` : ''}
        <span class="muted small">${esc(methodLabel)}</span>
      </div>
      ${renderReceiptsAndCouponRow(item.receipts, item.coupon, 'ext', item.id)}
    </div>
  `;
}

function renderPlannedIncomeCard(status) {
  const item = status.item;
  const isPaid = item.status === BillStatus.PAID;
  let dueInfo = 'Recebido';
  if (!isPaid) {
    if (status.daysUntilExpected < 0) dueInfo = `Atrasada há ${-status.daysUntilExpected}d`;
    else if (status.daysUntilExpected === 0) dueInfo = 'Prevista para HOJE';
    else if (status.daysUntilExpected === 1) dueInfo = 'Prevista para amanhã';
    else dueInfo = `Em ${status.daysUntilExpected} dias`;
  }
  return `
    <div class="record-card" style="${isPaid ? 'background:rgba(22,163,74,0.08)' : ''}">
      <div class="row-between">
        <div class="flex-1">
          <div class="record-title">${esc(item.name)}</div>
          <div class="muted small">Prevista: ${esc(formatDateBr(status.expectedDateMillis))} · ${esc(dueInfo)}${item.isRecurring ? ' · Mensal' : ''}</div>
        </div>
        <strong class="c-income">${esc(formatBrl(status.effectiveAmount))}</strong>
        <button class="btn-text btn-sm" type="button" data-edit-planned="${item.id}">✎</button>
        <button class="btn-text btn-sm c-expense" type="button" data-del-planned="${item.id}">🗑</button>
      </div>
      <div class="row-between">
        ${isPaid
          ? `<span class="c-income small">✓ Recebida em ${esc(item.receivedAt ? formatDateBr(item.receivedAt) : '-')}</span>
             <button class="btn btn-outline btn-sm" type="button" data-undo-planned="${item.id}">Desfazer</button>`
          : `<span class="muted small">A receber</span>
             <button class="btn btn-income btn-sm" type="button" data-recv-planned="${item.id}">✓ Confirmar Recebimento</button>`
        }
      </div>
    </div>
  `;
}

// ============================================================
// Abas
// ============================================================

function renderIosInstallBanner() {
  if (state.iosBannerDismissed) return '';
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (!isIos || isStandalone) return '';
  return `
    <div class="card ios-install-banner">
      <div class="row-between">
        <strong>📲 Instalar no iPhone (Tela de Início)</strong>
        <button class="btn-text btn-sm" type="button" id="btnDismissIosTip">Fechar</button>
      </div>
      <div class="small">
        No Safari, toque em <strong>Compartilhar (↑)</strong> na barra inferior e escolha <strong>Adicionar à Tela de Início</strong> para usar em tela cheia, offline e sem computador.
      </div>
    </div>
  `;
}

function renderHome(ov) {
  const activeWeekNum = state.selectedWeekNumber ?? ov.currentWeek.week.weekNumber;
  const selectedWeek = ov.weeksOfMonth.find((w) => w.week.weekNumber === activeWeekNum) || ov.currentWeek;
  const selWeekCount = selectedWeek.expenses.length + selectedWeek.extraExpenses.length;

  const incomeRatio = ov.incomeProjection.monthlyGoal > 0
    ? Math.min(1, ov.incomeProjection.receivedInMonth / ov.incomeProjection.monthlyGoal)
    : 0;
  const weekRatio = ov.currentWeek.weeklyLimit > 0
    ? Math.min(1, ov.currentWeek.spentInWeek / ov.currentWeek.weeklyLimit)
    : (ov.currentWeek.spentInWeek > 0 ? 1 : 0);

  const urgentBills = ov.fixedBills.filter((b) => b.status === BillStatus.PENDING && b.daysUntilDue <= 5);
  const cardDays = Math.round((ov.creditCard.dueDateMillis - new Date().setHours(12, 0, 0, 0)) / 86400000);
  const cardAlert = !ov.creditCard.isPaid && ov.creditCard.effectiveTotal > 0 && cardDays <= 5;

  const homeSlices = ov.donutSlices.map((s) => ({
    label: s.tag.name,
    amount: s.spentMonth,
    color: s.tag.colorHex
  }));
  if (ov.extraordinary.monthTotal > 0) {
    homeSlices.push({ label: 'Extraordinárias', amount: ov.extraordinary.monthTotal, color: '#EA580C' });
  }

  return `
    ${renderIosInstallBanner()}

    <div class="card hero">
      <div class="row">
        <span>💼</span>
        <span class="title-md">Saldo Real em Mãos</span>
      </div>
      <div class="big-value ${ov.cashInHand < 0 ? 'c-expense' : ''}">${esc(formatBrl(ov.cashInHand))}</div>
      <div class="small muted">Disponível livre agora (já descontando Reserva, Caixinhas e Extras pagos do saldo).</div>
      <div class="grid-2">
        <div class="mini-pill">
          <span class="mp-label">🛡 Reserva (Intocável)</span>
          <span class="mp-val c-reserve">${esc(formatBrl(ov.reserveBalance))}</span>
        </div>
        <div class="mini-pill">
          <span class="mp-label">🎯 Em Planejados</span>
          <span class="mp-val c-goal">${esc(formatBrl(ov.goalsTotalBalance))}</span>
        </div>
      </div>
    </div>

    <div class="grid-3">
      <button class="btn btn-tonal" type="button" id="btnQuickIncome">↓ Entrada</button>
      <button class="btn btn-tonal" type="button" id="btnQuickExpense">↑ Gasto</button>
      <button class="btn btn-tonal" type="button" data-go-tab="GOALS">🛡 Reserva</button>
    </div>

    <div class="card">
      <div class="row-between">
        <div>
          <div class="title-md">Despesa Total da Família</div>
          <div class="muted small">Casa: ${esc(formatBrl(ov.monthTotalExpenses))} · Extraordinárias: ${esc(formatBrl(ov.extraordinary.monthTotal))}</div>
        </div>
        <div class="med-value c-expense">${esc(formatBrl(ov.monthFamilyTotalExpenses))}</div>
      </div>
      <div class="row-between">
        <span class="muted small">${ov.extraordinary.expensesInMonth.length} lançamentos extras · ${ov.extraordinary.totalReceiptsCount} comprovantes</span>
        <button class="btn-text btn-sm" type="button" data-go-tab="EXTRAS">🛠 Abrir Extras</button>
      </div>
    </div>

    <div class="card">
      <div class="row-between">
        <span class="title-md">Renda Fracionada vs. Meta</span>
        <strong class="c-income small">${esc(formatBrl(ov.incomeProjection.receivedInMonth))} / ${esc(formatBrl(ov.incomeProjection.monthlyGoal))}</strong>
      </div>
      <div class="prog-track"><div class="prog-fill" style="width:${(incomeRatio * 100).toFixed(1)}%;background:var(--income)"></div></div>
      ${ov.pendingPlannedIncomesTotal > 0 ? `<div class="c-income small"><strong>A receber (planejado): + ${esc(formatBrl(ov.pendingPlannedIncomesTotal))} · Previsto: ${esc(formatBrl(ov.incomeProjection.receivedInMonth + ov.pendingPlannedIncomesTotal))}</strong></div>` : ''}
      <div class="muted small">
        ${ov.incomeProjection.historyStats.count >= 2
          ? `Previsão conservadora: ${esc(formatBrl(ov.incomeProjection.projectedTotal))} · Faixa (σ): ${esc(formatBrl(ov.incomeProjection.expectedMinTotal))} a ${esc(formatBrl(ov.incomeProjection.expectedMaxTotal))}`
          : `Falta receber ${esc(formatBrl(ov.incomeProjection.remainingToGoal))} para atingir sua meta mensal.`}
      </div>
    </div>

    <div class="card">
      <div class="row-between">
        <div class="flex-1">
          <div class="title-md">${esc(ov.currentWeek.week.label)} · Orçamento Semanal</div>
          <div class="muted small">Variáveis: ${esc(formatBrl(ov.currentWeek.spentInWeek))} de ${esc(formatBrl(ov.currentWeek.weeklyLimit))}</div>
        </div>
        <div style="text-align:right">
          <div class="muted small">${ov.currentWeek.remainingInWeek >= 0 ? 'Ainda pode gastar' : 'Acima do limite'}</div>
          <div class="med-value ${ov.currentWeek.remainingInWeek >= 0 ? 'c-income' : 'c-expense'}">${esc(formatBrl(ov.currentWeek.remainingInWeek))}</div>
        </div>
      </div>
      <div class="prog-track"><div class="prog-fill" style="width:${(weekRatio * 100).toFixed(1)}%;background:var(--primary)"></div></div>
      <div class="muted small">Guardado p/ próximas semanas: ${esc(formatBrl(ov.reservedForFutureWeeks))} (Saldo Real: ${esc(formatBrl(ov.cashInHand))}).</div>

      <div class="c-primary small"><strong>Gastos por Semana (toque em S1..S5 para detalhar):</strong></div>
      <div class="weeks-strip">
        ${ov.weeksOfMonth.map((w) => {
          const isSel = w.week.weekNumber === selectedWeek.week.weekNumber;
          const valLabel = (window.innerWidth < 380 || w.totalSpentInWeek >= 1000)
            ? formatCompactBrl(w.totalSpentInWeek)
            : formatBrl(w.totalSpentInWeek);
          return `
            <button class="week-pill ${w.isCurrentWeek ? 'current' : ''} ${isSel ? 'selected' : ''}" type="button" data-select-week="${w.week.weekNumber}">
              <span>S${w.week.weekNumber}</span>
              <span style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${esc(valLabel)}</span>
            </button>
          `;
        }).join('')}
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:2px 0"/>
      <div class="row-between">
        <strong>${esc(selectedWeek.week.label)} (${selWeekCount} gastos)</strong>
        <strong class="c-expense">Total: ${esc(formatBrl(selectedWeek.totalSpentInWeek))}</strong>
      </div>
      <div class="muted small">
        Variáveis: ${esc(formatBrl(selectedWeek.spentInWeek))} · Fixos: ${esc(formatBrl(selectedWeek.fixedSpentInWeek))} · Extras: ${esc(formatBrl(selectedWeek.extraSpentInWeek))} · Entradas: ${esc(formatBrl(selectedWeek.incomesInWeek))}
      </div>
      ${selWeekCount > 0 ? `<button class="btn-text btn-sm" style="align-self:flex-start;padding-left:0" type="button" id="btnToggleWeekItems">${state.showWeekExpenses ? `Ocultar gastos da ${esc(selectedWeek.week.label)}` : `Ver os ${selWeekCount} gastos da ${esc(selectedWeek.week.label)}`}</button>` : ''}
      ${state.showWeekExpenses ? `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${selectedWeek.expenses.map(renderExpenseCard).join('')}
          ${selectedWeek.extraExpenses.map(renderExtraCard).join('')}
        </div>
      ` : ''}
    </div>

    <div class="section-head">
      <h2>Entradas Planejadas (${ov.plannedIncomes.length})</h2>
      <button class="btn-text btn-sm" type="button" id="btnAddPlannedIncome">+ Planejar Entrada</button>
    </div>
    ${ov.plannedIncomes.length === 0
      ? `<div class="empty-state"><strong>Nenhuma entrada planejada</strong><div class="small">Agende salários, parcelas ou freelas previstos no mês.</div></div>`
      : ov.plannedIncomes.map(renderPlannedIncomeCard).join('')}

    ${(urgentBills.length > 0 || cardAlert || ov.anomalyAlerts.length > 0) ? `
      <div class="card warn-card">
        <strong class="c-warn">⚠ Alertas Rápidos</strong>
        ${urgentBills.map((b) => `<div class="small">• ${esc(b.bill.name)}: ${b.daysUntilDue < 0 ? `Venceu há ${-b.daysUntilDue}d` : b.daysUntilDue === 0 ? 'Vence HOJE' : `Vence em ${b.daysUntilDue}d`} · ${esc(formatBrl(b.currentAmount))}</div>`).join('')}
        ${cardAlert ? `<div class="small">• Fatura Cartão: ${cardDays < 0 ? `Venceu há ${-cardDays}d` : cardDays === 0 ? 'Vence HOJE' : `Vence em ${cardDays}d`} · ${esc(formatBrl(ov.creditCard.effectiveTotal))}</div>` : ''}
        ${ov.anomalyAlerts.map((a) => `<div class="small"><strong>• ${esc(a)}</strong></div>`).join('')}
        <div class="row">
          ${urgentBills.length > 0 ? `<button class="btn btn-tonal btn-sm" type="button" data-go-tab="REPORTS">Dar baixa em Contas</button>` : ''}
          ${cardAlert ? `<button class="btn btn-tonal btn-sm" type="button" data-go-tab="BUDGET">Ver Fatura</button>` : ''}
        </div>
      </div>
    ` : ''}

    <div class="card">
      <div class="row-between">
        <span class="title-md">Para onde o dinheiro está indo</span>
        <button class="btn-text btn-sm" type="button" data-go-tab="BUDGET">Ver tetos</button>
      </div>
      ${renderDonutSvg(homeSlices, ov.extraordinary.monthTotal > 0 ? 'Família mês' : 'Gastos mês', formatBrl(ov.monthFamilyTotalExpenses))}
    </div>

    <div class="section-head">
      <h2>Entradas Fracionadas (${ov.recentIncomes.length})</h2>
      <button class="btn-text btn-sm" type="button" data-open-income>+ Entrada</button>
    </div>
    ${ov.recentIncomes.length === 0
      ? `<div class="empty-state"><strong>Nenhuma entrada registrada</strong><div class="small">Toque em + Entrada para lançar sua primeira fração recebida.</div></div>`
      : ov.recentIncomes.slice(0, 5).map(renderIncomeCard).join('')}

    <div class="section-head">
      <h2>Gastos do Mês (${ov.recentExpenses.length})</h2>
      <button class="btn-text btn-sm" type="button" data-open-expense>+ Gasto</button>
    </div>
    ${ov.recentExpenses.length === 0
      ? `<div class="empty-state"><strong>Nenhum gasto no mês</strong><div class="small">Toque em + Gasto para lançar suas despesas.</div></div>`
      : ov.recentExpenses.slice(0, 8).map(renderExpenseCard).join('')}

    <button class="btn btn-outline" type="button" data-go-tab="TRANSACTIONS">
      Ver todos e filtrar no Extrato (${ov.recentIncomes.length + ov.recentExpenses.length + ov.extraordinary.expensesInMonth.length})
    </button>
  `;
}

function buildFilteredTransactions(ov) {
  const q = state.txQuery.trim().toLowerCase();
  const selWeek = state.txWeekNumber != null
    ? ov.weeksOfMonth.find((w) => w.week.weekNumber === state.txWeekNumber)
    : null;

  const incOk = state.txFilter === 'ALL' || state.txFilter === 'INCOMES';
  const expOk = state.txFilter === 'ALL' || state.txFilter === 'EXPENSES';
  const extOk = state.txFilter === 'ALL' || state.txFilter === 'EXPENSES' || state.txFilter === 'EXTRA';

  const entries = [];
  if (incOk && state.txTagId == null) {
    for (const inc of ov.recentIncomes) {
      if (selWeek && (inc.receivedAt < selWeek.week.startMillis || inc.receivedAt > selWeek.week.endMillis)) continue;
      if (q) {
        const hay = `${inc.description} ${formatDateBr(inc.receivedAt)} ${formatBrl(inc.amount)} ${formatInputNumber(inc.amount)}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      entries.push({ kind: 'INCOME', ts: inc.receivedAt, data: inc });
    }
  }
  if (expOk) {
    for (const rec of ov.recentExpenses) {
      const e = rec.expense;
      if (selWeek && (e.spentAt < selWeek.week.startMillis || e.spentAt > selWeek.week.endMillis)) continue;
      if (state.txTagId != null && e.tagId !== state.txTagId) continue;
      if (q) {
        const hay = `${e.description} ${rec.tag?.name || ''} ${formatDateBr(e.spentAt)} ${formatBrl(e.amount)} ${formatInputNumber(e.amount)} ${e.paymentMethod === PaymentMethod.CREDIT_CARD ? 'credito cartao' : 'pix dinheiro debito'}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      entries.push({ kind: 'EXPENSE', ts: e.spentAt, data: rec });
    }
  }
  if (extOk && (state.txFilter === 'EXTRA' || state.txTagId == null)) {
    for (const ext of ov.extraordinary.expensesInMonth) {
      if (selWeek && (ext.spentAt < selWeek.week.startMillis || ext.spentAt > selWeek.week.endMillis)) continue;
      if (q) {
        const cat = EXTRA_CATEGORIES[ext.categoryType]?.shortLabel || '';
        const hay = `${ext.description} ${cat} ${ext.supplierOrPerson} ${ext.projectName} ${formatDateBr(ext.spentAt)} ${formatBrl(ext.amount)} ${ext.coupon?.storeOrSupplier || ''} extraordinaria extra`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      entries.push({ kind: 'EXTRA', ts: ext.spentAt, data: ext });
    }
  }
  entries.sort((a, b) => b.ts - a.ts);
  return { entries, selWeek };
}

function renderTransactionsResultsHtml(ov) {
  const { entries, selWeek } = buildFilteredTransactions(ov);
  const totalOutCount = ov.recentExpenses.length + ov.extraordinary.expensesInMonth.length;
  const hasFilters = state.txTagId != null || state.txWeekNumber != null || state.txQuery.trim() !== '' || state.txFilter !== 'ALL';

  return `
    ${selWeek ? `<div class="c-primary small"><strong>${esc(selWeek.week.label)} · Total: ${esc(formatBrl(selWeek.totalSpentInWeek))} (Var: ${esc(formatBrl(selWeek.spentInWeek))} · Fixos: ${esc(formatBrl(selWeek.fixedSpentInWeek))} · Extras: ${esc(formatBrl(selWeek.extraSpentInWeek))}) · Entradas: ${esc(formatBrl(selWeek.incomesInWeek))}</strong></div>` : ''}
    <div class="section-head">
      <h2>Lançamentos (${entries.length})</h2>
      ${hasFilters ? `<button class="btn-text btn-sm" type="button" id="btnClearTxFilters">Limpar filtros</button>` : ''}
    </div>
    ${entries.length === 0
      ? `<div class="empty-state"><strong>${(ov.recentIncomes.length + totalOutCount) > 0 ? 'Nenhum lançamento corresponde ao filtro' : 'Nenhuma movimentação no mês'}</strong><div class="small">Lance entradas ou saídas para acompanhar tudo por aqui.</div></div>`
      : entries.map((e) => e.kind === 'INCOME' ? renderIncomeCard(e.data) : e.kind === 'EXPENSE' ? renderExpenseCard(e.data) : renderExtraCard(e.data)).join('')}
  `;
}

function renderTransactions(ov) {
  const monthInc = ov.incomeProjection.receivedInMonth;
  const monthOut = ov.monthFamilyTotalExpenses;
  const net = monthInc - monthOut;
  const totalOutCount = ov.recentExpenses.length + ov.extraordinary.expensesInMonth.length;
  const totalAll = ov.recentIncomes.length + totalOutCount;
  const tags = ov.tagStatuses.map((s) => s.tag);

  return `
    <div class="card soft">
      <div class="title-md">Entradas e Saídas do Mês</div>
      <div class="grid-3">
        <div>
          <div class="muted small">Entradas (${ov.recentIncomes.length})</div>
          <strong class="c-income">+ ${esc(formatBrl(monthInc))}</strong>
        </div>
        <div style="text-align:center">
          <div class="muted small">Família (${totalOutCount})</div>
          <strong class="c-expense">- ${esc(formatBrl(monthOut))}</strong>
        </div>
        <div style="text-align:right">
          <div class="muted small">Saldo mês</div>
          <strong class="${net >= 0 ? 'c-income' : 'c-expense'}">${esc(formatBrl(net))}</strong>
        </div>
      </div>
      <div class="muted small">Família (Casa + Extras): Casa ${esc(formatBrl(ov.monthTotalExpenses))} + Extras ${esc(formatBrl(ov.extraordinary.monthTotal))}</div>
      <div class="grid-2">
        <button class="btn btn-income" type="button" data-open-income>↓ Nova Entrada</button>
        <button class="btn btn-tonal" type="button" data-open-expense>↑ Novo Gasto</button>
      </div>
    </div>

    <input class="input-field" id="txSearchInput" type="search" value="${esc(state.txQuery)}" placeholder="Buscar por descrição, etiqueta, fornecedor ou valor..." />

    <div class="chips-row">
      <button class="chip ${state.txFilter === 'ALL' ? 'selected' : ''}" type="button" data-tx-filter="ALL">Todos (${totalAll})</button>
      <button class="chip ${state.txFilter === 'INCOMES' ? 'selected' : ''}" type="button" data-tx-filter="INCOMES">Entradas (${ov.recentIncomes.length})</button>
      <button class="chip ${state.txFilter === 'EXPENSES' ? 'selected' : ''}" type="button" data-tx-filter="EXPENSES">Saídas (${totalOutCount})</button>
      <button class="chip ${state.txFilter === 'EXTRA' ? 'selected' : ''}" type="button" data-tx-filter="EXTRA">Extras (${ov.extraordinary.expensesInMonth.length})</button>
    </div>

    <div class="chips-row">
      <button class="chip ${state.txWeekNumber == null ? 'selected' : ''}" type="button" data-tx-week="">Todas as semanas</button>
      ${ov.weeksOfMonth.map((w) => `<button class="chip ${state.txWeekNumber === w.week.weekNumber ? 'selected' : ''}" type="button" data-tx-week="${w.week.weekNumber}">S${w.week.weekNumber} (${w.week.startDay}–${w.week.endDay}): ${esc(formatBrl(w.totalSpentInWeek))}</button>`).join('')}
    </div>

    ${state.txFilter !== 'INCOMES' && state.txFilter !== 'EXTRA' && tags.length > 0 ? `
      <div class="chips-row">
        <button class="chip ${state.txTagId == null ? 'selected' : ''}" type="button" data-tx-tag="">Todas as etiquetas</button>
        ${tags.map((t) => `<button class="chip ${state.txTagId === t.id ? 'selected' : ''}" type="button" data-tx-tag="${t.id}">${esc(t.name)}</button>`).join('')}
      </div>
    ` : ''}

    <div id="txResultsHost" style="display:flex;flex-direction:column;gap:10px">
      ${renderTransactionsResultsHtml(ov)}
    </div>
  `;
}

function renderExtras(ov) {
  const ex = ov.extraordinary;
  const filtered = ex.expensesInMonth.filter((item) => {
    if (state.extraFilter === 'MATERIAL') return item.categoryType === ExtraCategoryType.MATERIAL;
    if (state.extraFilter === 'LABOR') return item.categoryType === ExtraCategoryType.LABOR_DAILY;
    if (state.extraFilter === 'EQUIPMENT') return item.categoryType === ExtraCategoryType.EQUIPMENT_RENTAL;
    if (state.extraFilter === 'RECEIPT') return (item.receipts?.length || 0) > 0;
    if (state.extraFilter === 'COUPON') return item.coupon != null;
    return true;
  });

  const extraSlices = ex.categoryBreakdowns
    .filter((b) => b.spentMonth > 0)
    .map((b) => ({
      label: EXTRA_CATEGORIES[b.categoryType].shortLabel,
      amount: b.spentMonth,
      color: EXTRA_CATEGORIES[b.categoryType].colorHex
    }));

  const topMax = ex.topItems.length > 0 ? Math.max(1, ex.topItems[0][1]) : 1;

  return `
    <div class="card hero-extra">
      <div class="row-between">
        <div class="row"><span>🛠</span><span class="title-md">Despesas Extraordinárias</span></div>
        <button class="btn-text btn-sm" type="button" id="btnExtraCaps">⚙ Tetos</button>
      </div>
      <div class="big-value">${esc(formatBrl(ex.monthTotal))}</div>
      ${ex.monthlyCap > 0 ? `
        <div class="prog-track"><div class="prog-fill" style="width:${Math.min(100, ex.monthlyCapRatio * 100).toFixed(1)}%;background:${ex.monthlyCapRatio >= 1 ? 'var(--expense)' : 'var(--primary)'}"></div></div>
        <div class="small">Teto do mês: ${esc(formatBrl(ex.monthlyCap))} · Usado ${esc(formatPercent(ex.monthlyCapRatio, 0))} · Restam ${esc(formatBrl(ex.remainingCap))}</div>
      ` : `
        <div class="small muted">Soma automaticamente à Despesa da Família (Casa ${esc(formatBrl(ov.monthTotalExpenses))} + Extras ${esc(formatBrl(ex.monthTotal))} = ${esc(formatBrl(ov.monthFamilyTotalExpenses))}).</div>
      `}
      <div class="grid-2">
        <div class="mini-pill"><span class="mp-label">🧱 Materiais</span><span class="mp-val">${esc(formatBrl(ex.materialsTotal))}</span></div>
        <div class="mini-pill"><span class="mp-label">👷 Diárias</span><span class="mp-val">${esc(formatBrl(ex.laborDailyTotal))}</span></div>
        <div class="mini-pill"><span class="mp-label">⚙ Maquinário</span><span class="mp-val">${esc(formatBrl(ex.equipmentRentalTotal))}</span></div>
        <div class="mini-pill"><span class="mp-label">📎 Comprov. / Cupons</span><span class="mp-val">${ex.totalReceiptsCount} fotos · ${ex.totalCouponsCount} cupons</span></div>
      </div>
      <div class="small muted">📁 Pasta no app: Comprovantes/${esc(ov.selectedMonth)}/ (com link direto e exportação para Arquivos)</div>
    </div>

    <div class="grid-3">
      <button class="btn btn-primary" type="button" id="btnNewExtra">+ Despesa</button>
      <button class="btn btn-tonal" type="button" id="btnNewExtraCoupon">🧾 Cupom</button>
      <button class="btn btn-outline" type="button" id="btnNewRecurring">↻ Recorrente</button>
    </div>

    <div class="card">
      <div class="row-between">
        <span class="title-md">Gráfico Extraordinário por Categoria</span>
        <button class="btn-text btn-sm" type="button" id="btnExtraCaps2">Ajustar Tetos</button>
      </div>
      ${renderDonutSvg(extraSlices, 'Extras mês', formatBrl(ex.monthTotal))}
      ${ex.categoryBreakdowns.filter((b) => b.cap != null || b.spentMonth > 0).map((b) => {
        const cat = EXTRA_CATEGORIES[b.categoryType];
        const ratio = b.ratio != null ? Math.min(1, b.ratio) : 0;
        return `
          <div>
            <div class="row-between small">
              <strong>${esc(cat.shortLabel)} (${b.count})</strong>
              <strong class="${(b.ratio || 0) >= 1 ? 'c-expense' : ''}">${b.cap != null ? `${esc(formatBrl(b.spentMonth))} / ${esc(formatBrl(b.cap))}` : esc(formatBrl(b.spentMonth))}</strong>
            </div>
            ${b.ratio != null ? `<div class="prog-track" style="margin-top:4px;height:7px"><div class="prog-fill" style="width:${(ratio * 100).toFixed(1)}%;background:${(b.ratio || 0) >= 1 ? 'var(--expense)' : cat.colorHex}"></div></div>` : ''}
          </div>
        `;
      }).join('')}
    </div>

    ${ex.topItems.length > 0 ? `
      <div class="card">
        <div class="title-md">Maiores Itens Extraordinários</div>
        ${ex.topItems.map(([name, val]) => `
          <div>
            <div class="row-between small"><span>${esc(name)}</span><strong>${esc(formatBrl(val))}</strong></div>
            <div class="prog-track" style="margin-top:3px;height:6px"><div class="prog-fill" style="width:${((val / topMax) * 100).toFixed(1)}%;background:var(--primary)"></div></div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-head">
      <h2>Recorrentes: Diárias & Maquinário (${ex.activeRecurrings.length})</h2>
      <button class="btn-text btn-sm" type="button" id="btnNewRecurring2">+ Recorrente</button>
    </div>
    ${ex.activeRecurrings.length === 0
      ? `<div class="empty-state"><strong>Nenhum recorrente cadastrado</strong><div class="small">Cadastre diárias ou aluguéis para lançar em 1 toque.</div></div>`
      : ex.activeRecurrings.map((r) => `
          <div class="record-card">
            <div class="row-between">
              <div class="row flex-1">
                <span class="badge-dot" style="background:${esc(EXTRA_CATEGORIES[r.categoryType].colorHex)}"></span>
                <div class="flex-1" style="min-width:0">
                  <div class="record-title">${esc(r.name)}</div>
                  <div class="muted small">${esc(formatBrl(r.ratePerUnit))} / ${esc(r.unitLabel)}${r.personOrCompany ? ` · ${esc(r.personOrCompany)}` : ''}</div>
                </div>
              </div>
              <button class="btn btn-tonal btn-sm" type="button" data-launch-rec="${r.id}">▶ Lançar</button>
              <button class="btn-text btn-sm" type="button" data-edit-rec="${r.id}">✎</button>
              <button class="btn-text btn-sm c-expense" type="button" data-del-rec="${r.id}">🗑</button>
            </div>
          </div>
        `).join('')}

    <div class="section-head">
      <h2>Lançamentos Detalhados (${filtered.length})</h2>
      <button class="btn-text btn-sm" type="button" id="btnNewExtra2">+ Despesa</button>
    </div>
    <div class="chips-row">
      ${[
        ['ALL', 'Todos'],
        ['MATERIAL', 'Materiais'],
        ['LABOR', 'Diárias'],
        ['EQUIPMENT', 'Maquinário'],
        ['RECEIPT', 'Com Comprovante'],
        ['COUPON', 'Com Cupom']
      ].map(([k, lbl]) => `<button class="chip ${state.extraFilter === k ? 'selected' : ''}" type="button" data-extra-filter="${k}">${lbl}</button>`).join('')}
    </div>
    ${filtered.length === 0
      ? `<div class="empty-state"><strong>Nenhuma despesa extraordinária</strong><div class="small">Lance compras como areia, brita, cimento, diárias ou aluguéis com foto/print do comprovante.</div></div>`
      : filtered.map(renderExtraCard).join('')}
  `;
}

function renderBudget(ov) {
  const card = ov.creditCard;
  return `
    <div class="card soft">
      <div class="row-between">
        <div>
          <div class="title-md">💳 Fatura do Cartão de Crédito</div>
          <div class="muted small">Vencimento: ${esc(formatDateBr(card.dueDateMillis))} · ${card.expensesCount} compra(s) no mês</div>
        </div>
        ${card.isPaid ? '<span class="c-income">✓ Paga</span>' : ''}
      </div>
      <div class="row-between">
        <div>
          <div class="muted small">Compras acumuladas</div>
          <strong>${esc(formatBrl(card.expensesOnCardTotal))}</strong>
        </div>
        <div style="text-align:right">
          <div class="muted small">${card.isPaid ? 'Fatura paga' : 'Valor efetivo da fatura'}</div>
          <div class="med-value ${card.isPaid ? 'c-income' : 'c-primary'}">${esc(formatBrl(card.isPaid ? card.paidAmount : card.effectiveTotal))}</div>
        </div>
      </div>
      <div class="muted small">Regra anti-duplicidade: compras no cartão consomem os tetos agora e descontam do Saldo em Mãos uma única vez ao pagar a fatura.</div>
      <div class="row">
        ${card.isPaid
          ? `<button class="btn btn-outline" type="button" id="btnUndoPayCard">↺ Desfazer pagamento</button>`
          : `<button class="btn btn-outline" type="button" id="btnAdjustCard">Ajustar fatura</button>
             <button class="btn btn-primary" type="button" id="btnPayCard" ${card.effectiveTotal <= 0 ? 'disabled' : ''}>Pagar Fatura</button>`}
      </div>
    </div>

    <div class="section-head">
      <h2>Etiquetas & Tetos de Gastos</h2>
      <button class="btn-text btn-sm" type="button" id="btnCreateTag">+ Nova Etiqueta</button>
    </div>
    ${ov.tagStatuses.map((s) => `
      <div class="card">
        <div class="row-between">
          <div class="row">
            <span class="badge" style="background:${esc(s.tag.colorHex)}22;color:${esc(s.tag.colorHex)}">
              <span class="badge-dot" style="background:${esc(s.tag.colorHex)}"></span>
              ${esc(s.tag.name)}
            </span>
            <span class="muted small">${esc(TAG_TYPE_LABELS[s.tag.type] || '')}</span>
          </div>
          <div class="row">
            <button class="btn-text btn-sm" type="button" data-edit-tag="${s.tag.id}">✎</button>
            <button class="btn-text btn-sm c-expense" type="button" data-del-tag="${s.tag.id}">🗑</button>
          </div>
        </div>
        ${s.weeklyCap != null ? `
          <div class="row-between small"><strong>Semana atual: ${esc(formatBrl(s.spentCurrentWeek))} / ${esc(formatBrl(s.weeklyCap))}</strong><strong>${esc(formatPercent(s.weeklyRatio || 0, 0))}</strong></div>
          <div class="prog-track"><div class="prog-fill" style="width:${Math.min(100, (s.weeklyRatio || 0) * 100).toFixed(1)}%;background:${(s.weeklyRatio || 0) >= 1 ? 'var(--expense)' : s.tag.colorHex}"></div></div>
        ` : ''}
        ${s.monthlyCap != null ? `
          <div class="row-between small"><strong>Mês acumulado: ${esc(formatBrl(s.spentMonth))} / ${esc(formatBrl(s.monthlyCap))}</strong><strong>${esc(formatPercent(s.monthlyRatio || 0, 0))}</strong></div>
          <div class="prog-track"><div class="prog-fill" style="width:${Math.min(100, (s.monthlyRatio || 0) * 100).toFixed(1)}%;background:${(s.monthlyRatio || 0) >= 1 ? 'var(--expense)' : s.tag.colorHex}"></div></div>
        ` : `<div class="small muted">Gasto no mês: ${esc(formatBrl(s.spentMonth))} (sem teto mensal definido)</div>`}
        ${s.historicalStats ? `<div class="small ${s.isAnomalous ? 'c-warn' : 'muted'}">Histórico (${s.historicalStats.count}m): média ${esc(formatBrl(s.historicalStats.mean))} ± ${esc(formatBrl(s.historicalStats.stdDev))}${s.isAnomalous ? ' · ACIMA DO PADRÃO' : ''}</div>` : ''}
      </div>
    `).join('')}
  `;
}

function renderGoals(ov) {
  const ratio = ov.reserveSummary.monthlyTarget > 0
    ? Math.min(1, ov.reserveSummary.depositedInMonth / ov.reserveSummary.monthlyTarget)
    : 0;
  const goalMap = new Map(ov.goals.map((g) => [g.goal.id, g.goal.name]));

  return `
    <div class="card reserve-card">
      <div class="row"><strong class="c-reserve">🛡 Reserva Financeira (Intocável)</strong></div>
      <div class="big-value c-reserve">${esc(formatBrl(ov.reserveBalance))}</div>
      <div class="small">Meta do mês: ${esc(formatBrl(ov.reserveSummary.depositedInMonth))} / ${esc(formatBrl(ov.reserveSummary.monthlyTarget))} · Sugestão semana: ${esc(formatBrl(ov.reserveSummary.suggestedWeeklySeparation))}</div>
      <div class="prog-track"><div class="prog-fill" style="width:${(ratio * 100).toFixed(1)}%;background:var(--reserve)"></div></div>
      <div class="grid-2">
        <button class="btn btn-primary" type="button" id="btnResDeposit">+ Aportar</button>
        <button class="btn btn-outline" type="button" id="btnResWithdraw" ${ov.reserveBalance <= 0 ? 'disabled' : ''}>− Retirar</button>
      </div>
    </div>

    <div class="section-head">
      <h2>Gastos Planejados (Caixinhas)</h2>
      <button class="btn-text btn-sm" type="button" id="btnNewGoal">+ Nova Meta</button>
    </div>
    ${ov.goals.length === 0
      ? `<div class="empty-state"><strong>Nenhum gasto planejado</strong><div class="small">Crie metas para juntar valores aos poucos até completar 100%.</div></div>`
      : ov.goals.map((gs) => `
          <div class="card">
            <div class="row-between">
              <div class="flex-1">
                <div class="title-md">${esc(gs.goal.name)} ${gs.goal.isCompleted ? '✓' : ''}</div>
                <div class="muted small">Guardado: ${esc(formatBrl(gs.savedAmount))} / Meta: ${esc(formatBrl(gs.goal.targetAmount))}</div>
              </div>
              <button class="btn-text btn-sm" type="button" data-edit-goal="${gs.goal.id}">✎</button>
              <button class="btn-text btn-sm c-expense" type="button" data-del-goal="${gs.goal.id}">🗑</button>
            </div>
            <div class="prog-track"><div class="prog-fill" style="width:${(gs.progress * 100).toFixed(1)}%;background:var(--goal)"></div></div>
            <div class="row" style="flex-wrap:wrap">
              ${gs.goal.isCompleted
                ? `<button class="btn btn-outline btn-sm" type="button" data-reopen-goal="${gs.goal.id}">Reabrir Meta</button>`
                : `<button class="btn btn-tonal btn-sm" type="button" data-contrib-goal="${gs.goal.id}:1">+ Destinar</button>
                   <button class="btn btn-outline btn-sm" type="button" data-contrib-goal="${gs.goal.id}:0" ${gs.savedAmount <= 0 ? 'disabled' : ''}>Resgatar</button>
                   <button class="btn btn-primary btn-sm" type="button" data-buy-goal="${gs.goal.id}">🛒 Concluir Compra</button>`}
            </div>
          </div>
        `).join('')}

    <div class="section-head"><h2>Movimentações da Reserva (${ov.recentReserveMovements.length})</h2></div>
    ${ov.recentReserveMovements.length === 0
      ? `<div class="empty-state"><div class="small">Sem movimentações ainda.</div></div>`
      : ov.recentReserveMovements.map((m) => `
          <div class="record-card">
            <div class="row-between">
              <div class="flex-1">
                <div class="record-title">${esc(m.note)}</div>
                <div class="muted small">${m.type === ReserveMovementType.DEPOSIT ? 'Aporte' : 'Retirada'} · ${esc(formatDateBr(m.createdAt))}</div>
              </div>
              <strong class="${m.type === ReserveMovementType.DEPOSIT ? 'c-income' : 'c-expense'}">${m.type === ReserveMovementType.DEPOSIT ? '+' : '-'} ${esc(formatBrl(m.amount))}</strong>
              <button class="btn-text btn-sm" type="button" data-edit-res="${m.id}">✎</button>
              <button class="btn-text btn-sm c-expense" type="button" data-del-res="${m.id}">🗑</button>
            </div>
          </div>
        `).join('')}

    ${ov.recentGoalContributions.length > 0 ? `
      <div class="section-head"><h2>Histórico de Aportes nas Metas (${ov.recentGoalContributions.length})</h2></div>
      ${ov.recentGoalContributions.map((c) => `
        <div class="record-card">
          <div class="row-between">
            <div class="flex-1">
              <div class="record-title">${esc(goalMap.get(c.goalId) || 'Meta')}: ${esc(c.note)}</div>
              <div class="muted small">${c.amount >= 0 ? 'Aporte' : 'Resgate'} · ${esc(formatDateBr(c.createdAt))}</div>
            </div>
            <strong class="${c.amount >= 0 ? 'c-goal' : 'c-expense'}">${c.amount >= 0 ? '+' : '-'} ${esc(formatBrl(Math.abs(c.amount)))}</strong>
            <button class="btn-text btn-sm" type="button" data-edit-gcontrib="${c.id}">✎</button>
            <button class="btn-text btn-sm c-expense" type="button" data-del-gcontrib="${c.id}">🗑</button>
          </div>
        </div>
      `).join('')}
    ` : ''}
  `;
}

function renderReports(ov) {
  const balance = ov.incomeProjection.receivedInMonth - ov.monthFamilyTotalExpenses;
  return `
    <div class="card">
      <div class="title-md">Relatório Consolidado do Mês</div>
      <div class="row-between">
        <div>
          <div class="muted small">Entradas Fracionadas</div>
          <div class="med-value c-income">${esc(formatBrl(ov.incomeProjection.receivedInMonth))}</div>
        </div>
        <div style="text-align:right">
          <div class="muted small">Despesa da Família</div>
          <div class="med-value c-expense">${esc(formatBrl(ov.monthFamilyTotalExpenses))}</div>
        </div>
      </div>
      <div class="small"><strong>Casa: ${esc(formatBrl(ov.monthTotalExpenses))} · Extraordinárias: ${esc(formatBrl(ov.extraordinary.monthTotal))}</strong></div>
      <div class="muted small">Resultado do mês: ${esc(formatBrl(balance))} · A receber planejado: ${esc(formatBrl(ov.pendingPlannedIncomesTotal))} · Contas pendentes: ${esc(formatBrl(ov.pendingBillsTotal))}</div>
    </div>

    <div class="card">
      <div class="title-md">Entradas vs. Saídas da Família (6 meses)</div>
      ${renderGroupedBarsSvg(ov.monthlyComparison)}
    </div>

    <div class="card">
      <div class="title-md">Gastos por Semana (toque para expandir)</div>
      <div class="muted small">Orçamento livre p/ variáveis: ${esc(formatBrl(ov.monthFreeBudget))} · Guardado p/ próximas semanas: ${esc(formatBrl(ov.reservedForFutureWeeks))}</div>
      ${ov.weeksOfMonth.map((w) => {
        const expOpen = state.expandedReportWeek === w.week.weekNumber;
        const count = w.expenses.length + w.extraExpenses.length;
        return `
          <div style="border-top:1px solid var(--border);padding-top:8px">
            <div class="row-between" style="cursor:pointer" data-toggle-rep-week="${w.week.weekNumber}">
              <strong>${esc(w.week.label)}${w.isCurrentWeek ? ' (Atual)' : ''} · ${count} itens</strong>
              <strong class="c-expense">Total: ${esc(formatBrl(w.totalSpentInWeek))}</strong>
            </div>
            <div class="row-between muted small" style="margin-top:2px">
              <span>Variáveis: ${esc(formatBrl(w.spentInWeek))} / Teto: ${esc(formatBrl(w.weeklyLimit))}</span>
              <span>Fixos: ${esc(formatBrl(w.fixedSpentInWeek))} · Extras: ${esc(formatBrl(w.extraSpentInWeek))}</span>
            </div>
            <div class="c-income small">Entradas na semana: ${esc(formatBrl(w.incomesInWeek))}</div>
            ${expOpen ? `
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
                ${count === 0 ? `<div class="muted small">Nenhum gasto registrado nesta semana.</div>` : ''}
                ${w.expenses.map(renderExpenseCard).join('')}
                ${w.extraExpenses.map(renderExtraCard).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>

    <div class="section-head">
      <h2>Entradas Planejadas (A Receber)</h2>
      <button class="btn-text btn-sm" type="button" id="btnAddPlanned2">+ Planejar Entrada</button>
    </div>
    ${ov.plannedIncomes.length === 0
      ? `<div class="empty-state"><div class="small">Nenhuma entrada planejada.</div></div>`
      : ov.plannedIncomes.map(renderPlannedIncomeCard).join('')}

    <div class="section-head">
      <h2>Contas Fixas & Vencimentos</h2>
      <button class="btn-text btn-sm" type="button" id="btnCreateBill">+ Conta Fixa</button>
    </div>
    ${ov.fixedBills.length === 0
      ? `<div class="empty-state"><strong>Nenhuma conta fixa cadastrada</strong><div class="small">Cadastre Água, Energia, Internet ou Insumos Essenciais.</div></div>`
      : ov.fixedBills.map((b) => {
          const isPaid = b.status === BillStatus.PAID;
          return `
            <div class="card ${b.isAnomalous ? 'warn-card' : ''}">
              <div class="row-between">
                <div class="flex-1">
                  <div class="title-md">${esc(b.bill.name)}</div>
                  <div class="muted small">Vencimento: ${esc(formatDateBr(b.dueDateMillis))} · ${isPaid ? 'Pago' : b.daysUntilDue < 0 ? `Vencida há ${-b.daysUntilDue}d` : b.daysUntilDue === 0 ? 'Vence hoje' : `Em ${b.daysUntilDue}d`}</div>
                </div>
                <strong class="${isPaid ? 'c-income' : ''}">${esc(formatBrl(b.currentAmount))}</strong>
                <button class="btn-text btn-sm" type="button" data-edit-bill="${b.bill.id}">✎</button>
                <button class="btn-text btn-sm c-expense" type="button" data-del-bill="${b.bill.id}">🗑</button>
              </div>
              ${b.stats.count > 0 ? `<div class="muted small">Média: ${esc(formatBrl(b.stats.mean))} ± ${esc(formatBrl(b.stats.stdDev))}</div>` : ''}
              <div class="row-between">
                ${isPaid
                  ? `<span class="c-income small">✓ Baixa em ${esc(b.occurrence?.paidAt ? formatDateBr(b.occurrence.paidAt) : '-')}</span>
                     <button class="btn btn-outline btn-sm" type="button" data-undo-bill="${b.occurrence?.id}">↺ Desfazer</button>`
                  : `<button class="btn btn-outline btn-sm" type="button" data-prev-bill="${b.bill.id}">Informar valor</button>
                     <button class="btn btn-primary btn-sm" type="button" data-pay-bill="${b.bill.id}">✓ Dar Baixa</button>`}
              </div>
            </div>
          `;
        }).join('')}
  `;
}

// ============================================================
// Modais Completos (Entradas, Gastos, Extras, Comprovantes, Cupons)
// ============================================================

function openIncomeDialog(ov, initial = null) {
  const refMillis = initial?.receivedAt ?? Date.now();
  const activeGoals = ov.goals.filter((g) => !g.goal.isCompleted);

  openModalHtml(`
    <div class="row-between">
      <div class="title-md">${initial ? 'Editar Entrada' : 'Nova Entrada Fracionada'}</div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="form-group"><label class="form-label">Valor recebido (R$)</label><input class="input-field" id="fIncAmt" inputmode="decimal" placeholder="Ex: 700,00" value="${esc(formatInputNumber(initial?.amount))}" /></div>
    <div class="form-group"><label class="form-label">Origem / Descrição</label><input class="input-field" id="fIncDesc" placeholder="Ex: Diária, Pix cliente, Freela" value="${esc(initial?.description || '')}" /></div>
    <div class="form-group"><label class="form-label">Data</label><input class="input-field" id="fIncDate" type="date" value="${esc(toIsoInputDate(refMillis))}" /></div>
    ${!initial ? `
      <div id="reserveSuggestHost"></div>
      <div class="form-group"><label class="form-label">Separar para Reserva Financeira (opcional)</label><input class="input-field" id="fIncRes" inputmode="decimal" placeholder="0,00" /></div>
      ${activeGoals.length > 0 ? `
        <div class="form-group"><label class="form-label">Destinar parte para Meta Planejada (opcional)</label>
          <select class="input-field" id="fIncGoal">
            <option value="">Nenhuma</option>
            ${activeGoals.map((g) => `<option value="${g.goal.id}">${esc(g.goal.name)} (falta ${esc(formatBrl(g.remainingAmount))})</option>`).join('')}
          </select>
        </div>
        <div class="form-group hidden" id="fIncGoalAmtWrap"><label class="form-label">Valor para a Meta (R$)</label><input class="input-field" id="fIncGoalAmt" inputmode="decimal" placeholder="0,00" /></div>
      ` : ''}
    ` : ''}
    <div class="c-expense small" id="fIncErr"></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
      <button class="btn btn-primary" type="button" id="btnSaveInc">${initial ? 'Salvar' : 'Registrar entrada'}</button>
    </div>
  `, (sheet) => {
    const amtEl = sheet.querySelector('#fIncAmt');
    const goalSel = sheet.querySelector('#fIncGoal');
    const goalAmtWrap = sheet.querySelector('#fIncGoalAmtWrap');
    if (goalSel && goalAmtWrap) {
      goalSel.addEventListener('change', () => goalAmtWrap.classList.toggle('hidden', !goalSel.value));
    }
    const updateSug = () => {
      const host = sheet.querySelector('#reserveSuggestHost');
      if (!host) return;
      const val = parseBrlInput(amtEl.value) || 0;
      const sug = suggestReserveFromIncome(val, ov.settings, ov.reserveSummary.depositedInMonth);
      host.innerHTML = sug > 0
        ? `<div class="card soft" style="padding:10px"><div class="small"><strong>Sugestão p/ Reserva: ${esc(formatBrl(sug))}</strong></div><button class="btn-text btn-sm" style="align-self:flex-start;padding-left:0" type="button" id="btnApplySug">Aplicar ${esc(formatBrl(sug))}</button></div>`
        : '';
      const btn = host.querySelector('#btnApplySug');
      if (btn) btn.addEventListener('click', () => { sheet.querySelector('#fIncRes').value = formatInputNumber(sug); });
    };
    amtEl.addEventListener('input', updateSug);

    sheet.querySelector('#btnSaveInc').addEventListener('click', () => {
      const amount = parseBrlInput(amtEl.value);
      const desc = sheet.querySelector('#fIncDesc').value;
      const dt = parseBrOrIsoDateMillis(sheet.querySelector('#fIncDate').value, refMillis);
      const resAmt = !initial ? (parseBrlInput(sheet.querySelector('#fIncRes')?.value) || 0) : 0;
      const gId = !initial && goalSel?.value ? Number(goalSel.value) : null;
      const gAmt = gId ? (parseBrlInput(sheet.querySelector('#fIncGoalAmt')?.value) || 0) : 0;
      const err = sheet.querySelector('#fIncErr');
      if (amount == null || amount <= 0) { err.textContent = 'Informe um valor maior que zero.'; return; }
      if (dt == null) { err.textContent = 'Data inválida.'; return; }
      if (resAmt < 0 || gAmt < 0) { err.textContent = 'Valores separados não podem ser negativos.'; return; }
      if (resAmt + gAmt > amount) { err.textContent = 'A soma separada excede a entrada.'; return; }

      closeModal();
      if (initial) {
        store.updateIncomeFraction(initial.id, { amount, description: desc, receivedAt: dt });
        showToast('Entrada atualizada!');
      } else {
        store.addIncomeFraction({
          amount,
          description: desc,
          receivedAt: dt,
          reserveDepositAmount: resAmt,
          goalAllocation: gId && gAmt > 0 ? { goalId: gId, amount: gAmt } : null
        });
        showToast('Entrada fracionada registrada!');
      }
    });
  });
}

function attachReceiptsAndCouponHandlers(sheet, stateObj, yearMonth, hintFn, onCouponAutoFill) {
  const recListEl = sheet.querySelector('#modalReceiptsList');
  const camInput = sheet.querySelector('#inpCamReceipt');
  const galInput = sheet.querySelector('#inpGalReceipt');
  const btnCoupon = sheet.querySelector('#btnOpenCouponSub');
  const btnDelCoupon = sheet.querySelector('#btnClearCouponSub');

  const refreshReceipts = () => {
    if (!recListEl) return;
    recListEl.innerHTML = stateObj.receipts.map((r, idx) => `
      <div class="row-between card soft" style="padding:8px">
        <div class="row flex-1" style="min-width:0">
          <img class="receipt-thumb" data-thumb-idx="${idx}" alt="" />
          <div class="flex-1" style="min-width:0">
            <div class="record-title small">${esc(r.fileName)}</div>
            <div class="c-primary" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.relativePath)}</div>
          </div>
        </div>
        <button class="btn-text btn-sm c-expense" type="button" data-rm-rec="${idx}">🗑</button>
      </div>
    `).join('');

    stateObj.receipts.forEach(async (r, idx) => {
      const img = recListEl.querySelector(`[data-thumb-idx="${idx}"]`);
      if (img && r.blobKey) {
        const url = await getReceiptObjectUrl(r.blobKey);
        if (url) img.src = url;
      }
    });

    recListEl.querySelectorAll('[data-rm-rec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-rm-rec'));
        stateObj.receipts = stateObj.receipts.filter((_, idx) => idx !== i);
        refreshReceipts();
      });
    });
  };

  const handleFile = async (input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      showToast('Processando comprovante...');
      const saved = await saveReceiptBlob(file, yearMonth, hintFn());
      stateObj.receipts = [...stateObj.receipts, saved];
      refreshReceipts();
      showToast('Comprovante salvo na pasta!');
    } catch {
      showToast('Não foi possível ler esta imagem.');
    }
  };

  sheet.querySelector('#btnCapPhoto')?.addEventListener('click', () => camInput.click());
  sheet.querySelector('#btnPickGallery')?.addEventListener('click', () => galInput.click());
  camInput?.addEventListener('change', () => handleFile(camInput));
  galInput?.addEventListener('change', () => handleFile(galInput));

  const refreshCouponBtn = () => {
    if (!btnCoupon) return;
    btnCoupon.textContent = stateObj.coupon
      ? `🧾 Editar Cupom (${stateObj.coupon.items?.length || 0} itens)`
      : '🧾 Associar Cupom de Compra';
    btnDelCoupon?.classList.toggle('hidden', !stateObj.coupon);
  };

  btnCoupon?.addEventListener('click', () => {
    openCouponSubDialog(stateObj.coupon, (newCoupon) => {
      stateObj.coupon = newCoupon;
      closeSubModal();
      refreshCouponBtn();
      if (onCouponAutoFill) onCouponAutoFill(newCoupon);
    }, () => {
      closeSubModal();
    });
  });

  btnDelCoupon?.addEventListener('click', () => {
    stateObj.coupon = null;
    refreshCouponBtn();
  });

  refreshReceipts();
  refreshCouponBtn();
}

function openCouponSubDialog(initialCoupon, onSave, onCancel) {
  let items = (initialCoupon?.items || []).map((it) => ({ ...it }));
  openSubModalHtml(`
    <div class="row-between">
      <div class="title-md">Associar Cupom de Compra</div>
      <button class="icon-btn" type="button" id="btnCpCancelX">×</button>
    </div>
    <div class="form-group"><label class="form-label">Loja / Fornecedor</label><input class="input-field" id="cpStore" placeholder="Ex: Depósito Silva" value="${esc(initialCoupon?.storeOrSupplier || '')}" /></div>
    <div class="form-group"><label class="form-label">Número da Nota / Cupom (opc.)</label><input class="input-field" id="cpNum" value="${esc(initialCoupon?.couponNumber || '')}" /></div>
    <hr style="border:none;border-top:1px solid var(--border);margin:2px 0"/>
    <strong>Adicionar Produto</strong>
    <div class="form-group"><input class="input-field" id="cpProd" placeholder="Ex: Areia Lavada, Brita 1, Cimento" /></div>
    <div class="grid-3">
      <input class="input-field" id="cpQty" inputmode="decimal" value="1,00" placeholder="Qtd" />
      <input class="input-field" id="cpUnit" value="un" placeholder="Unid." />
      <input class="input-field" id="cpPrice" inputmode="decimal" placeholder="Valor Unit." />
    </div>
    <button class="btn btn-tonal" type="button" id="btnCpAddItem">+ Adicionar produto na lista</button>
    <div id="cpItemsHost"></div>
    <div class="form-group"><label class="form-label">Observações (opc.)</label><input class="input-field" id="cpNotes" value="${esc(initialCoupon?.notes || '')}" /></div>
    <div class="c-expense small" id="cpErr"></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-text" type="button" id="btnCpCancel">Voltar</button>
      <button class="btn btn-primary" type="button" id="btnCpSave">Salvar Cupom</button>
    </div>
  `, (sheet) => {
    const host = sheet.querySelector('#cpItemsHost');
    const err = sheet.querySelector('#cpErr');
    const renderItems = () => {
      if (items.length === 0) { host.innerHTML = ''; return; }
      const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
      host.innerHTML = `
        <div class="card soft" style="padding:10px;gap:6px">
          ${items.map((it, i) => `
            <div class="row-between small">
              <div><strong>${esc(it.productName)}</strong><div class="muted">${esc(formatInputNumber(it.quantity))} ${esc(it.unit)} × ${esc(formatBrl(it.unitPrice))} = ${esc(formatBrl(it.quantity * it.unitPrice))}</div></div>
              <button class="btn-text btn-sm c-expense" type="button" data-cp-rm="${i}">🗑</button>
            </div>
          `).join('')}
          <strong class="c-primary small">Total do Cupom: ${esc(formatBrl(total))}</strong>
        </div>
      `;
      host.querySelectorAll('[data-cp-rm]').forEach((b) => b.addEventListener('click', () => {
        items = items.filter((_, i) => i !== Number(b.getAttribute('data-cp-rm')));
        renderItems();
      }));
    };
    renderItems();

    sheet.querySelector('#btnCpAddItem').addEventListener('click', () => {
      const name = sheet.querySelector('#cpProd').value.trim();
      const qty = parseBrlInput(sheet.querySelector('#cpQty').value);
      const unit = sheet.querySelector('#cpUnit').value.trim() || 'un';
      const price = parseBrlInput(sheet.querySelector('#cpPrice').value);
      if (!name) { err.textContent = 'Informe o nome do produto.'; return; }
      if (qty == null || qty <= 0) { err.textContent = 'Quantidade inválida.'; return; }
      if (price == null || price <= 0) { err.textContent = 'Valor unitário inválido.'; return; }
      err.textContent = '';
      items.push({ id: 0, productName: name, quantity: qty, unit, unitPrice: price });
      sheet.querySelector('#cpProd').value = '';
      sheet.querySelector('#cpQty').value = '1,00';
      sheet.querySelector('#cpPrice').value = '';
      renderItems();
    });

    sheet.querySelector('#btnCpCancel').addEventListener('click', onCancel);
    sheet.querySelector('#btnCpCancelX').addEventListener('click', onCancel);
    sheet.querySelector('#btnCpSave').addEventListener('click', () => {
      if (items.length === 0) { err.textContent = 'Adicione pelo menos um produto.'; return; }
      onSave({
        id: initialCoupon?.id || 0,
        storeOrSupplier: sheet.querySelector('#cpStore').value.trim() || 'Compra',
        couponNumber: sheet.querySelector('#cpNum').value.trim(),
        purchasedAt: initialCoupon?.purchasedAt || Date.now(),
        items,
        notes: sheet.querySelector('#cpNotes').value.trim()
      });
    });
  });
}

function openExpenseDialog(ov, initial = null) {
  const refMillis = initial?.spentAt ?? Date.now();
  const tags = ov.tagStatuses.map((s) => s.tag).filter((t) => t.type !== TagType.CREDIT_CARD || t.id === initial?.tagId);
  let selectedTagId = initial?.tagId ?? (tags.find((t) => t.name.toLowerCase() === 'besteira')?.id || tags[0]?.id || 0);
  let method = initial?.paymentMethod || PaymentMethod.CASH_PIX_DEBIT;
  let source = initial?.fundingSource || FundingSource.BALANCE;
  const attachState = {
    receipts: [...(initial?.receipts || [])],
    coupon: initial?.coupon ? { ...initial.coupon, items: [...(initial.coupon.items || [])] } : null
  };

  const renderModal = (draftVals = {}) => {
    const selTag = tags.find((t) => t.id === selectedTagId);
    const isUnexp = selTag?.type === TagType.UNEXPECTED;
    const availRes = ov.reserveBalance + (initial?.fundingSource === FundingSource.RESERVE ? initial.amount : 0);

    openModalHtml(`
      <div class="row-between">
        <div class="title-md">${initial ? 'Editar Gasto' : 'Novo Gasto'}</div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="form-group"><label class="form-label">Valor do gasto (R$)</label><input class="input-field" id="fExpAmt" inputmode="decimal" placeholder="Ex: 18,50" value="${esc(draftVals.amt ?? formatInputNumber(initial?.amount))}" /></div>
      <div class="form-group"><label class="form-label">Descrição</label><input class="input-field" id="fExpDesc" placeholder="Ex: Mercado, Farmácia, Conta..." value="${esc(draftVals.desc ?? (initial?.description || ''))}" /></div>
      <div class="form-group"><label class="form-label">Data</label><input class="input-field" id="fExpDate" type="date" value="${esc(draftVals.dt ?? toIsoInputDate(refMillis))}" /></div>
      <div class="form-group">
        <label class="form-label">Etiqueta</label>
        <div class="chips-row">${tags.map((t) => `<button class="chip ${t.id === selectedTagId ? 'selected' : ''}" type="button" data-pick-tag="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Pagamento</label>
        <div class="grid-2">
          <button class="chip ${method === PaymentMethod.CASH_PIX_DEBIT ? 'selected' : ''}" type="button" data-pick-pm="${PaymentMethod.CASH_PIX_DEBIT}">Pix / Dinheiro / Débito</button>
          <button class="chip ${method === PaymentMethod.CREDIT_CARD ? 'selected' : ''}" type="button" data-pick-pm="${PaymentMethod.CREDIT_CARD}">Cartão de Crédito</button>
        </div>
      </div>
      ${isUnexp && method === PaymentMethod.CASH_PIX_DEBIT ? `
        <div class="card warn-card">
          <strong class="c-warn small">Gasto Inesperado: de onde abater?</strong>
          <div class="grid-2">
            <button class="chip ${source === FundingSource.BALANCE ? 'selected' : ''}" type="button" data-pick-src="${FundingSource.BALANCE}">Limite Semanal</button>
            <button class="chip ${source === FundingSource.RESERVE ? 'selected' : ''}" type="button" data-pick-src="${FundingSource.RESERVE}">Reserva (${esc(formatBrl(availRes))})</button>
          </div>
        </div>
      ` : ''}
      <div class="card soft" style="padding:10px;gap:8px">
        <strong class="small">📎 Comprovante (Foto ou Print Pix)</strong>
        <div class="muted" style="font-size:11px">Salvo em Comprovantes/${esc(ov.selectedMonth)}/ com link direto</div>
        <div class="grid-2">
          <button class="btn btn-tonal btn-sm" type="button" id="btnCapPhoto">📷 Tirar Foto</button>
          <button class="btn btn-outline btn-sm" type="button" id="btnPickGallery">🖼 Galeria / Print</button>
        </div>
        <input class="hidden" id="inpCamReceipt" type="file" accept="image/*" capture="environment" />
        <input class="hidden" id="inpGalReceipt" type="file" accept="image/*" />
        <div id="modalReceiptsList" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>
      <div class="row">
        <button class="btn btn-outline flex-1" type="button" id="btnOpenCouponSub">🧾 Associar Cupom de Compra</button>
        <button class="btn-text btn-sm c-expense hidden" type="button" id="btnClearCouponSub">🗑</button>
      </div>
      <div class="c-expense small" id="fExpErr"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
        <button class="btn btn-primary" type="button" id="btnSaveExp">${initial ? 'Salvar alterações' : 'Salvar gasto'}</button>
      </div>
    `, (sheet) => {
      const snapDraft = () => ({
        amt: sheet.querySelector('#fExpAmt').value,
        desc: sheet.querySelector('#fExpDesc').value,
        dt: sheet.querySelector('#fExpDate').value
      });
      sheet.querySelectorAll('[data-pick-tag]').forEach((b) => b.addEventListener('click', () => {
        selectedTagId = Number(b.getAttribute('data-pick-tag'));
        if (tags.find((t) => t.id === selectedTagId)?.type !== TagType.UNEXPECTED) source = FundingSource.BALANCE;
        renderModal(snapDraft());
      }));
      sheet.querySelectorAll('[data-pick-pm]').forEach((b) => b.addEventListener('click', () => {
        method = b.getAttribute('data-pick-pm');
        if (method === PaymentMethod.CREDIT_CARD) source = FundingSource.BALANCE;
        renderModal(snapDraft());
      }));
      sheet.querySelectorAll('[data-pick-src]').forEach((b) => b.addEventListener('click', () => {
        source = b.getAttribute('data-pick-src');
        renderModal(snapDraft());
      }));

      attachReceiptsAndCouponHandlers(
        sheet,
        attachState,
        ov.selectedMonth,
        () => sheet.querySelector('#fExpDesc').value || selTag?.name || 'gasto',
        (cp) => {
          const total = couponItemsTotal(cp);
          if (!sheet.querySelector('#fExpAmt').value && total > 0) sheet.querySelector('#fExpAmt').value = formatInputNumber(total);
          if (!sheet.querySelector('#fExpDesc').value && cp.items?.length) sheet.querySelector('#fExpDesc').value = `Compra ${cp.storeOrSupplier}`;
        }
      );

      sheet.querySelector('#btnSaveExp').addEventListener('click', () => {
        const amount = parseBrlInput(sheet.querySelector('#fExpAmt').value);
        const desc = sheet.querySelector('#fExpDesc').value;
        const dt = parseBrOrIsoDateMillis(sheet.querySelector('#fExpDate').value, refMillis);
        const err = sheet.querySelector('#fExpErr');
        if (amount == null || amount <= 0) { err.textContent = 'Informe um valor maior que zero.'; return; }
        if (dt == null) { err.textContent = 'Data inválida.'; return; }
        if (isUnexp && method === PaymentMethod.CASH_PIX_DEBIT && source === FundingSource.RESERVE && amount > availRes) {
          err.textContent = `Saldo da Reserva (${formatBrl(availRes)}) insuficiente.`;
          return;
        }
        closeModal();
        const payload = {
          amount,
          description: desc,
          tagId: selectedTagId,
          paymentMethod: method,
          fundingSource: (isUnexp && method === PaymentMethod.CASH_PIX_DEBIT) ? source : FundingSource.BALANCE,
          spentAt: dt,
          receipts: attachState.receipts,
          coupon: attachState.coupon
        };
        if (initial) {
          store.updateExpense(initial.id, payload);
          showToast('Gasto atualizado!');
        } else {
          store.addManualExpense(payload);
          showToast('Gasto salvo com sucesso.');
        }
      });
    });
  };
  renderModal();
}

function openExtraExpenseDialog(ov, initial = null, openCouponNow = false) {
  const refMillis = initial?.spentAt ?? Date.now();
  let cat = initial?.categoryType || ExtraCategoryType.MATERIAL;
  let method = initial?.paymentMethod || PaymentMethod.CASH_PIX_DEBIT;
  let source = initial?.fundingSource || FundingSource.BALANCE;
  const attachState = {
    receipts: [...(initial?.receipts || [])],
    coupon: initial?.coupon ? { ...initial.coupon, items: [...(initial.coupon.items || [])] } : null
  };

  const renderModal = (draft = {}) => {
    const availRes = ov.reserveBalance + (initial?.fundingSource === FundingSource.RESERVE ? initial.amount : 0);
    openModalHtml(`
      <div class="row-between">
        <div class="title-md">${initial ? 'Editar Despesa Extra' : 'Nova Despesa Extraordinária'}</div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="chips-row">
        ${Object.values(EXTRA_CATEGORIES).map((c) => `<button class="chip ${cat === c.key ? 'selected' : ''}" type="button" data-ext-cat="${c.key}">${esc(c.shortLabel)}</button>`).join('')}
      </div>
      <div class="form-group"><label class="form-label">Descrição detalhada</label><input class="input-field" id="exDesc" placeholder="Ex: Brita 1, Areia Lavada, Diária Pedreiro" value="${esc(draft.desc ?? (initial?.description || ''))}" /></div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Qtd</label><input class="input-field" id="exQty" inputmode="decimal" value="${esc(draft.qty ?? (formatInputNumber(initial?.quantity) || '1,00'))}" /></div>
        <div class="form-group"><label class="form-label">Unid.</label><input class="input-field" id="exUnit" value="${esc(draft.unit ?? (initial?.unit || EXTRA_CATEGORIES[cat].defaultUnit))}" /></div>
        <div class="form-group"><label class="form-label">Valor Unit.</label><input class="input-field" id="exUPrice" inputmode="decimal" value="${esc(draft.uPrice ?? formatInputNumber(initial?.unitPrice))}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Valor Total (R$)</label><input class="input-field" id="exTotal" inputmode="decimal" placeholder="Ex: 420,00" value="${esc(draft.total ?? formatInputNumber(initial?.amount))}" /></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Fornecedor / Profissional</label><input class="input-field" id="exSup" value="${esc(draft.sup ?? (initial?.supplierOrPerson || ''))}" /></div>
        <div class="form-group"><label class="form-label">Etapa / Obra (opc.)</label><input class="input-field" id="exProj" value="${esc(draft.proj ?? (initial?.projectName || ''))}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Data</label><input class="input-field" id="exDate" type="date" value="${esc(draft.dt ?? toIsoInputDate(refMillis))}" /></div>
      <div class="grid-2">
        <button class="chip ${method === PaymentMethod.CASH_PIX_DEBIT ? 'selected' : ''}" type="button" data-ext-pm="${PaymentMethod.CASH_PIX_DEBIT}">Pix / Dinheiro / Déb.</button>
        <button class="chip ${method === PaymentMethod.CREDIT_CARD ? 'selected' : ''}" type="button" data-ext-pm="${PaymentMethod.CREDIT_CARD}">Cartão Crédito</button>
      </div>
      ${method === PaymentMethod.CASH_PIX_DEBIT ? `
        <div class="grid-2">
          <button class="chip ${source === FundingSource.BALANCE ? 'selected' : ''}" type="button" data-ext-src="${FundingSource.BALANCE}">Saldo em Mãos</button>
          <button class="chip ${source === FundingSource.RESERVE ? 'selected' : ''}" type="button" data-ext-src="${FundingSource.RESERVE}">Reserva (${esc(formatBrl(availRes))})</button>
        </div>
      ` : ''}
      <div class="card soft" style="padding:10px;gap:8px">
        <strong class="small">📎 Comprovante (Foto ou Print Pix)</strong>
        <div class="grid-2">
          <button class="btn btn-tonal btn-sm" type="button" id="btnCapPhoto">📷 Tirar Foto</button>
          <button class="btn btn-outline btn-sm" type="button" id="btnPickGallery">🖼 Galeria / Print</button>
        </div>
        <input class="hidden" id="inpCamReceipt" type="file" accept="image/*" capture="environment" />
        <input class="hidden" id="inpGalReceipt" type="file" accept="image/*" />
        <div id="modalReceiptsList" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>
      <div class="row">
        <button class="btn btn-outline flex-1" type="button" id="btnOpenCouponSub">🧾 Associar Cupom de Compra</button>
        <button class="btn-text btn-sm c-expense hidden" type="button" id="btnClearCouponSub">🗑</button>
      </div>
      <div class="c-expense small" id="exErr"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
        <button class="btn btn-primary" type="button" id="btnSaveExtra">${initial ? 'Salvar' : 'Registrar'}</button>
      </div>
    `, (sheet) => {
      const qtyEl = sheet.querySelector('#exQty');
      const uPriceEl = sheet.querySelector('#exUPrice');
      const totalEl = sheet.querySelector('#exTotal');
      const recompute = () => {
        const q = parseBrlInput(qtyEl.value);
        const u = parseBrlInput(uPriceEl.value);
        if (q > 0 && u > 0) totalEl.value = formatInputNumber(q * u);
      };
      qtyEl.addEventListener('input', recompute);
      uPriceEl.addEventListener('input', recompute);

      const snap = () => ({
        desc: sheet.querySelector('#exDesc').value,
        qty: qtyEl.value,
        unit: sheet.querySelector('#exUnit').value,
        uPrice: uPriceEl.value,
        total: totalEl.value,
        sup: sheet.querySelector('#exSup').value,
        proj: sheet.querySelector('#exProj').value,
        dt: sheet.querySelector('#exDate').value
      });

      sheet.querySelectorAll('[data-ext-cat]').forEach((b) => b.addEventListener('click', () => {
        cat = b.getAttribute('data-ext-cat');
        const d = snap();
        if (!initial) d.unit = EXTRA_CATEGORIES[cat].defaultUnit;
        renderModal(d);
      }));
      sheet.querySelectorAll('[data-ext-pm]').forEach((b) => b.addEventListener('click', () => {
        method = b.getAttribute('data-ext-pm');
        if (method === PaymentMethod.CREDIT_CARD) source = FundingSource.BALANCE;
        renderModal(snap());
      }));
      sheet.querySelectorAll('[data-ext-src]').forEach((b) => b.addEventListener('click', () => {
        source = b.getAttribute('data-ext-src');
        renderModal(snap());
      }));

      attachReceiptsAndCouponHandlers(
        sheet,
        attachState,
        ov.selectedMonth,
        () => sheet.querySelector('#exDesc').value || EXTRA_CATEGORIES[cat].shortLabel,
        (cp) => {
          const t = couponItemsTotal(cp);
          if (!totalEl.value && t > 0) {
            totalEl.value = formatInputNumber(t);
            uPriceEl.value = formatInputNumber(t);
          }
          if (!sheet.querySelector('#exSup').value) sheet.querySelector('#exSup').value = cp.storeOrSupplier;
          if (!sheet.querySelector('#exDesc').value && cp.items?.length) {
            sheet.querySelector('#exDesc').value = cp.items.map((i) => i.productName).join(', ').slice(0, 42);
          }
        }
      );

      sheet.querySelector('#btnSaveExtra').addEventListener('click', () => {
        const desc = sheet.querySelector('#exDesc').value.trim();
        const total = parseBrlInput(totalEl.value);
        const qty = Math.max(0.01, parseBrlInput(qtyEl.value) || 1);
        const uPrice = parseBrlInput(uPriceEl.value) ?? ((total || 0) / qty);
        const dt = parseBrOrIsoDateMillis(sheet.querySelector('#exDate').value, refMillis);
        const err = sheet.querySelector('#exErr');
        if (!desc && !attachState.coupon) { err.textContent = 'Informe a descrição da despesa.'; return; }
        if (total == null || total <= 0) { err.textContent = 'Informe um valor total maior que zero.'; return; }
        if (dt == null) { err.textContent = 'Data inválida.'; return; }
        if (method === PaymentMethod.CASH_PIX_DEBIT && source === FundingSource.RESERVE && total > availRes) {
          err.textContent = `Saldo da Reserva (${formatBrl(availRes)}) insuficiente.`;
          return;
        }
        closeModal();
        const payload = {
          description: desc || `Compra ${attachState.coupon?.storeOrSupplier || ''}`,
          categoryType: cat,
          quantity: qty,
          unit: sheet.querySelector('#exUnit').value.trim() || EXTRA_CATEGORIES[cat].defaultUnit,
          unitPrice: uPrice,
          amount: total,
          supplierOrPerson: sheet.querySelector('#exSup').value.trim(),
          projectName: sheet.querySelector('#exProj').value.trim(),
          paymentMethod: method,
          fundingSource: method === PaymentMethod.CREDIT_CARD ? FundingSource.BALANCE : source,
          spentAt: dt,
          receipts: attachState.receipts,
          coupon: attachState.coupon
        };
        if (initial) {
          store.updateExtraExpense(initial.id, payload);
          showToast('Despesa extraordinária atualizada!');
        } else {
          store.addExtraExpense(payload);
          showToast('Despesa extraordinária registrada!');
        }
      });

      if (openCouponNow) {
        openCouponNow = false;
        sheet.querySelector('#btnOpenCouponSub')?.click();
      }
    });
  };
  renderModal();
}

function openReceiptViewer(receipt) {
  openModalHtml(`
    <div class="row-between">
      <div class="title-md">Comprovante Salvo</div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div id="rcViewerImgWrap" class="empty-state">Carregando comprovante...</div>
    <div class="card soft" style="padding:10px;gap:4px">
      <strong class="small">Arquivo: ${esc(receipt.fileName)}</strong>
      <div class="c-primary small">Link: ${esc(receipt.fullPath || receipt.relativePath)}</div>
      <div class="muted small">Registrado em ${esc(formatDateTimeBr(receipt.createdAt))}</div>
    </div>
    <div class="row-between">
      <button class="btn btn-tonal" type="button" id="btnShareReceipt">📤 Salvar no Arquivos / Enviar</button>
      <button class="btn btn-primary" type="button" data-close-modal>Fechar</button>
    </div>
  `, async (sheet) => {
    const wrap = sheet.querySelector('#rcViewerImgWrap');
    const url = await getReceiptObjectUrl(receipt.blobKey);
    if (url) {
      wrap.className = '';
      wrap.innerHTML = `<img class="receipt-full-img" src="${url}" alt="${esc(receipt.fileName)}" />`;
    } else {
      wrap.innerHTML = 'Imagem não encontrada no armazenamento local.';
    }
    sheet.querySelector('#btnShareReceipt').addEventListener('click', () => shareOrDownloadReceipt(receipt));
  });
}

function openCouponDetails(coupon) {
  const total = couponItemsTotal(coupon);
  openModalHtml(`
    <div class="row-between">
      <div class="title-md">Cupom: ${esc(coupon.storeOrSupplier || 'Compra')}</div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="muted small">Data: ${esc(formatDateBr(coupon.purchasedAt))}${coupon.couponNumber ? ` · Nº ${esc(coupon.couponNumber)}` : ''}</div>
    <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:8px 0">
      ${(coupon.items || []).map((it, i) => `
        <div class="row-between small">
          <div><strong>${i + 1}. ${esc(it.productName)}</strong><div class="muted">${esc(formatInputNumber(it.quantity) || '1')} ${esc(it.unit)} × ${esc(formatBrl(it.unitPrice))}</div></div>
          <strong>${esc(formatBrl(it.quantity * it.unitPrice))}</strong>
        </div>
      `).join('')}
    </div>
    <div class="row-between"><strong>Total (${coupon.items?.length || 0} itens)</strong><strong class="c-primary">${esc(formatBrl(total))}</strong></div>
    ${coupon.notes ? `<div class="muted small">Obs: ${esc(coupon.notes)}</div>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="button" data-close-modal>Fechar</button></div>
  `);
}

function openExtraCapsDialog(ov) {
  const s = ov.settings;
  openModalHtml(`
    <div class="row-between"><div class="title-md">Tetos Extraordinários</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="form-group"><label class="form-label">Teto Geral Extraordinário no Mês (R$)</label><input class="input-field" id="cMon" inputmode="decimal" value="${esc(formatInputNumber(s.extraordinaryMonthlyCap))}" /></div>
    <div class="form-group"><label class="form-label">Teto Materiais — Areia, Brita, Cimento (R$)</label><input class="input-field" id="cMat" inputmode="decimal" value="${esc(formatInputNumber(s.extraMaterialCap))}" /></div>
    <div class="form-group"><label class="form-label">Teto Diárias & Mão de Obra (R$)</label><input class="input-field" id="cLab" inputmode="decimal" value="${esc(formatInputNumber(s.extraLaborCap))}" /></div>
    <div class="form-group"><label class="form-label">Teto Aluguel de Maquinário (R$)</label><input class="input-field" id="cEq" inputmode="decimal" value="${esc(formatInputNumber(s.extraEquipmentCap))}" /></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
      <button class="btn btn-primary" type="button" id="btnSaveCaps">Salvar Tetos</button>
    </div>
  `, (sheet) => {
    sheet.querySelector('#btnSaveCaps').addEventListener('click', () => {
      store.updateExtraordinaryCaps({
        monthlyCap: Math.max(0, parseBrlInput(sheet.querySelector('#cMon').value) || 0),
        materialCap: Math.max(0, parseBrlInput(sheet.querySelector('#cMat').value) || 0),
        laborCap: Math.max(0, parseBrlInput(sheet.querySelector('#cLab').value) || 0),
        equipmentCap: Math.max(0, parseBrlInput(sheet.querySelector('#cEq').value) || 0)
      });
      closeModal();
      showToast('Tetos extraordinários salvos!');
    });
  });
}

function openExtraRecurringDialog(initial = null) {
  let cat = initial?.categoryType || ExtraCategoryType.LABOR_DAILY;
  openModalHtml(`
    <div class="row-between"><div class="title-md">${initial ? 'Editar Recorrente' : 'Novo Recorrente (Diária/Aluguel)'}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="chips-row">
      ${[ExtraCategoryType.LABOR_DAILY, ExtraCategoryType.EQUIPMENT_RENTAL, ExtraCategoryType.MATERIAL].map((k) => `<button class="chip ${cat === k ? 'selected' : ''}" type="button" data-rcat="${k}">${esc(EXTRA_CATEGORIES[k].shortLabel)}</button>`).join('')}
    </div>
    <div class="form-group"><label class="form-label">Nome</label><input class="input-field" id="rName" placeholder="Ex: Diária Pedreiro João" value="${esc(initial?.name || '')}" /></div>
    <div class="form-group"><label class="form-label">Profissional / Locadora (opc.)</label><input class="input-field" id="rPerson" value="${esc(initial?.personOrCompany || '')}" /></div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">Valor por unidade (R$)</label><input class="input-field" id="rRate" inputmode="decimal" value="${esc(formatInputNumber(initial?.ratePerUnit))}" /></div>
      <div class="form-group"><label class="form-label">Unidade</label><input class="input-field" id="rUnit" value="${esc(initial?.unitLabel || EXTRA_CATEGORIES[cat].defaultUnit)}" /></div>
    </div>
    <div class="c-expense small" id="rErr"></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
      <button class="btn btn-primary" type="button" id="btnSaveRec">Salvar</button>
    </div>
  `, (sheet) => {
    sheet.querySelectorAll('[data-rcat]').forEach((b) => b.addEventListener('click', () => {
      cat = b.getAttribute('data-rcat');
      sheet.querySelectorAll('[data-rcat]').forEach((x) => x.classList.toggle('selected', x === b));
      if (!initial) sheet.querySelector('#rUnit').value = EXTRA_CATEGORIES[cat].defaultUnit;
    }));
    sheet.querySelector('#btnSaveRec').addEventListener('click', () => {
      const name = sheet.querySelector('#rName').value.trim();
      const rate = parseBrlInput(sheet.querySelector('#rRate').value);
      const err = sheet.querySelector('#rErr');
      if (!name) { err.textContent = 'Informe o nome.'; return; }
      if (rate == null || rate <= 0) { err.textContent = 'Informe um valor maior que zero.'; return; }
      const payload = {
        name,
        categoryType: cat,
        personOrCompany: sheet.querySelector('#rPerson').value,
        ratePerUnit: rate,
        unitLabel: sheet.querySelector('#rUnit').value
      };
      closeModal();
      if (initial) store.updateExtraRecurring(initial.id, payload);
      else store.createExtraRecurring(payload);
      showToast('Recorrente salvo!');
    });
  });
}

function openLaunchRecurringDialog(ov, rec) {
  let method = PaymentMethod.CASH_PIX_DEBIT;
  const attachState = { receipts: [], coupon: null };
  openModalHtml(`
    <div class="row-between"><div class="title-md">Lançar: ${esc(rec.name)}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="c-primary small"><strong>Unitário: ${esc(formatBrl(rec.ratePerUnit))} / ${esc(rec.unitLabel)}</strong></div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">Qtd (${esc(rec.unitLabel)})</label><input class="input-field" id="lrQty" inputmode="decimal" value="1,00" /></div>
      <div class="form-group"><label class="form-label">Total (R$)</label><input class="input-field" id="lrTot" inputmode="decimal" value="${esc(formatInputNumber(rec.ratePerUnit))}" /></div>
    </div>
    <div class="form-group"><label class="form-label">Data</label><input class="input-field" id="lrDate" type="date" value="${esc(toIsoInputDate(Date.now()))}" /></div>
    <div class="grid-2">
      <button class="chip selected" type="button" data-lrpm="${PaymentMethod.CASH_PIX_DEBIT}">Pix / Dinheiro</button>
      <button class="chip" type="button" data-lrpm="${PaymentMethod.CREDIT_CARD}">Cartão</button>
    </div>
    <div class="card soft" style="padding:10px;gap:8px">
      <strong class="small">📎 Comprovante (opcional)</strong>
      <div class="grid-2">
        <button class="btn btn-tonal btn-sm" type="button" id="btnCapPhoto">📷 Tirar Foto</button>
        <button class="btn btn-outline btn-sm" type="button" id="btnPickGallery">🖼 Galeria / Print</button>
      </div>
      <input class="hidden" id="inpCamReceipt" type="file" accept="image/*" capture="environment" />
      <input class="hidden" id="inpGalReceipt" type="file" accept="image/*" />
      <div id="modalReceiptsList" style="display:flex;flex-direction:column;gap:6px"></div>
    </div>
    <div class="c-expense small" id="lrErr"></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-text" type="button" data-close-modal>Cancelar</button>
      <button class="btn btn-primary" type="button" id="btnConfirmLaunch">Confirmar</button>
    </div>
  `, (sheet) => {
    const qtyEl = sheet.querySelector('#lrQty');
    const totEl = sheet.querySelector('#lrTot');
    qtyEl.addEventListener('input', () => {
      const q = parseBrlInput(qtyEl.value);
      if (q > 0) totEl.value = formatInputNumber(q * rec.ratePerUnit);
    });
    sheet.querySelectorAll('[data-lrpm]').forEach((b) => b.addEventListener('click', () => {
      method = b.getAttribute('data-lrpm');
      sheet.querySelectorAll('[data-lrpm]').forEach((x) => x.classList.toggle('selected', x === b));
    }));
    attachReceiptsAndCouponHandlers(sheet, attachState, ov.selectedMonth, () => rec.name);

    sheet.querySelector('#btnConfirmLaunch').addEventListener('click', () => {
      const qty = parseBrlInput(qtyEl.value);
      const tot = parseBrlInput(totEl.value);
      const dt = parseBrOrIsoDateMillis(sheet.querySelector('#lrDate').value, Date.now());
      const err = sheet.querySelector('#lrErr');
      if (qty == null || qty <= 0) { err.textContent = 'Quantidade inválida.'; return; }
      if (tot == null || tot <= 0) { err.textContent = 'Total inválido.'; return; }
      if (dt == null) { err.textContent = 'Data inválida.'; return; }
      closeModal();
      store.addExtraExpense({
        description: `${rec.name} (${formatInputNumber(qty)} ${rec.unitLabel})`,
        categoryType: rec.categoryType,
        quantity: qty,
        unit: rec.unitLabel,
        unitPrice: rec.ratePerUnit,
        amount: tot,
        supplierOrPerson: rec.personOrCompany,
        projectName: '',
        paymentMethod: method,
        fundingSource: FundingSource.BALANCE,
        spentAt: dt,
        receipts: attachState.receipts,
        recurringId: rec.id
      });
      showToast('Lançamento registrado!');
    });
  });
}

function openSettingsDialog(ov) {
  const s = ov.settings;
  let mode = s.reserveTargetMode;
  openModalHtml(`
    <div class="row-between"><div class="title-md">Configurações & Backup</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="form-group"><label class="form-label">Meta de Renda Mensal (R$)</label><input class="input-field" id="setGoal" inputmode="decimal" value="${esc(formatInputNumber(s.monthlyIncomeGoal))}" /></div>
    <div class="grid-2">
      <button class="chip ${mode === ReserveTargetMode.PERCENT ? 'selected' : ''}" type="button" data-smode="${ReserveTargetMode.PERCENT}">% da Meta</button>
      <button class="chip ${mode === ReserveTargetMode.FIXED ? 'selected' : ''}" type="button" data-smode="${ReserveTargetMode.FIXED}">Valor Fixo (R$)</button>
    </div>
    <div class="form-group"><label class="form-label">Reserva Alvo</label><input class="input-field" id="setResVal" inputmode="decimal" value="${esc(formatInputNumber(s.reserveTargetValue))}" /></div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">Dia Venc. Cartão</label><input class="input-field" id="setCardDay" inputmode="numeric" value="${s.creditCardDueDay}" /></div>
      <div class="form-group"><label class="form-label">Sensibilidade Desvio (σ)</label><input class="input-field" id="setSigma" inputmode="decimal" value="${s.anomalySigmaThreshold}" /></div>
    </div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-primary" type="button" id="btnSaveSettings">Salvar Configurações</button>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:2px 0"/>
    <strong class="small">Backup & Segurança</strong>
    <div class="grid-2">
      <button class="btn btn-tonal btn-sm" type="button" id="btnExpJson">⬇ Exportar JSON</button>
      <button class="btn btn-outline btn-sm" type="button" id="btnImpJson">⬆ Importar JSON</button>
    </div>
    <input class="hidden" id="inpImpJson" type="file" accept=".json,application/json" />
    <button class="btn btn-outline c-expense" type="button" id="btnResetAllData">🗑 Zerar Todos os Dados</button>
  `, (sheet) => {
    sheet.querySelectorAll('[data-smode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.getAttribute('data-smode');
      sheet.querySelectorAll('[data-smode]').forEach((x) => x.classList.toggle('selected', x === b));
    }));
    sheet.querySelector('#btnSaveSettings').addEventListener('click', () => {
      store.updateSettings({
        monthlyIncomeGoal: parseBrlInput(sheet.querySelector('#setGoal').value) || 0,
        reserveTargetMode: mode,
        reserveTargetValue: parseBrlInput(sheet.querySelector('#setResVal').value) || 0,
        creditCardDueDay: Number(sheet.querySelector('#setCardDay').value) || 10,
        anomalySigmaThreshold: parseBrlInput(sheet.querySelector('#setSigma').value) || 1.5
      });
      closeModal();
      showToast('Configurações atualizadas!');
    });
    sheet.querySelector('#btnExpJson').addEventListener('click', () => {
      const blob = new Blob([store.exportBackupJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `renda_fracionada_backup_${currentYearMonth()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Backup JSON baixado!');
    });
    const impInput = sheet.querySelector('#inpImpJson');
    sheet.querySelector('#btnImpJson').addEventListener('click', () => impInput.click());
    impInput.addEventListener('change', async () => {
      const f = impInput.files && impInput.files[0];
      if (!f) return;
      try {
        store.importBackupJson(await f.text());
        closeModal();
        showToast('Backup importado!');
      } catch (e) {
        showToast(e.message || 'Erro ao importar JSON.');
      }
    });
    sheet.querySelector('#btnResetAllData').addEventListener('click', () => {
      openConfirmDelete({
        title: 'Zerar todos os dados?',
        message: 'Isso apagará todas as entradas, gastos, contas, metas e comprovantes salvos.',
        confirmLabel: 'Zerar Tudo',
        onConfirm: () => {
          store.clearAllUserData();
          showToast('Todos os dados foram zerados.');
        }
      });
    });
  });
}

// Modais auxiliares (Etiqueta, Meta, Aporte, Conta Fixa, Entrada Planejada, Fatura)
function openTagDialog(initial = null) {
  let type = initial?.type || TagType.VARIABLE;
  let colorHex = initial?.colorHex || TAG_COLOR_PALETTE[0];
  const typeOpts = initial?.type === TagType.CREDIT_CARD
    ? Object.values(TagType)
    : [TagType.VARIABLE, TagType.FIXED, TagType.UNEXPECTED];
  openModalHtml(`
    <div class="row-between"><div class="title-md">${initial ? `Editar: ${esc(initial.name)}` : 'Nova Etiqueta'}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="form-group"><label class="form-label">Nome</label><input class="input-field" id="tName" value="${esc(initial?.name || '')}" /></div>
    <div class="chips-row">${typeOpts.map((t) => `<button class="chip ${type === t ? 'selected' : ''}" type="button" data-ttype="${t}">${esc(TAG_TYPE_LABELS[t])}</button>`).join('')}</div>
    <div class="chips-row">${TAG_COLOR_PALETTE.map((c) => `<button type="button" data-tcol="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:${c === colorHex ? '3px solid var(--text)' : 'none'}"></button>`).join('')}</div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">Teto Semanal (R$)</label><input class="input-field" id="tW" inputmode="decimal" value="${esc(formatInputNumber(initial?.weeklyCap))}" /></div>
      <div class="form-group"><label class="form-label">Teto Mensal (R$)</label><input class="input-field" id="tM" inputmode="decimal" value="${esc(formatInputNumber(initial?.monthlyCap))}" /></div>
    </div>
    <div class="c-expense small" id="tErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-text" type="button" data-close-modal>Cancelar</button><button class="btn btn-primary" type="button" id="btnSaveTag">Salvar</button></div>
  `, (sheet) => {
    sheet.querySelectorAll('[data-ttype]').forEach((b) => b.addEventListener('click', () => {
      type = b.getAttribute('data-ttype');
      sheet.querySelectorAll('[data-ttype]').forEach((x) => x.classList.toggle('selected', x === b));
    }));
    sheet.querySelectorAll('[data-tcol]').forEach((b) => b.addEventListener('click', () => {
      colorHex = b.getAttribute('data-tcol');
      sheet.querySelectorAll('[data-tcol]').forEach((x) => { x.style.border = x === b ? '3px solid var(--text)' : 'none'; });
    }));
    sheet.querySelector('#btnSaveTag').addEventListener('click', () => {
      try {
        const payload = {
          name: sheet.querySelector('#tName').value,
          type,
          colorHex,
          weeklyCap: parseBrlInput(sheet.querySelector('#tW').value) || null,
          monthlyCap: parseBrlInput(sheet.querySelector('#tM').value) || null
        };
        if (initial) store.updateTagCaps(initial.id, payload);
        else store.createTag(payload);
        closeModal();
        showToast('Etiqueta salva!');
      } catch (e) {
        sheet.querySelector('#tErr').textContent = e.message;
      }
    });
  });
}

function openSimpleAmountDialog({ title, subtitle, initialVal = 0, withNote = false, initialNote = '', initialDate = Date.now(), confirmLabel = 'Salvar', maxAllowed = null, onConfirm }) {
  openModalHtml(`
    <div class="row-between"><div class="title-md">${esc(title)}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    ${subtitle ? `<div class="muted small">${esc(subtitle)}</div>` : ''}
    <div class="form-group"><label class="form-label">Valor (R$)</label><input class="input-field" id="saVal" inputmode="decimal" value="${esc(formatInputNumber(initialVal))}" /></div>
    ${withNote ? `
      <div class="form-group"><label class="form-label">Observação</label><input class="input-field" id="saNote" value="${esc(initialNote)}" /></div>
      <div class="form-group"><label class="form-label">Data</label><input class="input-field" id="saDate" type="date" value="${esc(toIsoInputDate(initialDate))}" /></div>
    ` : ''}
    <div class="c-expense small" id="saErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-text" type="button" data-close-modal>Cancelar</button><button class="btn btn-primary" type="button" id="btnSaOk">${esc(confirmLabel)}</button></div>
  `, (sheet) => {
    sheet.querySelector('#btnSaOk').addEventListener('click', () => {
      const val = parseBrlInput(sheet.querySelector('#saVal').value);
      const err = sheet.querySelector('#saErr');
      if (val == null || val <= 0) { err.textContent = 'Informe um valor maior que zero.'; return; }
      if (maxAllowed != null && val > maxAllowed + 0.005) { err.textContent = `Máximo permitido: ${formatBrl(maxAllowed)}.`; return; }
      const note = withNote ? sheet.querySelector('#saNote').value : '';
      const dt = withNote ? parseBrOrIsoDateMillis(sheet.querySelector('#saDate').value, initialDate) : Date.now();
      if (dt == null) { err.textContent = 'Data inválida.'; return; }
      closeModal();
      onConfirm(val, note, dt);
    });
  });
}

function openPlannedIncomeDialog(initial = null) {
  let recurring = initial ? initial.item.isRecurring : true;
  openModalHtml(`
    <div class="row-between"><div class="title-md">${initial ? 'Editar Entrada Planejada' : 'Planejar Entrada a Receber'}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="form-group"><label class="form-label">Descrição</label><input class="input-field" id="piName" placeholder="Ex: Salário, Freela, Parcela" value="${esc(initial?.item.name || '')}" /></div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">Dia previsto</label><input class="input-field" id="piDay" inputmode="numeric" value="${initial?.item.expectedDay || 5}" /></div>
      <div class="form-group"><label class="form-label">Valor previsto (R$)</label><input class="input-field" id="piAmt" inputmode="decimal" value="${esc(formatInputNumber(initial?.item.expectedAmount))}" /></div>
    </div>
    <button class="chip ${recurring ? 'selected' : ''}" type="button" id="btnPiRec">${recurring ? '✓ Repetir todo mês' : 'Apenas este mês'}</button>
    <div class="c-expense small" id="piErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-text" type="button" data-close-modal>Cancelar</button><button class="btn btn-primary" type="button" id="btnPiSave">Salvar</button></div>
  `, (sheet) => {
    const recBtn = sheet.querySelector('#btnPiRec');
    recBtn.addEventListener('click', () => {
      recurring = !recurring;
      recBtn.classList.toggle('selected', recurring);
      recBtn.textContent = recurring ? '✓ Repetir todo mês' : 'Apenas este mês';
    });
    sheet.querySelector('#btnPiSave').addEventListener('click', () => {
      const name = sheet.querySelector('#piName').value.trim();
      const day = Number(sheet.querySelector('#piDay').value) || 0;
      const amt = parseBrlInput(sheet.querySelector('#piAmt').value);
      const err = sheet.querySelector('#piErr');
      if (!name) { err.textContent = 'Informe o nome.'; return; }
      if (day < 1 || day > 31) { err.textContent = 'Dia entre 1 e 31.'; return; }
      if (amt == null || amt <= 0) { err.textContent = 'Valor inválido.'; return; }
      closeModal();
      if (initial) store.updatePlannedIncome(initial.item.id, { name, expectedDay: day, expectedAmount: amt, isRecurring: recurring });
      else store.createPlannedIncome({ name, expectedDay: day, expectedAmount: amt, isRecurring: recurring });
      showToast('Entrada planejada salva!');
    });
  });
}

function openFixedBillDialog(ov, initial = null) {
  const tags = ov.tagStatuses.map((s) => s.tag);
  let tagId = initial?.bill.tagId || (tags.find((t) => t.type === TagType.FIXED)?.id || tags[0]?.id || 1);
  openModalHtml(`
    <div class="row-between"><div class="title-md">${initial ? 'Editar Conta Fixa' : 'Nova Conta Fixa'}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="form-group"><label class="form-label">Nome</label><input class="input-field" id="fbName" placeholder="Ex: Energia, Água, Internet" value="${esc(initial?.bill.name || '')}" /></div>
    <div class="grid-2">
      <div class="form-group"><label class="form-label">Dia vencimento</label><input class="input-field" id="fbDay" inputmode="numeric" value="${initial?.bill.dueDay || 10}" /></div>
      <div class="form-group"><label class="form-label">Valor previsto (R$)</label><input class="input-field" id="fbAmt" inputmode="decimal" value="${esc(formatInputNumber(initial?.bill.expectedAmount))}" /></div>
    </div>
    <div class="chips-row">${tags.map((t) => `<button class="chip ${t.id === tagId ? 'selected' : ''}" type="button" data-fbtag="${t.id}">${esc(t.name)}</button>`).join('')}</div>
    <div class="c-expense small" id="fbErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-text" type="button" data-close-modal>Cancelar</button><button class="btn btn-primary" type="button" id="btnFbSave">Salvar</button></div>
  `, (sheet) => {
    sheet.querySelectorAll('[data-fbtag]').forEach((b) => b.addEventListener('click', () => {
      tagId = Number(b.getAttribute('data-fbtag'));
      sheet.querySelectorAll('[data-fbtag]').forEach((x) => x.classList.toggle('selected', x === b));
    }));
    sheet.querySelector('#btnFbSave').addEventListener('click', () => {
      const name = sheet.querySelector('#fbName').value.trim();
      const day = Number(sheet.querySelector('#fbDay').value) || 0;
      const amt = parseBrlInput(sheet.querySelector('#fbAmt').value) || 0;
      const err = sheet.querySelector('#fbErr');
      if (!name) { err.textContent = 'Informe o nome da conta.'; return; }
      if (day < 1 || day > 31) { err.textContent = 'Dia entre 1 e 31.'; return; }
      closeModal();
      if (initial) store.updateFixedBill(initial.bill.id, { name, tagId, dueDay: day, expectedAmount: amt });
      else store.createFixedBill({ name, tagId, dueDay: day, expectedAmount: amt });
      showToast('Conta fixa salva!');
    });
  });
}

function openGoalDialog(ov, initial = null) {
  const tags = ov.tagStatuses.map((s) => s.tag);
  openModalHtml(`
    <div class="row-between"><div class="title-md">${initial ? 'Editar Meta' : 'Novo Gasto Planejado'}</div><button class="icon-btn" type="button" data-close-modal>×</button></div>
    <div class="form-group"><label class="form-label">Nome</label><input class="input-field" id="gName" placeholder="Ex: Geladeira, Viagem..." value="${esc(initial?.goal.name || '')}" /></div>
    <div class="form-group"><label class="form-label">Valor Alvo (R$)</label><input class="input-field" id="gTarget" inputmode="decimal" value="${esc(formatInputNumber(initial?.goal.targetAmount))}" /></div>
    <div class="form-group"><label class="form-label">Etiqueta (opc.)</label>
      <select class="input-field" id="gTag">
        <option value="">Sem etiqueta</option>
        ${tags.map((t) => `<option value="${t.id}" ${t.id === initial?.goal.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">Observações</label><input class="input-field" id="gNotes" value="${esc(initial?.goal.notes || '')}" /></div>
    <div class="c-expense small" id="gErr"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-text" type="button" data-close-modal>Cancelar</button><button class="btn btn-primary" type="button" id="btnGSave">Salvar</button></div>
  `, (sheet) => {
    sheet.querySelector('#btnGSave').addEventListener('click', () => {
      const name = sheet.querySelector('#gName').value.trim();
      const targetAmount = parseBrlInput(sheet.querySelector('#gTarget').value);
      const tagId = sheet.querySelector('#gTag').value ? Number(sheet.querySelector('#gTag').value) : null;
      const notes = sheet.querySelector('#gNotes').value;
      const err = sheet.querySelector('#gErr');
      if (!name) { err.textContent = 'Informe o nome.'; return; }
      if (targetAmount == null || targetAmount <= 0) { err.textContent = 'Valor inválido.'; return; }
      closeModal();
      if (initial) store.updatePlannedGoal(initial.goal.id, { name, targetAmount, tagId, notes });
      else store.createPlannedGoal({ name, targetAmount, tagId, notes });
      showToast('Meta salva!');
    });
  });
}

// ============================================================
// Renderizador Principal + Bindings
// ============================================================

function renderNav() {
  const mkItem = (t) => `
    <button class="nav-item ${state.tab === t.id ? 'active' : ''}" type="button" data-nav-tab="${t.id}">
      <span class="nav-ico">${t.icon}</span>
      <span>${esc(t.label)}</span>
    </button>
  `;
  const html = TABS.map(mkItem).join('');
  dom.bottomNav.innerHTML = html;
  dom.sideRail.innerHTML = html;
  document.querySelectorAll('[data-nav-tab]').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.getAttribute('data-nav-tab')));
  });
}

function render(ov = store.getOverview()) {
  renderNav();
  dom.lblMonthTitle.textContent = formatYearMonthBr(ov.selectedMonth);

  if (state.tab === 'HOME') dom.mainContent.innerHTML = renderHome(ov);
  else if (state.tab === 'TRANSACTIONS') dom.mainContent.innerHTML = renderTransactions(ov);
  else if (state.tab === 'EXTRAS') dom.mainContent.innerHTML = renderExtras(ov);
  else if (state.tab === 'BUDGET') dom.mainContent.innerHTML = renderBudget(ov);
  else if (state.tab === 'GOALS') dom.mainContent.innerHTML = renderGoals(ov);
  else if (state.tab === 'REPORTS') dom.mainContent.innerHTML = renderReports(ov);

  bindContentEvents(ov);
}

function bindContentEvents(ov) {
  const root = dom.mainContent;

  root.querySelector('#btnDismissIosTip')?.addEventListener('click', () => {
    state.iosBannerDismissed = true;
    render(ov);
  });

  root.querySelectorAll('[data-go-tab]').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.getAttribute('data-go-tab')));
  });

  root.querySelectorAll('[data-open-income], #btnQuickIncome').forEach((b) => {
    b.addEventListener('click', () => openIncomeDialog(ov));
  });
  root.querySelectorAll('[data-open-expense], #btnQuickExpense').forEach((b) => {
    b.addEventListener('click', () => openExpenseDialog(ov));
  });

  // Week pills on Home
  root.querySelectorAll('[data-select-week]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number(b.getAttribute('data-select-week'));
      if (state.selectedWeekNumber === n) state.showWeekExpenses = !state.showWeekExpenses;
      else { state.selectedWeekNumber = n; state.showWeekExpenses = true; }
      render(ov);
    });
  });
  root.querySelector('#btnToggleWeekItems')?.addEventListener('click', () => {
    state.showWeekExpenses = !state.showWeekExpenses;
    render(ov);
  });

  // Transactions Search (sem perder foco!)
  const txSearch = root.querySelector('#txSearchInput');
  if (txSearch) {
    txSearch.addEventListener('input', () => {
      state.txQuery = txSearch.value;
      const host = root.querySelector('#txResultsHost');
      if (host) {
        host.innerHTML = renderTransactionsResultsHtml(ov);
        bindRecordButtons(ov, host);
      }
    });
  }

  root.querySelectorAll('[data-tx-filter]').forEach((b) => b.addEventListener('click', () => {
    state.txFilter = b.getAttribute('data-tx-filter');
    if (state.txFilter === 'INCOMES' || state.txFilter === 'EXTRA') state.txTagId = null;
    render(ov);
  }));
  root.querySelectorAll('[data-tx-week]').forEach((b) => b.addEventListener('click', () => {
    const val = b.getAttribute('data-tx-week');
    const n = val ? Number(val) : null;
    state.txWeekNumber = state.txWeekNumber === n ? null : n;
    render(ov);
  }));
  root.querySelectorAll('[data-tx-tag]').forEach((b) => b.addEventListener('click', () => {
    const val = b.getAttribute('data-tx-tag');
    const id = val ? Number(val) : null;
    state.txTagId = state.txTagId === id ? null : id;
    render(ov);
  }));

  // Extras actions
  root.querySelectorAll('#btnNewExtra, #btnNewExtra2').forEach((b) => b.addEventListener('click', () => openExtraExpenseDialog(ov, null, false)));
  root.querySelector('#btnNewExtraCoupon')?.addEventListener('click', () => openExtraExpenseDialog(ov, null, true));
  root.querySelectorAll('#btnNewRecurring, #btnNewRecurring2').forEach((b) => b.addEventListener('click', () => openExtraRecurringDialog(null)));
  root.querySelectorAll('#btnExtraCaps, #btnExtraCaps2').forEach((b) => b.addEventListener('click', () => openExtraCapsDialog(ov)));
  root.querySelectorAll('[data-extra-filter]').forEach((b) => b.addEventListener('click', () => {
    state.extraFilter = b.getAttribute('data-extra-filter');
    render(ov);
  }));
  root.querySelectorAll('[data-launch-rec]').forEach((b) => b.addEventListener('click', () => {
    const rec = ov.extraordinary.activeRecurrings.find((r) => r.id === Number(b.getAttribute('data-launch-rec')));
    if (rec) openLaunchRecurringDialog(ov, rec);
  }));
  root.querySelectorAll('[data-edit-rec]').forEach((b) => b.addEventListener('click', () => {
    const rec = ov.extraordinary.activeRecurrings.find((r) => r.id === Number(b.getAttribute('data-edit-rec')));
    if (rec) openExtraRecurringDialog(rec);
  }));
  root.querySelectorAll('[data-del-rec]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-rec'));
    openConfirmDelete({ title: 'Remover recorrente?', message: 'Lançamentos já feitos continuam salvos.', onConfirm: () => { store.deleteExtraRecurring(id); showToast('Recorrente removido.'); } });
  }));

  // Budget & Card
  root.querySelector('#btnCreateTag')?.addEventListener('click', () => openTagDialog(null));
  root.querySelectorAll('[data-edit-tag]').forEach((b) => b.addEventListener('click', () => {
    const t = ov.tagStatuses.find((s) => s.tag.id === Number(b.getAttribute('data-edit-tag')))?.tag;
    if (t) openTagDialog(t);
  }));
  root.querySelectorAll('[data-del-tag]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-tag'));
    openConfirmDelete({ title: 'Remover etiqueta?', message: 'Os gastos existentes serão preservados no extrato.', onConfirm: () => { try { store.archiveTag(id); showToast('Etiqueta removida.'); } catch (e) { showToast(e.message); } } });
  }));
  root.querySelector('#btnAdjustCard')?.addEventListener('click', () => openSimpleAmountDialog({
    title: 'Valor fechado da fatura',
    subtitle: 'Informe o total completo da fatura deste mês.',
    initialVal: ov.creditCard.declaredAmount ?? ov.creditCard.effectiveTotal,
    onConfirm: (val) => { store.setCreditCardDeclaredAmount(val > 0 ? val : null); showToast('Fatura atualizada!'); }
  }));
  root.querySelector('#btnPayCard')?.addEventListener('click', () => openSimpleAmountDialog({
    title: 'Pagar Fatura do Cartão',
    subtitle: 'Descontado uma única vez do Saldo Real em Mãos.',
    initialVal: ov.creditCard.effectiveTotal,
    confirmLabel: 'Confirmar pagamento',
    onConfirm: (val) => { store.payCreditCardInvoice(val); showToast('Fatura paga!'); }
  }));
  root.querySelector('#btnUndoPayCard')?.addEventListener('click', () => { store.undoPayCreditCardInvoice(); showToast('Pagamento desfeito.'); });

  // Reserve & Goals
  root.querySelector('#btnResDeposit')?.addEventListener('click', () => openSimpleAmountDialog({
    title: 'Aportar na Reserva',
    subtitle: 'Separa dinheiro do Saldo em Mãos para a Reserva.',
    withNote: true,
    confirmLabel: 'Aportar',
    onConfirm: (val, note, dt) => { store.addReserveDeposit(val, note, dt); showToast('Aporte registrado!'); }
  }));
  root.querySelector('#btnResWithdraw')?.addEventListener('click', () => openSimpleAmountDialog({
    title: 'Retirar da Reserva',
    subtitle: `Disponível: ${formatBrl(ov.reserveBalance)}`,
    withNote: true,
    maxAllowed: ov.reserveBalance,
    confirmLabel: 'Retirar',
    onConfirm: (val, note, dt) => { store.addReserveWithdrawal(val, note, dt); showToast('Retirada registrada!'); }
  }));
  root.querySelectorAll('[data-edit-res]').forEach((b) => b.addEventListener('click', () => {
    const m = ov.recentReserveMovements.find((x) => x.id === Number(b.getAttribute('data-edit-res')));
    if (m) openSimpleAmountDialog({
      title: 'Editar Movimentação da Reserva',
      initialVal: m.amount,
      withNote: true,
      initialNote: m.note,
      initialDate: m.createdAt,
      onConfirm: (val, note, dt) => { store.updateReserveMovement(m.id, { amount: val, type: m.type, note, createdAt: dt }); showToast('Movimentação atualizada!'); }
    });
  }));
  root.querySelectorAll('[data-del-res]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-res'));
    openConfirmDelete({ title: 'Excluir movimentação?', message: 'O saldo da Reserva e o Saldo em Mãos serão recalculados.', onConfirm: () => { store.deleteReserveMovement(id); showToast('Excluída!'); } });
  }));

  root.querySelector('#btnNewGoal')?.addEventListener('click', () => openGoalDialog(ov));
  root.querySelectorAll('[data-edit-goal]').forEach((b) => b.addEventListener('click', () => {
    const gs = ov.goals.find((g) => g.goal.id === Number(b.getAttribute('data-edit-goal')));
    if (gs) openGoalDialog(ov, gs);
  }));
  root.querySelectorAll('[data-del-goal]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-goal'));
    openConfirmDelete({ title: 'Excluir meta?', message: 'Valores destinados retornarão ao Saldo em Mãos.', onConfirm: () => { store.deletePlannedGoal(id); showToast('Meta removida.'); } });
  }));
  root.querySelectorAll('[data-contrib-goal]').forEach((b) => b.addEventListener('click', () => {
    const [gidStr, isDepStr] = b.getAttribute('data-contrib-goal').split(':');
    const gs = ov.goals.find((g) => g.goal.id === Number(gidStr));
    const isDep = isDepStr === '1';
    if (!gs) return;
    openSimpleAmountDialog({
      title: isDep ? `Destinar p/: ${gs.goal.name}` : `Resgatar de: ${gs.goal.name}`,
      subtitle: isDep ? `Falta ${formatBrl(gs.remainingAmount)}` : `Acumulado: ${formatBrl(gs.savedAmount)}`,
      withNote: true,
      maxAllowed: isDep ? null : gs.savedAmount,
      confirmLabel: isDep ? 'Destinar' : 'Resgatar',
      onConfirm: (val, note, dt) => { store.contributeToGoal(gs.goal.id, { amount: isDep ? val : -val, note, createdAt: dt }); showToast('Movimentação salva!'); }
    });
  }));
  root.querySelectorAll('[data-buy-goal]').forEach((b) => b.addEventListener('click', () => {
    const gs = ov.goals.find((g) => g.goal.id === Number(b.getAttribute('data-buy-goal')));
    if (!gs) return;
    const tagId = gs.goal.tagId || (ov.tagStatuses[0]?.tag.id || 1);
    openSimpleAmountDialog({
      title: `Concluir Compra: ${gs.goal.name}`,
      subtitle: `Valor na caixinha: ${formatBrl(gs.savedAmount)}. O que faltar sai do Saldo em Mãos.`,
      initialVal: gs.goal.targetAmount,
      withNote: true,
      confirmLabel: 'Concluir Compra',
      onConfirm: (val, note, dt) => { store.completeGoalPurchase(gs.goal.id, { purchaseAmount: val, tagId, note, purchasedAt: dt }); showToast('Compra concluída!'); }
    });
  }));
  root.querySelectorAll('[data-reopen-goal]').forEach((b) => b.addEventListener('click', () => { store.reopenGoal(Number(b.getAttribute('data-reopen-goal'))); showToast('Meta reaberta.'); }));
  root.querySelectorAll('[data-edit-gcontrib]').forEach((b) => b.addEventListener('click', () => {
    const c = ov.recentGoalContributions.find((x) => x.id === Number(b.getAttribute('data-edit-gcontrib')));
    if (c) openSimpleAmountDialog({
      title: 'Editar Aporte da Meta',
      initialVal: Math.abs(c.amount),
      withNote: true,
      initialNote: c.note,
      initialDate: c.createdAt,
      onConfirm: (val, note, dt) => { store.updateGoalContribution(c.id, { amount: c.amount >= 0 ? val : -val, note, createdAt: dt }); showToast('Aporte atualizado!'); }
    });
  }));
  root.querySelectorAll('[data-del-gcontrib]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-gcontrib'));
    openConfirmDelete({ title: 'Excluir aporte?', message: 'O saldo da caixinha será recalculado.', onConfirm: () => { store.deleteGoalContribution(id); showToast('Aporte excluído.'); } });
  }));

  // Reports & Planned Incomes & Fixed Bills
  root.querySelectorAll('[data-toggle-rep-week]').forEach((el) => el.addEventListener('click', () => {
    const w = Number(el.getAttribute('data-toggle-rep-week'));
    state.expandedReportWeek = state.expandedReportWeek === w ? null : w;
    render(ov);
  }));
  root.querySelectorAll('#btnAddPlannedIncome, #btnAddPlanned2').forEach((b) => b.addEventListener('click', () => openPlannedIncomeDialog(null)));
  root.querySelectorAll('[data-edit-planned]').forEach((b) => b.addEventListener('click', () => {
    const pi = ov.plannedIncomes.find((p) => p.item.id === Number(b.getAttribute('data-edit-planned')));
    if (pi) openPlannedIncomeDialog(pi);
  }));
  root.querySelectorAll('[data-del-planned]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-planned'));
    openConfirmDelete({ title: 'Excluir entrada planejada?', message: 'Deseja remover este planejamento?', onConfirm: () => { store.deletePlannedIncome(id); showToast('Removida.'); } });
  }));
  root.querySelectorAll('[data-recv-planned]').forEach((b) => b.addEventListener('click', () => {
    const pi = ov.plannedIncomes.find((p) => p.item.id === Number(b.getAttribute('data-recv-planned')));
    if (pi) openSimpleAmountDialog({
      title: `Receber: ${pi.item.name}`,
      subtitle: 'Confirme o valor e data para somar no Saldo Real em Mãos.',
      initialVal: pi.effectiveAmount,
      withNote: true,
      initialNote: pi.item.name,
      confirmLabel: 'Confirmar Recebimento',
      onConfirm: (val, _, dt) => { store.receivePlannedIncome(pi.item.id, { actualAmount: val, receivedAt: dt }); showToast('Recebimento confirmado!'); }
    });
  }));
  root.querySelectorAll('[data-undo-planned]').forEach((b) => b.addEventListener('click', () => { store.undoReceivePlannedIncome(Number(b.getAttribute('data-undo-planned'))); showToast('Recebimento desfeito.'); }));

  root.querySelector('#btnCreateBill')?.addEventListener('click', () => openFixedBillDialog(ov, null));
  root.querySelectorAll('[data-edit-bill]').forEach((b) => b.addEventListener('click', () => {
    const fb = ov.fixedBills.find((x) => x.bill.id === Number(b.getAttribute('data-edit-bill')));
    if (fb) openFixedBillDialog(ov, fb);
  }));
  root.querySelectorAll('[data-del-bill]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.getAttribute('data-del-bill'));
    openConfirmDelete({ title: 'Remover conta fixa?', message: 'Pagamentos já realizados continuam no extrato.', onConfirm: () => { store.deactivateFixedBill(id); showToast('Conta fixa removida.'); } });
  }));
  root.querySelectorAll('[data-prev-bill]').forEach((b) => b.addEventListener('click', () => {
    const fb = ov.fixedBills.find((x) => x.bill.id === Number(b.getAttribute('data-prev-bill')));
    if (fb) openSimpleAmountDialog({
      title: `Valor Previsto: ${fb.bill.name}`,
      initialVal: fb.currentAmount,
      onConfirm: (val) => { store.setOccurrenceExpectedAmount(fb.bill.id, val); showToast('Valor previsto atualizado!'); }
    });
  }));
  root.querySelectorAll('[data-pay-bill]').forEach((b) => b.addEventListener('click', () => {
    const fb = ov.fixedBills.find((x) => x.bill.id === Number(b.getAttribute('data-pay-bill')));
    if (fb) openSimpleAmountDialog({
      title: `Dar Baixa: ${fb.bill.name}`,
      subtitle: 'Será registrado como pago no mês.',
      initialVal: fb.currentAmount,
      withNote: true,
      initialNote: fb.bill.name,
      confirmLabel: 'Confirmar Pagamento',
      onConfirm: (val, _, dt) => { store.payFixedBill(fb.bill.id, { actualAmount: val, paymentMethod: PaymentMethod.CASH_PIX_DEBIT, paidAt: dt }); showToast('Baixa realizada!'); }
    });
  }));
  root.querySelectorAll('[data-undo-bill]').forEach((b) => b.addEventListener('click', () => { store.undoPayFixedBill(Number(b.getAttribute('data-undo-bill'))); showToast('Baixa desfeita.'); }));

  bindRecordButtons(ov, root);
}

function bindRecordButtons(ov, scope) {
  scope.querySelector('#btnClearTxFilters')?.addEventListener('click', () => {
    state.txFilter = 'ALL';
    state.txTagId = null;
    state.txWeekNumber = null;
    state.txQuery = '';
    render(ov);
  });
  scope.querySelectorAll('[data-edit-income]').forEach((b) => b.addEventListener('click', () => {
    const inc = ov.recentIncomes.find((i) => i.id === Number(b.getAttribute('data-edit-income')));
    if (inc) openIncomeDialog(ov, inc);
  }));
  scope.querySelectorAll('[data-del-income]').forEach((b) => b.addEventListener('click', () => {
    const inc = ov.recentIncomes.find((i) => i.id === Number(b.getAttribute('data-del-income')));
    if (inc) openConfirmDelete({ title: 'Excluir entrada?', message: `Remover "${inc.description}" (${formatBrl(inc.amount)})?`, onConfirm: () => { store.deleteIncomeFraction(inc.id); showToast('Entrada removida.'); } });
  }));
  scope.querySelectorAll('[data-edit-expense]').forEach((b) => b.addEventListener('click', () => {
    const rec = ov.recentExpenses.find((r) => r.expense.id === Number(b.getAttribute('data-edit-expense')));
    if (rec) openExpenseDialog(ov, rec.expense);
  }));
  scope.querySelectorAll('[data-del-expense]').forEach((b) => b.addEventListener('click', () => {
    const rec = ov.recentExpenses.find((r) => r.expense.id === Number(b.getAttribute('data-del-expense')));
    if (rec) openConfirmDelete({ title: 'Excluir gasto?', message: `Remover "${rec.expense.description}" (${formatBrl(rec.expense.amount)})?`, onConfirm: () => { store.deleteExpense(rec.expense.id); showToast('Lançamento removido.'); } });
  }));
  scope.querySelectorAll('[data-edit-extra]').forEach((b) => b.addEventListener('click', () => {
    const ext = ov.extraordinary.expensesInMonth.find((e) => e.id === Number(b.getAttribute('data-edit-extra')));
    if (ext) openExtraExpenseDialog(ov, ext);
  }));
  scope.querySelectorAll('[data-del-extra]').forEach((b) => b.addEventListener('click', () => {
    const ext = ov.extraordinary.expensesInMonth.find((e) => e.id === Number(b.getAttribute('data-del-extra')));
    if (ext) openConfirmDelete({ title: 'Excluir despesa extraordinária?', message: `Remover "${ext.description}" (${formatBrl(ext.amount)})?`, onConfirm: () => { store.deleteExtraExpense(ext.id); showToast('Despesa excluída.'); } });
  }));

  scope.querySelectorAll('[data-open-receipt]').forEach((b) => b.addEventListener('click', () => {
    const [refType, idStr, idxStr] = b.getAttribute('data-open-receipt').split(':');
    const id = Number(idStr);
    const idx = Number(idxStr);
    const target = refType === 'exp'
      ? ov.recentExpenses.find((r) => r.expense.id === id)?.expense
      : ov.extraordinary.expensesInMonth.find((e) => e.id === id);
    const rec = target?.receipts?.[idx];
    if (rec) openReceiptViewer(rec);
  }));

  scope.querySelectorAll('[data-open-coupon]').forEach((b) => b.addEventListener('click', () => {
    const [refType, idStr] = b.getAttribute('data-open-coupon').split(':');
    const id = Number(idStr);
    const target = refType === 'exp'
      ? ov.recentExpenses.find((r) => r.expense.id === id)?.expense
      : ov.extraordinary.expensesInMonth.find((e) => e.id === id);
    if (target?.coupon) openCouponDetails(target.coupon);
  }));
}

// ============================================================
// Inicialização
// ============================================================

document.getElementById('btnPrevMonth').addEventListener('click', () => store.setMonth(stepYearMonth(store.selectedMonth, -1)));
document.getElementById('btnNextMonth').addEventListener('click', () => store.setMonth(stepYearMonth(store.selectedMonth, 1)));
document.getElementById('btnResetMonth').addEventListener('click', () => store.setMonth(currentYearMonth()));
document.getElementById('btnSettings').addEventListener('click', () => openSettingsDialog(store.getOverview()));

dom.fabMain.addEventListener('click', () => setFabExpanded(!state.fabExpanded));
dom.fabScrim.addEventListener('click', () => setFabExpanded(false));
document.getElementById('fabAddExtra').addEventListener('click', () => { setFabExpanded(false); openExtraExpenseDialog(store.getOverview()); });
document.getElementById('fabAddExpense').addEventListener('click', () => { setFabExpanded(false); openExpenseDialog(store.getOverview()); });
document.getElementById('fabAddIncome').addEventListener('click', () => { setFabExpanded(false); openIncomeDialog(store.getOverview()); });

dom.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === dom.modalBackdrop) closeModal();
});

store.subscribe((ov) => render(ov));
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
