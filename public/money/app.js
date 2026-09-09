(() => {
  'use strict';

  const STORAGE_KEY = 'yoryoku-finance-v2';
  const CLOUD_USER_KEY = 'yoryoku-cloud-user';
  const MIGRATION_BACKUP_KEY = 'yoryoku-finance-backup-pre-v6';
  const SCHEMA_VERSION = 6;
  const finance = window.FinanceEngine;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  // 「今日」は必ず日本時間で判定する。UTCのままだと日本時間の0時〜9時に前日を返してしまう。
  const today = () => finance.jstToday();
  const nowIso = () => new Date().toISOString();
  const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const ROLE_LABELS = {
    primary: '基準口座',
    spending: '自由利用口座',
    savings: '貯金口座',
    investment: '投資・NISA口座',
    other: 'その他'
  };

  const KIND_META = {
    payment: { label: '支払い', badge: 'badge-payment', icon: 'payment' },
    income: { label: '収入', badge: 'badge-income', icon: 'income' },
    saving: { label: '貯金', badge: 'badge-saving', icon: 'saving' },
    nisa: { label: 'NISA', badge: 'badge-nisa', icon: 'nisa' },
    reimbursement: { label: '立替回収', badge: 'badge-income', icon: 'income' },
    transfer: { label: '振込', badge: 'badge-transfer', icon: 'transfer' },
    adjustment: { label: '残高調整', badge: 'badge-income', icon: 'adjustment' }
  };

  const ICON_PATHS = {
    payment: '<path d="m5 5 13 13M18 18H9M18 18V9"/>',
    income: '<path d="M19 19 6 6M6 6h9M6 6v9"/>',
    saving: '<path d="M5 8.5A3.5 3.5 0 0 1 8.5 5h7A3.5 3.5 0 0 1 19 8.5v6a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 14.5Z"/><path d="M8 5V3h3v2M8 12h.01M16 12h.01"/>',
    nisa: '<path d="M4 19V9M10 19V5M16 19v-8M22 19V3"/><path d="M3 19h20"/>',
    transfer: '<path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/>',
    shift: '<rect x="2.5" y="4" width="14" height="14" rx="2"/><path d="M12.5 2v4M6.5 2v4M2.5 9h14"/><circle cx="17.5" cy="16.5" r="4.5"/><path d="M17.5 14.4v2.3l1.6 1"/>',
    adjustment: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
    safe: '<path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6Z"/><path d="m8.5 12 2.3 2.3 4.7-5"/>'
  };

  function icon(name, className = '') {
    return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.adjustment}</svg>`;
  }

  let state = null;
  let cloud = null;
  let syncStatus = 'saved';
  let currentPage = 'home';
  let planFilter = 'all';
  let recordFilter = 'settled';
  // 記録ページの集計期間。'month' は月単位、'custom' はユーザー指定の期間。
  let recordRangeMode = 'month';
  let recordMonth = '';
  let recordStart = '';
  let recordEnd = '';
  let recordBasis = 'real';
  let recordCategory = '';
  // 記録ページの中のタブ。'transactions'（取引）と 'receipts'（レシート）。永続化はしない。
  let recordTab = 'transactions';
  let searchQuery = '';
  let whatIfAmount = 0;
  let importCandidates = [];
  // レシートは state に入れない（1ドキュメント方式の上限に当たるため）。Firestoreの購読結果をここに置く。
  let receipts = [];
  let receiptItems = [];
  // 品名の名寄せ辞書。これも state には入れず、Firestoreの購読結果をここに置く。
  let itemAliases = [];
  let receiptDraft = null;
  let openReceiptId = '';
  // レシートを開いた時点の品名（行ID→rawName）。保存時に書き換えを見つけて名寄せを学ぶ。
  let receiptOriginalNames = new Map();
  // 「まとめる」モーダルで選んでいる元の品名 { key, name }
  let mergeSource = null;
  let reviewQueue = [];
  let reviewIndex = 0;
  let reviewReasonFor = '';
  let toastTimer = null;

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: 'local',
      meta: { onboarded: false, createdAt: nowIso(), updatedAt: nowIso() },
      accounts: [],
      cards: [],
      workEntries: [],
      transactions: [],
      recurringPlans: [],
      settings: {
        defenseLine: 150000,
        // 判定期限のモード。現在は 'legacy14'（毎月14日締め）しか選択肢がなく、
        // getNextDeadline() は14日を直接使っている。つまり保存はされるが、値を変えても効かない。
        // 別の締め日を足すときは getNextDeadline() がこの値を読むように直すこと。
        deadlineMode: 'legacy14',
        cashflowHorizonDays: 90,
        // ふりかえりを始める曜日（0=日曜）。この曜日以降、対象が残っている間はホームに案内を出す。
        reviewDayOfWeek: 0,
        holidayOverrides: {},
        wage: {
          hourlyRate: 0,
          // 給与試算は暦月(1日〜末日)＋翌月15日支給ルールを使う。
          // closingDay / paymentDay / paymentMonthOffset は旧設定との互換のために保持するだけで、
          // 給与試算には使用しない。
          periodMode: 'calendarMonth',
          salaryPaymentDay: 15,
          salaryMonthOffset: 1,
          depositAccountId: '',
          closingDay: 0,
          paymentDay: 25,
          paymentMonthOffset: 1,
          includeForecastInSpendable: false
        }
      }
    };
  }

  /**
   * 取引の日付を正規化する。
   *   transactionDate : 実際に利用・発生した日
   *   dueDate         : 銀行残高へ反映する日（カードの場合は引落予定日）
   * 旧データに transactionDate が無いカード取引は dueDate を暫定値として読み込み、
   * dateEstimated を立てて後からユーザーが修正できるようにする。
   */
  function normalizeTransactionDates(transaction) {
    const dueDate = transaction.dueDate || today();
    const hasUsageDate = Boolean(transaction.transactionDate);
    const origin = transaction.origin || '';
    return {
      ...transaction,
      dueDate,
      transactionDate: hasUsageDate ? transaction.transactionDate : dueDate,
      dateEstimated: transaction.dateEstimated === true || (!hasUsageDate && Boolean(transaction.cardId)),
      // 利用時刻。UTCのISO文字列で持ち、表示と並べ替えのときだけ日本時間へ直す。
      transactionAt: transaction.transactionAt || '',
      // 請求総額に吸収されたときに、その総額のIDを入れる
      absorbedBy: transaction.absorbedBy || '',
      origin,
      // カード取引の粒度。手入力は請求総額、メール取込は明細として扱う。
      entryType: transaction.cardId
        ? (transaction.entryType || (origin === 'mail-import' ? 'itemized' : 'statement'))
        : ''
    };
  }

  /**
   * 取引オブジェクトを組み立てる唯一の入口。
   * 既定値を知っているのはこの関数だけにする（保存・取込・デモ・読み込みの4経路が共通で使う）。
   * フィールドを増やすときは、ここ1か所を直せばよい。
   * 渡されたオブジェクトの見覚えのないキーは、そのまま捨てられる。
   */
  function createTransaction(partial = {}) {
    const source = partial || {};
    const now = nowIso();
    const kind = source.kind || 'payment';
    const destinationAccountId = source.destinationAccountId || '';
    return normalizeTransactionDates({
      id: source.id || uid('event'),
      kind,
      amount: Number(source.amount || 0),
      dueDate: source.dueDate || today(),
      transactionDate: source.transactionDate || '',
      transactionAt: source.transactionAt || '',
      absorbedBy: source.absorbedBy || '',
      entryType: source.entryType || '',
      origin: source.origin || '',
      dateEstimated: source.dateEstimated === true,
      status: source.status || 'planned',
      sourceAccountId: source.sourceAccountId || '',
      destinationAccountId,
      transferType: source.transferType || (kind === 'transfer' && destinationAccountId ? 'internal' : 'external'),
      destinationName: source.destinationName || '',
      cardId: source.cardId || '',
      category: source.category || 'その他',
      memo: source.memo || '',
      lendingAmount: Number(source.lendingAmount || 0),
      affectsForecast: source.affectsForecast !== false,
      recurringPlanId: source.recurringPlanId || '',
      settledAt: source.settledAt || '',
      createdAt: source.createdAt || now,
      updatedAt: source.updatedAt || now
    });
  }

  /** スキーマ移行の前に、読み込んだ生データをそのままバックアップしておく（一度だけ） */
  function snapshotBeforeMigration(raw) {
    try {
      if (!raw || typeof raw !== 'object') return;
      if (Number(raw.schemaVersion || 0) >= SCHEMA_VERSION) return;
      if (localStorage.getItem(MIGRATION_BACKUP_KEY)) return;
      localStorage.setItem(MIGRATION_BACKUP_KEY, JSON.stringify({
        savedAt: nowIso(),
        schemaVersion: raw.schemaVersion || 0,
        state: raw
      }));
      console.info('スキーマ移行前のバックアップを保存しました');
    } catch (error) {
      console.warn('移行前バックアップを保存できませんでした', error);
    }
  }

  /**
   * v6より前に「請求総額を確定したのに、同じ請求サイクルの明細が未確定のまま残っている」
   * 状態を修正する。放置すると、その明細が二重に差し引かれてしまう。
   * 取引は消さず、吸収済みに変えるだけなので、総額をタップすれば内訳として見られる。
   */
  function absorbLegacyStatementDetails(migrated) {
    if (!Array.isArray(migrated?.transactions)) return 0;
    const absorbed = migrated.transactions
      .filter(item => item.status === 'settled' && item.entryType === 'statement' && item.cardId)
      .reduce((sum, statement) => sum + absorbStatementDetails(statement, migrated), 0);
    if (absorbed) console.info(`確定済みの請求総額に含まれる明細 ${absorbed}件を内訳にまとめました`);
    return absorbed;
  }

  /** 移行後に件数・金額合計が変わっていないことを確認する */
  function verifyMigration(raw, migrated) {
    if (!raw || !Array.isArray(raw.transactions)) return null;
    const count = list => (Array.isArray(list) ? list.length : 0);
    const sum = list => (Array.isArray(list) ? list : []).reduce((total, item) => total + Number(item.amount || 0), 0);
    const report = {
      accounts: { before: count(raw.accounts), after: count(migrated.accounts) },
      cards: { before: count(raw.cards), after: count(migrated.cards) },
      transactions: { before: count(raw.transactions), after: count(migrated.transactions) },
      workEntries: { before: count(raw.workEntries), after: count(migrated.workEntries) },
      transactionAmount: { before: sum(raw.transactions), after: sum(migrated.transactions) }
    };
    const mismatched = Object.entries(report).filter(([, value]) => value.before !== value.after);
    if (mismatched.length) console.warn('データ移行で件数または合計が変化しました', report);
    return report;
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return emptyState();
    if (Array.isArray(raw.accounts) && Array.isArray(raw.transactions)) {
      const base = emptyState();
      return {
        ...base,
        ...raw,
        schemaVersion: SCHEMA_VERSION,
        meta: { ...base.meta, ...(raw.meta || {}) },
        settings: {
          ...base.settings,
          ...(raw.settings || {}),
          holidayOverrides: { ...(raw.settings?.holidayOverrides || {}) },
          wage: { ...base.settings.wage, ...(raw.settings?.wage || {}) }
        },
        accounts: raw.accounts.map(account => ({
          id: account.id || uid('account'),
          name: account.name || '名称未設定',
          role: account.role || 'other',
          currentBalance: Number(account.currentBalance || 0),
          includeInSpendable: account.includeInSpendable !== false && !['savings', 'investment'].includes(account.role),
          reserveAmount: Number(account.reserveAmount || 0),
          isPrimary: Boolean(account.isPrimary)
        })),
        cards: Array.isArray(raw.cards) ? raw.cards.map(card => ({
          id: card.id || uid('card'),
          name: card.name || 'クレジットカード',
          accountId: card.accountId || card.withdrawalAccountId || '',
          closingDay: Number(card.closingDay || 0),
          paymentDay: Number(card.paymentDay || 0),
          // 締め月から支払月までのオフセット。既定は「締め月の翌月」。
          paymentMonthOffset: Number.isFinite(Number(card.paymentMonthOffset)) ? Number(card.paymentMonthOffset) : 1,
          createdAt: card.createdAt || nowIso(),
          updatedAt: card.updatedAt || nowIso()
        })) : [],
        workEntries: Array.isArray(raw.workEntries) ? raw.workEntries.map(entry => ({
          id: entry.id || uid('work'),
          date: entry.date || today(),
          hours: Math.max(Number(entry.hours) || 0, 0),
          status: entry.status === 'worked' ? 'worked' : 'planned',
          hourlyRateOverride: Math.max(Number(entry.hourlyRateOverride) || 0, 0),
          memo: entry.memo || '',
          createdAt: entry.createdAt || nowIso(),
          updatedAt: entry.updatedAt || nowIso()
        })) : [],
        // 旧フィールド名の読み替えだけをここで行い、既定値は createTransaction に任せる。
        // entryType は読み込みのたびに落ちると、メール取込の明細が請求総額に化けて相殺が壊れる。
        transactions: raw.transactions.map(transaction => createTransaction({
          ...transaction,
          kind: transaction.kind || oldKind(transaction.type),
          dueDate: transaction.dueDate || transaction.date || '',
          status: transaction.status === 'completed' ? 'settled' : transaction.status,
          sourceAccountId: transaction.sourceAccountId || transaction.bankId || '',
          destinationAccountId: transaction.destinationAccountId || transaction.bankIdTo || '',
          transferType: transaction.transferType || (transaction.kind === 'transfer' && transaction.destinationAccountId ? 'internal' : 'external'),
          destinationName: transaction.destinationName || transaction.recipientName || '',
          memo: transaction.memo || transaction.name || '',
          affectsForecast: transaction.affectsForecast !== false && !transaction.excludeFromCalc
        })),
        recurringPlans: Array.isArray(raw.recurringPlans) ? raw.recurringPlans : []
      };
    }

    // 旧アプリのJSONエクスポートを読み込めるようにする。
    if (Array.isArray(raw.banks) || Array.isArray(raw.presets)) {
      const migrated = emptyState();
      migrated.meta.onboarded = true;
      migrated.settings = { ...migrated.settings, ...(raw.settings || {}) };
      migrated.accounts = (raw.banks || []).map((bank, index) => ({
        id: bank.id || uid('account'),
        name: bank.name || `口座${index + 1}`,
        role: index === 0 ? 'primary' : inferOldRole(bank.name),
        currentBalance: Number(bank.currentBalance || 0),
        includeInSpendable: !['savings', 'investment'].includes(inferOldRole(bank.name)),
        reserveAmount: 0,
        isPrimary: index === 0
      }));
      migrated.transactions = (raw.transactions || []).map(transaction => createTransaction({
        id: transaction.id,
        kind: oldKind(transaction.type),
        amount: transaction.amount,
        dueDate: transaction.date || '',
        status: transaction.status === 'completed' ? 'settled' : 'planned',
        sourceAccountId: transaction.bankId || '',
        destinationAccountId: transaction.bankIdTo || '',
        transferType: transaction.transferType || (transaction.type === 'transfer' && transaction.bankIdTo ? 'internal' : 'external'),
        destinationName: transaction.destinationName || transaction.recipientName || '',
        category: transaction.category,
        memo: transaction.memo,
        lendingAmount: transaction.lendingAmount,
        affectsForecast: !transaction.excludeFromCalc,
        settledAt: transaction.status === 'completed' ? transaction.date || today() : '',
        createdAt: transaction.createdAt,
        updatedAt: nowIso()
      }));
      migrated.recurringPlans = (raw.presets || []).map(preset => ({
        id: preset.id || uid('plan'),
        kind: oldKind(preset.type),
        name: preset.name || '固定費',
        amount: Number(preset.amount || 0),
        dayOfMonth: 1,
        sourceAccountId: preset.bankId || '',
        destinationAccountId: '',
        isActive: true
      }));
      return migrated;
    }
    return emptyState();
  }

  function oldKind(type) {
    if (type === 'income') return 'income';
    if (type === 'savings') return 'saving';
    if (type === 'transfer') return 'transfer';
    if (type === 'reimbursement') return 'reimbursement';
    return 'payment';
  }

  function inferOldRole(name = '') {
    if (/貯金|預金|savings/i.test(name)) return 'savings';
    if (/証券|nisa|投資|investment/i.test(name)) return 'investment';
    if (/娯楽|遊び|entertainment/i.test(name)) return 'spending';
    return 'other';
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return emptyState();
      const raw = JSON.parse(saved);
      snapshotBeforeMigration(raw);
      const migrated = normalizeState(raw);
      verifyMigration(raw, migrated);
      if (Number(raw.schemaVersion || 0) < 6) absorbLegacyStatementDetails(migrated);
      return migrated;
    } catch (error) {
      console.warn('保存データを読み込めませんでした', error);
      return emptyState();
    }
  }

  function persist() {
    state.meta.updatedAt = nowIso();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (cloud) cloud.queueSave(state);
  }

  /** 空状態の共通マークアップ。title / body は既にエスケープ済みの文字列を渡すこと。 */
  function emptyBlock(title, body = '') {
    return `<div class="empty"><div><strong>${title}</strong>${body}</div></div>`;
  }

  /** 内訳リストの1行。title / sub は既にエスケープ済みの文字列を渡すこと。 */
  function miniRow({ title, sub = '', amount = 0, direction = 'out' }) {
    return `<div class="mini-row"><span>${title}<small>${sub}</small></span><strong class="${direction === 'in' ? 'value-positive' : 'value-negative'}">${formatFlowAmount(amount, direction)}</strong></div>`;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  /* ----------------------------------------------------------
   * 金額表示。「¥」と桁区切りを知っているのは formatAbsoluteYen だけで、
   * 残りの3つは「どんな符号を前に付けるか」だけが違う。
   * -------------------------------------------------------- */

  /** 符号なしの金額。例: ¥1,200 */
  function formatAbsoluteYen(value) {
    return `¥${Math.abs(Math.round(Number(value || 0))).toLocaleString('ja-JP')}`;
  }

  const withSign = (prefix, value) => `${prefix}${formatAbsoluteYen(value)}`;

  /** 値そのものの符号で出す。マイナスだけ「−」を付ける。例: −¥100 / ¥100 */
  function formatDisplayedAmount(value) {
    return withSign(Math.round(Number(value || 0)) < 0 ? '−' : '', value);
  }

  /** 増減として出す。プラスにも「＋」を付ける。例: −¥100 / ＋¥100 / ¥0 */
  function formatSigned(value) {
    const amount = Math.round(Number(value || 0));
    return withSign(amount < 0 ? '−' : amount > 0 ? '＋' : '', amount);
  }

  /** お金の向き(in/out)で符号を決める。金額自体の符号は見ない。例: −¥100 / ＋¥100 */
  function formatFlowAmount(value, direction = 'neutral') {
    return withSign(direction === 'out' ? '−' : direction === 'in' ? '＋' : '', value);
  }

  function dateAdd(dateString, days) {
    return finance.toDateString(finance.addDays(finance.parseLocalDate(dateString), days));
  }

  function formatDate(dateString, long = false) {
    if (!dateString) return '日付未設定';
    const date = new Date(`${dateString}T12:00:00`);
    return long ? date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }) : `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function formatToday() {
    const date = new Date();
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  }

  const daysBetween = (from, to) => finance.daysBetween(from, to);

  /**
   * 「今使える金額」の判定期限。毎月14日締め。
   * settings.deadlineMode は現状この関数から読んでいない（選択肢が 'legacy14' の1つだけのため）。
   */
  function getNextDeadline(baseDate = today()) {
    const date = new Date(`${baseDate}T12:00:00`);
    const year = date.getFullYear();
    const month = date.getMonth();
    if (date.getDate() < 15) return `${year}-${String(month + 1).padStart(2, '0')}-14`;
    const next = new Date(year, month + 1, 14, 12);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-14`;
  }

  function account(id) { return state.accounts.find(item => item.id === id) || null; }
  function primaryAccount() { return state.accounts.find(item => item.isPrimary) || state.accounts.find(item => item.role === 'primary') || state.accounts[0] || null; }
  function accountName(id) { return account(id)?.name || '口座未設定'; }
  function creditCard(id) { return state.cards.find(item => item.id === id) || null; }
  function cardName(id) { return creditCard(id)?.name || 'カード未設定'; }
  function roleLabel(role) { return ROLE_LABELS[role] || ROLE_LABELS.other; }
  function formatHours(value) { return `${Number(Number(value || 0).toFixed(2)).toLocaleString('ja-JP')}時間`; }
  function kindMeta(kind) { return KIND_META[kind] || KIND_META.payment; }
  const isExternalTransfer = transaction => finance.isExternalTransfer(transaction);
  function transferLabel(transaction) { return transaction.transferType === 'external' ? '他人口座へ' : '自分の口座へ'; }
  function transactionLabel(transaction) { return transaction.kind === 'transfer' ? transferLabel(transaction) : kindMeta(transaction.kind).label; }
  function transactionDirection(transaction) {
    if (['income', 'reimbursement'].includes(transaction.kind)) return 'in';
    if (transaction.kind === 'transfer' && !isExternalTransfer(transaction)) return 'neutral';
    return 'out';
  }
  function formatTransactionAmount(transaction) { return formatFlowAmount(transaction.amount, transactionDirection(transaction)); }

  /** 期限までに基準口座から出ていく予定額。renderAccounts の「予定」表示に使う。 */
  function pendingExp(accountId) {
    const deadline = getNextDeadline();
    return state.transactions
      .filter(transaction => transaction.status === 'planned'
        && transaction.sourceAccountId === accountId
        && transaction.dueDate >= today()
        && transaction.dueDate <= deadline
        && transaction.kind !== 'income'
        && transaction.kind !== 'saving'
        && transaction.kind !== 'nisa'
        && (transaction.kind !== 'transfer' || isExternalTransfer(transaction))
        && transaction.affectsForecast !== false)
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  }

  function statusFor(value) {
    if (value < 0) return { label: '不足の見込み', className: 'bad', detail: '最低限残す金額を下回る見込みです。' };
    if (value < 30000) return { label: '残り少なめ', className: 'warn', detail: '追加の支出は内訳を確認してください。' };
    return { label: '余裕あり', className: 'good', detail: '必要なお金は確保できています。' };
  }

  function sortedTransactions(list = state.transactions) {
    return [...list].sort((a, b) => `${a.dueDate}_${a.createdAt}`.localeCompare(`${b.dueDate}_${b.createdAt}`));
  }

  function seedDemoState() {
    const base = emptyState();
    const primary = { id: uid('account'), name: '生活費口座', role: 'primary', currentBalance: 300000, includeInSpendable: true, reserveAmount: 0, isPrimary: true };
    const spending = { id: uid('account'), name: '自由費口座', role: 'spending', currentBalance: 10000, includeInSpendable: true, reserveAmount: 0, isPrimary: false };
    const savings = { id: uid('account'), name: '貯金口座', role: 'savings', currentBalance: 500000, includeInSpendable: false, reserveAmount: 0, isPrimary: false };
    const investment = { id: uid('account'), name: 'NISA口座', role: 'investment', currentBalance: 800000, includeInSpendable: false, reserveAmount: 0, isPrimary: false };
    const mainCard = { id: uid('card'), name: 'メインカード', accountId: primary.id, closingDay: 15, paymentDay: 10, createdAt: nowIso(), updatedAt: nowIso() };
    const subCard = { id: uid('card'), name: 'サブカード', accountId: spending.id, closingDay: 0, paymentDay: 27, createdAt: nowIso(), updatedAt: nowIso() };
    base.accounts = [primary, spending, savings, investment];
    base.cards = [mainCard, subCard];
    base.settings.wage = { hourlyRate: 1250, closingDay: 0, paymentDay: 10, paymentMonthOffset: 1, includeForecastInSpendable: true };
    base.workEntries = [
      { id: uid('work'), date: dateAdd(today(), -5), hours: 5.5, status: 'worked', hourlyRateOverride: 0, memo: '勤務済み', createdAt: nowIso(), updatedAt: nowIso() },
      { id: uid('work'), date: dateAdd(today(), -2), hours: 6, status: 'worked', hourlyRateOverride: 0, memo: '勤務済み', createdAt: nowIso(), updatedAt: nowIso() },
      { id: uid('work'), date: dateAdd(today(), 2), hours: 5, status: 'planned', hourlyRateOverride: 0, memo: '勤務予定', createdAt: nowIso(), updatedAt: nowIso() },
      { id: uid('work'), date: dateAdd(today(), 5), hours: 6, status: 'planned', hourlyRateOverride: 0, memo: '勤務予定', createdAt: nowIso(), updatedAt: nowIso() }
    ];
    base.meta.onboarded = true;
    base.meta.demo = true;
    base.transactions = [
      { kind: 'payment', amount: 60000, dueDate: dateAdd(today(), 4), sourceAccountId: primary.id, cardId: mainCard.id, category: '固定費', memo: 'カード支払い' },
      { kind: 'income', amount: 50000, dueDate: dateAdd(today(), 8), sourceAccountId: primary.id, category: '収入', memo: '次回収入' },
      { kind: 'saving', amount: 20000, dueDate: dateAdd(today(), 10), sourceAccountId: primary.id, destinationAccountId: savings.id, category: '貯金', memo: '今月の貯金' },
      { kind: 'nisa', amount: 30000, dueDate: dateAdd(today(), 12), sourceAccountId: primary.id, destinationAccountId: investment.id, category: 'NISA', memo: '今月のNISA' },
      { kind: 'transfer', amount: 12000, dueDate: dateAdd(today(), 6), sourceAccountId: primary.id, transferType: 'external', destinationName: '家族口座', category: '振込', memo: '生活費の振込' },
      { kind: 'payment', amount: 3200, dueDate: dateAdd(today(), -2), status: 'settled', sourceAccountId: primary.id, category: '食費', memo: 'スーパー', settledAt: dateAdd(today(), -2) }
    ].map(createTransaction);
    return base;
  }

  function authErrorMessage(error) {
    const code = error?.code || '';
    if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Googleログインを中止しました。';
    if (code.includes('popup-blocked')) return 'Googleログインのポップアップを許可してください。';
    if (code.includes('unauthorized-domain')) return 'このURLはFirebase Authenticationで許可されていません。';
    if (code.includes('operation-not-allowed')) return 'FirebaseでGoogleログインを有効にしてください。';
    if (code.includes('account-exists-with-different-credential')) return '同じメールアドレスの旧ログインがあります。管理者へ移行を依頼してください。';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'メールアドレスまたはパスワードを確認してください。';
    if (code.includes('email-already-in-use')) return 'このメールアドレスは登録済みです。';
    if (code.includes('weak-password')) return 'パスワードは6文字以上にしてください。';
    if (code.includes('invalid-email')) return 'メールアドレスの形式を確認してください。';
    if (code.includes('too-many-requests')) return 'しばらく待ってから、もう一度お試しください。';
    if (code.includes('network-request-failed')) return '通信できません。接続を確認してください。';
    return error?.message || '処理に失敗しました。';
  }

  function showAuth(message = '') {
    $('#app-shell').hidden = true;
    $('#onboarding').hidden = true;
    $('#floating-add').hidden = true;
    closeAddMenu();
    $('#auth-screen').hidden = false;
    const error = $('#auth-error');
    error.textContent = message;
    error.hidden = !message;
  }

  function setAuthBusy(busy) {
    const button = $('#auth-login-button');
    button.disabled = busy;
    const label = $('span:last-child', button);
    if (label) label.textContent = busy ? '接続中…' : 'Googleでログイン';
  }

  function applyRemoteState(remoteState, meta = {}) {
    if (!remoteState || typeof remoteState !== 'object') return;
    const normalized = normalizeState(remoteState);
    normalized.mode = 'cloud';
    if (!meta.initial && normalized.meta.updatedAt === state?.meta?.updatedAt) return;
    state = normalized;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('#auth-screen').hidden = true;
    if (state.meta.onboarded) showApp(); else renderOnboarding();
    const session = cloud?.getSession();
    if (!meta.initial && meta.updatedBy && meta.updatedBy !== session?.user?.uid) showToast('共有データを更新しました');
  }

  function handleCloudStatus(status, error) {
    syncStatus = status;
    if (status === 'error') showToast(`同期できません: ${authErrorMessage(error)}`);
  }

  async function startCloudSession() {
    const user = await cloud.waitForAuth();
    if (!user) { showAuth(); return; }
    const cachedUser = localStorage.getItem(CLOUD_USER_KEY);
    if (cachedUser && cachedUser !== user.uid) state = emptyState();
    localStorage.setItem(CLOUD_USER_KEY, user.uid);
    await cloud.connect(state, applyRemoteState, handleCloudStatus, handleImportCandidates, handleReceipts, handleReceiptItems, handleItemAliases);
    state.mode = 'cloud';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('#auth-screen').hidden = true;
    if (state.meta.onboarded) showApp(); else renderOnboarding();
  }

  async function submitAuth() {
    if (!cloud) { showAuth('Firebaseに接続できません。'); return; }
    setAuthBusy(true);
    try {
      await cloud.signIn();
      await startCloudSession();
      showToast('Googleでログインしました');
    } catch (error) {
      showAuth(authErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function renderOnboarding() {
    const onboarding = $('#onboarding');
    $('#auth-screen').hidden = true;
    $('#app-shell').hidden = true;
    closeAddMenu();
    $('#floating-add').hidden = true;
    onboarding.hidden = false;
    onboarding.innerHTML = `
      <div class="onboarding-inner">
        <div class="onboarding-brand"><span class="auth-icon"><img src="icons/app-icon.svg?v=22" alt=""></span><strong>お金管理</strong></div>
        <section class="onboarding-form">
          <span class="eyebrow">初期設定</span>
          <div class="onboarding-security"><span class="security-mark">${icon('safe')}</span><span>この端末に保存して使います</span></div>
          <h1>最初の口座を登録</h1>
          <p>現在の残高と、残しておく金額を入力してください。</p>
          <form id="onboarding-form" class="form-stack">
            <label><span>基準口座の名前</span><input id="setup-account-name" value="生活費口座" required></label>
            <label><span>現在の残高</span><div class="amount-input"><span>¥</span><input id="setup-balance" type="number" value="0" min="0" step="1" inputmode="numeric" required></div></label>
            <label><span>最低限残す金額</span><div class="amount-input"><span>¥</span><input id="setup-defense" type="number" value="150000" min="0" step="1" inputmode="numeric" required></div></label>
            <div class="onboarding-buttons"><button type="button" class="button button-quiet" id="demo-start">サンプルを見る</button><button class="button button-primary" type="submit">この端末で始める</button></div>
          </form>
        </section>
      </div>`;
    $('#onboarding-form').addEventListener('submit', startFromSetup);
    $('#demo-start').addEventListener('click', () => { state = seedDemoState(); persist(); showApp(); showToast('サンプルデータで開始しました'); });
  }

  function startFromSetup(event) {
    event.preventDefault();
    state = emptyState();
    state.meta.onboarded = true;
    state.accounts = [{ id: uid('account'), name: $('#setup-account-name').value.trim() || '生活費口座', role: 'primary', currentBalance: Number($('#setup-balance').value || 0), includeInSpendable: true, reserveAmount: 0, isPrimary: true }];
    state.settings.defenseLine = Number($('#setup-defense').value || 0);
    persist();
    showApp();
    showToast('登録しました');
  }

  function showApp() {
    $('#auth-screen').hidden = true;
    $('#onboarding').hidden = true;
    $('#app-shell').hidden = false;
    $('#floating-add').hidden = false;
    $('#storage-badge').textContent = state.meta.demo ? 'サンプルデータ' : 'この端末に保存';
    $('#today-label').textContent = formatToday();
    renderPage();
  }

  function renderPage() {
    detailCache = new Map();
    const titles = { home: 'ホーム', plans: '予定', records: '記録', accounts: '口座', shift: 'シフト', settings: '設定', spendable: '今使える金額', cashflow: '支払い能力チェック', imports: '取込候補' };
    $('#page-title').textContent = titles[currentPage] || titles.home;
    $$('.nav-link[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === currentPage));
    const renderers = { home: renderHome, plans: renderPlans, records: renderRecords, accounts: renderAccounts, shift: renderShift, settings: renderSettings, spendable: renderSpendable, cashflow: renderCashflow, imports: renderImports };
    $('#page-container').innerHTML = renderers[currentPage]();
    if (currentPage === 'home') requestAnimationFrame(animateHeroAmount);
    if (currentPage === 'spendable') requestAnimationFrame(() => {
      animateHeroAmount();
      updateWhatIf(whatIfAmount);
    });
  }

  function animateHeroAmount() {
    const targetNode = $('[data-count-amount]');
    if (!targetNode) return;
    const target = Number(targetNode.dataset.countAmount || 0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { targetNode.textContent = formatDisplayedAmount(target); return; }
    const startedAt = performance.now();
    const duration = 420;
    const step = now => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      targetNode.textContent = formatDisplayedAmount(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function updateWhatIf(value) {
    const calc = spendableAmount();
    const amountInput = $('#what-if-amount');
    const slider = $('#what-if-slider');
    if (!calc || !amountInput || !slider) return;
    whatIfAmount = Math.max(Math.round(Number(value) || 0), 0);
    const result = finance.simulateSpending(calc.total, whatIfAmount, calc.dailyDays);
    amountInput.value = String(whatIfAmount || '');
    slider.value = String(Math.min(whatIfAmount, Number(slider.max)));
    const totalNode = $('#what-if-total');
    const dailyNode = $('#what-if-daily');
    totalNode.textContent = formatDisplayedAmount(result.remaining);
    dailyNode.textContent = formatDisplayedAmount(result.daily);
    totalNode.classList.toggle('value-negative', result.remaining < 0);
    dailyNode.classList.toggle('value-negative', result.daily < 0);
    $('#what-if-note').textContent = result.remaining < 0
      ? `今使える金額を${formatAbsoluteYen(Math.abs(result.remaining))}超えます。`
      : '試算だけなので、予定や残高には保存されません。';

    // 支払い能力チェックへの影響もあわせて示す
    const checkNote = $('#what-if-check-note');
    if (checkNote) {
      if (!whatIfAmount) {
        checkNote.textContent = '';
      } else {
        const impact = finance.simulateWhatIf({ ...buildEngineInput(), includeSalary: true }, { amount: whatIfAmount, date: today() });
        const after = CHECK_STATUS[impact.cashflow.afterVerdict] || CHECK_STATUS.ok;
        checkNote.textContent = impact.cashflow.becomesRisky
          ? `支払い能力チェックが「${after.label}」に変わります。最低予測残高は${formatDisplayedAmount(impact.cashflow.afterMinBalance)}（${formatDate(impact.cashflow.afterMinBalanceDate, true)}）。`
          : `支払い能力チェックは「${after.label}」のままです。最低予測残高は${formatDisplayedAmount(impact.cashflow.afterMinBalance)}（${formatDate(impact.cashflow.afterMinBalanceDate, true)}）。`;
        checkNote.classList.toggle('value-negative', impact.cashflow.becomesRisky);
      }
    }
    const resultPanel = $('.what-if-results');
    resultPanel?.classList.remove('is-updating');
    requestAnimationFrame(() => resultPanel?.classList.add('is-updating'));
  }

  /* ================= 計算エンジンへの入力 ================= */

  /** 2つの主計算で共通に使う入力を組み立てる。計算そのものは finance-engine.js に置く。 */
  function buildEngineInput() {
    const primary = primaryAccount();
    return {
      today: today(),
      deadline: getNextDeadline(),
      horizonDays: Number(state.settings.cashflowHorizonDays || 90),
      accounts: state.accounts,
      cards: state.cards,
      transactions: state.transactions,
      recurringPlans: state.recurringPlans,
      workEntries: state.workEntries,
      wage: state.settings.wage,
      defenseLine: Number(state.settings.defenseLine || 0),
      primaryAccountId: primary?.id || '',
      holidayOptions: holidayOptions()
    };
  }

  /** 機能B｜今使える金額 */
  /* アプリ切り替えシートに出す「今の状態」を1行で書き残す。
     window.__appStatus は共有の切り替えバー（../shared/app-switcher.js）が用意する。
     単独で動かすときは何も起きない。ホームの描画で既に計算済みの値を渡すので、追加の計算はしない。 */
  function publishSwitcherStatus(spendable) {
    if (typeof window.__appStatus !== 'function') return;
    try {
      // ふりかえりが残っているときは、そちらを先に知らせる
      const due = dueReviewItems().length;
      window.__appStatus(due
        ? `ふりかえり ${due}件`
        : (spendable ? '今使える ' + formatAbsoluteYen(spendable.total) : '口座が未登録'));
    } catch (error) {
      /* 状態表示は無くても困らない */
    }
  }

  function spendableAmount() {
    if (!state.accounts.length) return null;
    return finance.calculateSpendableAmount({
      ...buildEngineInput(),
      includeSalary: state.settings.wage.includeForecastInSpendable !== false
    });
  }

  /** 機能A｜支払い能力チェック（今使える金額とは別の計算・別の結果） */
  function cashflowCheck() {
    if (!state.accounts.length) return null;
    return finance.calculateCashflowCheck({ ...buildEngineInput(), includeSalary: true });
  }

  const CHECK_STATUS = {
    ok: { label: '支払い可能', className: 'good', detail: '期間内に残高が足りなくなる日はありません。' },
    belowDefense: { label: '最低残高を下回る', className: 'warn', detail: '最低限残す金額を下回る日があります。' },
    shortfall: { label: '不足の可能性', className: 'bad', detail: '残高が足りなくなる日があります。' }
  };

  function checkStatusOf(check) {
    return CHECK_STATUS[check?.verdict] || CHECK_STATUS.ok;
  }

  /** 支給月別の給与見込み（ホーム・シフトで共通に使う） */
  function nextSalary(baseDate = today()) {
    const wage = state.settings.wage;
    let month = finance.monthKeyOf(baseDate);
    let salary = finance.calculateSalaryByPaymentMonth(state.workEntries, month, wage, holidayOptions());
    if (salary.paymentDate < baseDate) {
      month = finance.shiftMonthKey(month, 1);
      salary = finance.calculateSalaryByPaymentMonth(state.workEntries, month, wage, holidayOptions());
    }
    return salary;
  }

  /* ================= ホーム ================= */

  function renderHome() {
    const spendable = spendableAmount();
    publishSwitcherStatus(spendable);
    const check = cashflowCheck();
    const status = statusFor(spendable?.total ?? 0);
    const checkStatus = checkStatusOf(check);
    const salary = nextSalary();
    const wageConfigured = Number(state.settings.wage.hourlyRate || 0) > 0;

    const upcoming = sortedTransactions(state.transactions.filter(item => item.status === 'planned' && item.dueDate >= today())).slice(0, 4);
    const cardBillGroups = finance.aggregateCardBills(state.transactions, state.cards, today());
    const nextBill = cardBillGroups[0] || null;

    if (!spendable || !check) {
      return `
        <div class="page-heading"><div><span class="eyebrow">ホーム</span><h1>ホーム</h1></div></div>
        ${renderReviewPrompt()}
        <section class="card empty"><div><strong>口座を追加してください</strong>口座を登録すると、今使える金額と支払い能力チェックを計算できます。</div></section>`;
    }

    return `
      <div class="page-heading"><div><span class="eyebrow">ホーム</span><h1>ホーム</h1></div></div>
      ${renderReviewPrompt()}

      <section class="card hero-card">
        <span class="eyebrow">今使える金額・${formatDate(spendable.deadline, true)}まで／あと${spendable.days}日</span>
        <h1 data-count-amount="${spendable.total}">${formatDisplayedAmount(spendable.total)}</h1>
        <div class="hero-daily"><span>1日あたりの目安</span><strong>${formatDisplayedAmount(spendable.daily)}</strong><small>残り${spendable.dailyDays}日で均等に使う場合</small></div>
        <p class="hero-subtitle">利用済みで未払いのカード額を差し引いた、自由に使える金額です。</p>
        <div class="hero-meta"><span class="status-pill ${status.className}"><span class="status-dot" aria-hidden="true"></span>${status.label}</span>${spendable.unpaidCardTotal ? `<span class="status-pill">未払いカード ${formatAbsoluteYen(spendable.unpaidCardTotal)}</span>` : ''}</div>
        <div class="hero-actions"><button class="button button-primary button-small" data-page="spendable">内訳と試算を見る</button><button class="button button-quiet button-small" data-action="open-future">将来の期間で試算</button></div>
      </section>

      ${pendingCandidates().length ? `<section class="card notice-card"><strong>取込候補が${pendingCandidates().length}件あります</strong><p>カード利用のお知らせメールから作られた候補です。取り込むまで金額には反映されません。</p><button class="button button-quiet button-small" data-page="imports">確認する</button></section>` : ''}

      <section class="card check-summary-card">
        <div class="list-card-header"><div><span class="eyebrow">支払い能力チェック</span><h2>${formatDate(check.endDate)}までの見通し</h2></div><span class="status-pill ${checkStatus.className}"><span class="status-dot" aria-hidden="true"></span>${checkStatus.label}</span></div>
        <p class="check-detail">${checkStatus.detail}</p>
        <div class="summary-strip">
          <div class="stat-card"><span>期間内の最低予測残高</span><strong class="${check.minBalance < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(check.minBalance)}</strong></div>
          <div class="stat-card"><span>最も危険な日</span><strong>${formatDate(check.minBalanceDate, true)}</strong></div>
          <div class="stat-card"><span>${check.shortfallDate ? '不足が発生する日' : '最低残高を下回る日'}</span><strong>${check.shortfallDate ? formatDate(check.shortfallDate, true) : (check.belowDefenseDate ? formatDate(check.belowDefenseDate, true) : 'なし')}</strong></div>
        </div>
        <div class="hero-actions"><button class="button button-quiet button-small" data-page="cashflow">日付ごとの推移を見る</button></div>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">次の重要な支払い</span><h2>これからの予定</h2></div><button class="button button-quiet button-small" data-page="plans">すべて見る</button></div>
        ${nextBill ? `<div class="next-bill"><span class="billing-icon">${icon('card')}</span><span class="billing-main"><strong>${esc(nextBill.cardName)}の引落し</strong><small>${formatDate(nextBill.dueDate, true)}・${nextBill.count}件・${esc(accountName(nextBill.accountId))}</small></span><strong class="value-negative">${formatFlowAmount(nextBill.total, 'out')}</strong></div>` : ''}
        <div class="list">${renderTransactionRows(upcoming, true) || emptyBlock('予定がまだありません', '「予定を追加」から登録してください。')}</div>
      </section>

      <section class="card wage-card">
        <div class="wage-header">
          <div class="wage-title"><span class="wage-icon">${icon('shift')}</span><div><span class="eyebrow">${formatMonthLabel(salary.workMonth)}分・${formatDate(salary.paymentDate, true)}支給</span><h2>給料支給予定</h2></div></div>
          <button class="button button-quiet button-small" data-page="shift">シフトを見る</button>
        </div>
        ${wageConfigured ? `<div class="wage-grid">
          <div class="wage-main"><span>予定を含む見込み</span><strong>${formatFlowAmount(salary.totalAmount, 'in')}</strong><small>${formatDate(salary.workStartDate)}〜${formatDate(salary.workEndDate)}・${formatHours(salary.totalHours)}</small></div>
          <div class="wage-stat"><span>勤務済み</span><strong>${formatFlowAmount(salary.confirmedAmount, 'in')}</strong><small>${formatHours(salary.workedHours)}</small></div>
          <div class="wage-stat"><span>勤務予定</span><strong>${formatFlowAmount(salary.plannedAmount, 'in')}</strong><small>${formatHours(salary.plannedHours)}</small></div>
        </div>` : `<div class="wage-setup"><div><strong>時給を設定してください</strong><p>時給を設定すると、シフトから見込み額を計算します。</p></div><button class="button button-primary button-small" data-page="settings">給与設定へ</button></div>`}
      </section>`;
  }

  /* ================= 機能B｜今使える金額（詳細） ================= */

  function renderSpendable() {
    const result = spendableAmount();
    if (!result) return '<div class="page-heading"><div><span class="eyebrow">今使える金額</span><h1>今使える金額</h1></div></div><section class="card empty"><div><strong>口座がありません</strong>口座を追加すると計算できます。</div></section>';

    const status = statusFor(result.total);
    const whatIfMax = Math.max(100000, Math.ceil(Math.max(result.total, whatIfAmount) / 10000) * 10000);
    const whatIfResult = finance.simulateSpending(result.total, whatIfAmount, result.dailyDays);

    const breakdownRows = result.breakdown.map(row => `<div class="breakdown-row"><div class="breakdown-label"><i class="breakdown-dot ${row.direction === 'in' ? 'income' : 'payment'}"></i>${row.label}</div><strong class="breakdown-value ${row.amount < 0 ? 'value-negative' : 'value-positive'}">${formatSigned(row.amount)}</strong></div>`).join('');

    const cardRows = result.unpaidCardByCard.map(group => miniRow({ title: esc(cardName(group.cardId)), sub: `${group.count}件`, amount: group.total, direction: 'out' })).join('');
    const listOf = (items, direction) => items.map(item => miniRow({ title: esc(item.memo || item.category || transactionLabel(item)), sub: formatDate(item.dueDate, true), amount: item.amount, direction })).join('');

    return `
      <div class="page-heading"><div><span class="eyebrow">今使える金額</span><h1>今使える金額</h1></div><button class="button button-quiet button-small" data-page="home">ホームへ戻る</button></div>

      <section class="card hero-card">
        <span class="eyebrow">${formatDate(result.deadline, true)}まで・あと${result.days}日</span>
        <h1 data-count-amount="${result.total}">${formatDisplayedAmount(result.total)}</h1>
        <div class="hero-daily"><span>1日あたりの目安</span><strong>${formatDisplayedAmount(result.daily)}</strong><small>残り${result.dailyDays}日で均等に使う場合</small></div>
        <div class="hero-meta"><span class="status-pill ${status.className}"><span class="status-dot" aria-hidden="true"></span>${status.label}</span></div>
        <div class="hero-actions"><button class="button button-quiet button-small" data-action="open-future">将来の期間で試算</button></div>
      </section>

      <section class="card breakdown-card">
        <div class="section-title"><h2>計算内訳</h2><small>${formatDate(result.deadline)}まで</small></div>
        <div class="breakdown-list">${breakdownRows}</div>
        <div class="formula-total"><span>今使える金額</span><strong class="${result.total < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(result.total)}</strong></div>
        ${result.unpaidCardBeyondDeadline ? `<p class="form-note">未払いカードのうち${formatAbsoluteYen(result.unpaidCardBeyondDeadline)}は、引落しが${formatDate(result.deadline)}より後です。使った時点で確定した支出のため、いま差し引いています。</p>` : ''}
        ${result.excludedCardDueTotal ? `<p class="form-note">期限内のカード引落し${formatAbsoluteYen(result.excludedCardDueTotal)}は、未払いカード利用として既に差し引いているため、現金支出には二重計上していません。</p>` : ''}
        ${result.unpaidCardEstimated ? `<p class="form-note">${formatAbsoluteYen(result.unpaidCardEstimated)}は、利用日が記録されていない以前のカード利用です。安全側として差し引いています。予定を編集して利用日を入れると正確になります。</p>` : ''}
      </section>

      <section class="card what-if-card">
        <div class="what-if-header">
          <div class="what-if-title"><span class="what-if-icon">${icon('safe')}</span><div><span class="eyebrow">試算</span><h2>使ったらどうなる？</h2></div></div>
          <button class="button button-quiet button-small" data-action="reset-what-if">リセット</button>
        </div>
        <div class="what-if-body">
          <div class="what-if-control">
            <label for="what-if-amount">使う金額</label>
            <div class="amount-input what-if-amount"><span>¥</span><input id="what-if-amount" type="number" min="0" step="100" inputmode="numeric" value="${whatIfAmount || ''}" placeholder="0"></div>
            <input id="what-if-slider" class="what-if-slider" type="range" min="0" max="${whatIfMax}" step="1000" value="${Math.min(whatIfAmount, whatIfMax)}" aria-label="使う金額を調整">
          </div>
          <div class="what-if-results">
            <div><span>使ったあと</span><strong id="what-if-total" class="${whatIfResult.remaining < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(whatIfResult.remaining)}</strong></div>
            <div><span>1日あたり</span><strong id="what-if-daily" class="${whatIfResult.daily < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(whatIfResult.daily)}</strong></div>
          </div>
        </div>
        <p class="what-if-note" id="what-if-note">試算だけなので、予定や残高には保存されません。</p>
        <p class="what-if-note" id="what-if-check-note"></p>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">内訳</span><h2>未払いのカード利用</h2></div><strong class="value-negative">${formatFlowAmount(result.unpaidCardTotal, 'out')}</strong></div>
        <div class="mini-list">${cardRows || emptyBlock('未払いのカード利用はありません')}</div>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">期限内</span><h2>収入・給与</h2></div><strong class="value-positive">${formatFlowAmount(result.incomeTotal + result.salaryTotal, 'in')}</strong></div>
        <div class="mini-list">${listOf(result.incomeItems, 'in') + result.salaryEvents.map(item => miniRow({ title: `${formatMonthLabel(item.workMonth)}分の給与`, sub: formatDate(item.paymentDate, true), amount: item.totalAmount, direction: 'in' })).join('') || emptyBlock('期限内の入金予定はありません')}</div>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">期限内</span><h2>支払い・貯金・NISA</h2></div><strong class="value-negative">${formatFlowAmount(result.cashOutflow + result.savingTotal + result.nisaTotal, 'out')}</strong></div>
        <div class="mini-list">${listOf([...result.cashOutflowItems, ...result.savingItems, ...result.nisaItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), 'out') || emptyBlock('期限内の支出予定はありません')}</div>
      </section>`;
  }

  /* ================= 取込候補（メールからの取り込み） ================= */

  const CANDIDATE_STATUS = {
    pending: { label: '未確認', className: 'badge-planned' },
    needs_review: { label: '要確認', className: 'badge-warn' },
    accepted: { label: '取り込み済み', className: 'badge-settled' },
    ignored: { label: '無視', className: 'badge-muted' }
  };

  const CANDIDATE_TYPE = { purchase: '利用', refund: '返金', cancel: '取消', unknown: '不明' };

  function pendingCandidates() {
    return importCandidates.filter(item => ['pending', 'needs_review'].includes(item.status));
  }

  /**
   * 取込候補の利用日(日本時間)を求める。
   * detectedAt はメールを受信した瞬間のUTC文字列なので、
   * そのまま切り出すと日本時間の深夜0時〜朝9時のメールが前日になってしまう。必ずJSTへ直す。
   */
  function candidateDate(candidate) {
    return candidate.usedDate || finance.jstDateStringOf(candidate.detectedAt) || today();
  }

  /**
   * 取込候補の利用時刻(UTCのISO文字列)を求める。明細を新しい順に並べるために使う。
   * メール本文から読み取った利用日と受信日が一致するときだけ、受信時刻を利用時刻とみなす。
   * ずれている場合は時刻が不明なので空にして、日付だけで並べる。
   */
  function candidateInstant(candidate) {
    const detectedAt = candidate.detectedAt || '';
    if (!detectedAt) return '';
    const detectedDate = finance.jstDateStringOf(detectedAt);
    if (!detectedDate) return '';
    if (candidate.usedDate && candidate.usedDate !== detectedDate) return '';
    return new Date(detectedAt).toISOString();
  }

  /** カード名の候補から登録済みカードを推測する */
  function guessCardId(candidate) {
    const hint = String(candidate.cardHint || candidate.sourceLabel || '').trim();
    if (!hint) return state.cards[0]?.id || '';
    const matched = state.cards.find(card => hint.includes(card.name) || card.name.includes(hint));
    return matched?.id || state.cards[0]?.id || '';
  }

  function renderImports() {
    const rows = importCandidates
      .slice()
      .sort((a, b) => String(b.detectedAt || '').localeCompare(String(a.detectedAt || '')))
      .map(candidate => {
        const status = CANDIDATE_STATUS[candidate.status] || CANDIDATE_STATUS.pending;
        const actionable = ['pending', 'needs_review'].includes(candidate.status);
        const duplicate = importCandidates.some(other => other.id !== candidate.id && other.fingerprint && other.fingerprint === candidate.fingerprint);
        return `<div class="candidate-row">
          <div class="candidate-main">
            <div class="candidate-head"><strong>${candidate.amount ? formatAbsoluteYen(candidate.amount) : '金額を確認'}</strong><span class="badge ${status.className}">${status.label}</span><span class="badge badge-muted">${CANDIDATE_TYPE[candidate.type] || '不明'}</span>${duplicate ? '<span class="badge badge-warn">重複の可能性</span>' : ''}</div>
            <small>${formatDate(candidateDate(candidate), true)}${candidate.merchant ? `・${esc(candidate.merchant)}` : ''}・${esc(candidate.cardHint || 'カード不明')}・${esc(candidate.sourceLabel || candidate.sourcePackage || '取込元不明')}</small>
            ${candidate.note ? `<small>${esc(candidate.note)}</small>` : ''}
          </div>
          ${actionable ? `<div class="list-actions">
            <button class="mini-button primary" data-action="accept-candidate" data-id="${candidate.id}">取り込む</button>
            <button class="mini-button" data-action="ignore-candidate" data-id="${candidate.id}">無視</button>
            <button class="mini-button danger" data-action="delete-candidate" data-id="${candidate.id}">削除</button>
          </div>` : `<div class="list-actions"><button class="mini-button danger" data-action="delete-candidate" data-id="${candidate.id}">削除</button></div>`}
        </div>`;
      }).join('');

    return `
      <div class="page-heading"><div><span class="eyebrow">取込候補</span><h1>通知・メールからの取込候補</h1></div><button class="button button-quiet button-small" data-page="settings">設定へ戻る</button></div>
      <section class="card info-card">
        <p class="check-detail">カード利用のお知らせメールから作られた候補です。<strong>取り込むまでは、今使える金額にも支払い能力チェックにも反映されません。</strong>内容を確認して取り込むと、正式なカード取引になります。</p>
      </section>
      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">${pendingCandidates().length}件が未確認</span><h2>候補一覧</h2></div></div>
        <div class="candidate-list">${rows || emptyBlock('取込候補はありません', 'カード利用のお知らせメールが取り込まれると、ここに表示されます。')}</div>
      </section>`;
  }

  /** 候補を正式なカード取引へ変換する。承認するまで計算には含めない。 */
  async function acceptCandidate(id) {
    const candidate = importCandidates.find(item => item.id === id);
    if (!candidate) return;
    if (!state.cards.length) { showToast('先にクレジットカードを登録してください'); return; }
    if (!Number(candidate.amount)) { showToast('金額が読み取れていません。予定を手入力してください'); return; }

    const cardId = guessCardId(candidate);
    const card = creditCard(cardId);
    const transactionDate = candidateDate(candidate);
    const dueDate = card
      ? finance.calculateCardPaymentDate(transactionDate, card.closingDay, card.paymentDay, card.paymentMonthOffset ?? 1, holidayOptions())
      : transactionDate;
    const isNegative = ['refund', 'cancel'].includes(candidate.type);

    const transaction = createTransaction({
      kind: 'payment',
      amount: Math.abs(Number(candidate.amount || 0)) * (isNegative ? -1 : 1),
      transactionDate,
      transactionAt: candidateInstant(candidate),
      dateEstimated: !candidate.usedDate,
      dueDate,
      sourceAccountId: card?.accountId || primaryAccount()?.id || '',
      cardId,
      entryType: 'itemized',
      origin: 'mail-import',
      category: 'カード利用',
      memo: candidate.merchant || candidate.cardHint || 'メール取込'
    });

    state.transactions.push(transaction);
    persist();
    try { await cloud?.updateImportCandidate(id, { ...stripCandidate(candidate), status: 'accepted' }); }
    catch (error) { console.warn('取込候補の更新に失敗しました', error); }
    renderPage();
    showToast('取り込みました。内容は予定から編集できます');
    openEventModal(transaction.id);
  }

  async function ignoreCandidate(id) {
    const candidate = importCandidates.find(item => item.id === id);
    if (!candidate) return;
    try { await cloud?.updateImportCandidate(id, { ...stripCandidate(candidate), status: 'ignored' }); showToast('無視しました'); }
    catch (error) { showToast('取込候補を更新できませんでした'); }
  }

  async function deleteCandidate(id) {
    if (!window.confirm('この取込候補を削除しますか？')) return;
    try { await cloud?.deleteImportCandidate(id); showToast('取込候補を削除しました'); }
    catch (error) { showToast('取込候補を削除できませんでした'); }
  }

  /** Rulesが許可するフィールドだけに絞る */
  function stripCandidate(candidate) {
    const allowed = ['sourcePackage', 'sourceLabel', 'detectedAt', 'usedDate', 'amount', 'cardHint', 'merchant', 'type', 'status', 'fingerprint', 'note', 'createdAt', 'createdBy'];
    const next = {};
    allowed.forEach(key => { if (candidate[key] !== undefined) next[key] = candidate[key]; });
    return next;
  }

  function handleImportCandidates(items) {
    importCandidates = Array.isArray(items) ? items : [];
    if (['imports', 'settings', 'home'].includes(currentPage)) renderPage();
  }

  /* ================= レシート明細（買ったものと、その結末） =================
   * レシート本体と明細行は state に入れない。
   * state は workspaces/{id} の1ドキュメントへ丸ごと保存されるため、
   * 行数の増えるレシートを入れると1MiBの上限に当たり、入力のたびに全量が再送される。
   * そのため receipts / receiptItems はサブコレクションだけで持ち、Firestoreを正とする。
   * 共有スペースに接続していないときは、この機能は使えない。
   * ====================================================================== */

  const RECEIPT_CATEGORIES = finance.RECEIPT_CATEGORIES;

  const PAYMENT_METHODS = { cash: '現金', card: 'カード', emoney: '電子マネー', unknown: '不明' };

  const RECEIPT_STATUS = {
    pending: { label: '未確認', className: 'badge-planned' },
    accepted: { label: '確認済み', className: 'badge-settled' },
    needs_review: { label: '要確認', className: 'badge-warn' },
    ignored: { label: '無視', className: 'badge-muted' }
  };

  const OUTCOME_LABELS = {
    in_stock: 'まだある',
    consumed: '使った',
    expired: '期限切れ',
    discarded: '使わず処分',
    unused: '使う見込みなし',
    unnecessary: '不要だった'
  };

  /** 「捨てた」の理由と、そこから決まる結末 */
  const DISCARD_REASONS = [
    { reason: '期限切れ', outcome: 'expired' },
    { reason: '使わなかった', outcome: 'discarded' },
    { reason: '買いすぎ', outcome: 'unused' },
    { reason: '好みでなかった', outcome: 'unnecessary' }
  ];

  /** 共有スペースにつながっているか。つながっていなければレシートは使えない。 */
  function receiptsAvailable() {
    return Boolean(cloud && cloud.getSession && cloud.getSession()?.workspace);
  }

  /** 明細行に、そのレシートの購入日と店名を写す。純粋関数へはこの形で渡す。 */
  function decoratedReceiptItems() {
    const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
    return receiptItems.map(item => {
      const receipt = byId.get(item.receiptId);
      return {
        ...item,
        purchasedAt: receipt?.purchasedAt || '',
        storeName: receipt?.storeName || '',
        receiptStatus: receipt?.status || ''
      };
    });
  }

  function receiptLinesOf(receiptId) {
    return receiptItems
      .filter(item => item.receiptId === receiptId)
      .sort((a, b) => (Number(a.lineNo) || 0) - (Number(b.lineNo) || 0));
  }

  function sortedReceipts() {
    return receipts.slice().sort((a, b) =>
      String(b.purchasedAt || '').localeCompare(String(a.purchasedAt || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  /**
   * ふりかえりを始める曜日（0=日曜）。その曜日以降になったら、
   * 対象が残っている間はホームのカードを出し続ける。
   * 既定の0（日曜）はどの曜日でも条件を満たすので、対象があれば常に出る。
   */
  function reviewWindowOpen(dateString = today()) {
    const configured = Number(state?.settings?.reviewDayOfWeek);
    const startDay = Number.isFinite(configured) ? Math.min(Math.max(Math.round(configured), 0), 6) : 0;
    try { return finance.parseLocalDate(dateString).getDay() >= startDay; }
    catch (error) { return true; }
  }

  /** ふりかえりで聞く明細行。未接続のときは何も出さない。 */
  function dueReviewItems() {
    if (!receiptsAvailable()) return [];
    if (!reviewWindowOpen()) return [];
    const items = decoratedReceiptItems().filter(item => item.receiptStatus !== 'ignored');
    return finance.dueForReview(items, { today: today() });
  }

  /** ホームと レシートページの上部に出す案内。対象が無ければ何も出さない。 */
  function renderReviewPrompt() {
    const due = dueReviewItems();
    if (!due.length) return '';
    return `<section class="card notice-card"><strong>ふりかえり ${due.length}件</strong><p>買ったものを使い切れたかを1件ずつ確認します。「使った／まだある／捨てた」の3択で、1タップずつ進みます。</p><button class="button button-quiet button-small" data-action="open-review">ふりかえる</button></section>`;
  }

  /* ---------- レシート一覧 ---------- */

  /** 記録ページ「レシート」タブの中身。専用ページは持たない。 */
  function renderReceipts() {
    if (!receiptsAvailable()) {
      return '<section class="card empty"><div><strong>共有スペースに接続すると使えます</strong>レシートの明細は端末ではなく共有スペースに保存します。設定からGoogleでログインし、共有スペースを選んでください。</div></section>';
    }

    const rows = sortedReceipts().map(receipt => {
      const lines = receiptLinesOf(receipt.id);
      const status = RECEIPT_STATUS[receipt.status] || RECEIPT_STATUS.pending;
      const opened = openReceiptId === receipt.id;
      const lineSum = lines.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const mismatched = lines.length > 0 && lineSum !== Number(receipt.total || 0);
      return `<div class="receipt-row">
        <div class="candidate-row">
          <div class="candidate-main">
            <div class="candidate-head"><strong>${esc(receipt.storeName || '店名なし')}</strong><span class="badge ${status.className}">${status.label}</span></div>
            <small>${formatDate(receipt.purchasedAt, true)}・${formatAbsoluteYen(receipt.total)}・明細${lines.length}件・${esc(PAYMENT_METHODS[receipt.paymentMethod] || '不明')}</small>
            ${mismatched ? `<small class="value-negative">明細の合計 ${formatAbsoluteYen(lineSum)} が合計金額と合っていません</small>` : ''}
            ${receipt.note ? `<small>${esc(receipt.note)}</small>` : ''}
          </div>
          <div class="list-actions">
            <button class="mini-button" data-action="toggle-receipt" data-id="${esc(receipt.id)}">${opened ? '閉じる' : '明細'}</button>
            <button class="mini-button" data-action="edit-receipt" data-id="${esc(receipt.id)}">編集</button>
            <button class="mini-button danger" data-action="delete-receipt" data-id="${esc(receipt.id)}">削除</button>
          </div>
        </div>
        ${opened ? `<div class="receipt-line-list">${lines.map(renderReceiptLineView).join('') || emptyBlock('明細がありません', '「編集」から明細行を追加できます。')}</div>` : ''}
      </div>`;
    }).join('');

    return `
      ${renderReviewPrompt()}
      <section class="card info-card"><p class="check-detail">レシートの明細は<strong>共有スペースにだけ</strong>保存します。今使える金額や支払い能力チェックには影響しません。捨てた記録は、「取引」タブの「ムダ支出」に集計されます。</p></section>
      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">${receipts.length}件</span><h2>レシート一覧</h2></div><button class="button button-quiet button-small" data-action="add-receipt">レシートを追加</button></div>
        <div class="receipt-list">${rows || emptyBlock('レシートがありません', '「レシートを追加」から店名・日付・合計と明細行を入力してください。')}</div>
      </section>`;
  }

  /** 一覧に出す明細行1件。結末はこの場で変えられる。 */
  function renderReceiptLineView(item) {
    const waste = finance.wasteAmountOf(item);
    const outcome = item.outcome || 'in_stock';
    const options = Object.entries(OUTCOME_LABELS)
      .map(([value, label]) => `<option value="${value}" ${outcome === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="receipt-line-view">
      <div class="receipt-line-main"><strong>${esc(item.name || item.rawName || '品名なし')}</strong><small>${esc(item.category || 'その他')}・${Number(item.quantity || 0)}${esc(item.unit || '')}・${formatAbsoluteYen(item.amount)}${item.outcomeTracked ? '' : '・ふりかえり対象外'}${waste ? `・ムダ ${formatAbsoluteYen(waste)}` : ''}</small></div>
      <select class="receipt-line-outcome" data-line-outcome data-id="${esc(item.id)}" aria-label="${esc(item.name || item.rawName || '明細')}の結末">${options}</select>
    </div>`;
  }

  /* ---------- レシートの入力モーダル ---------- */

  function emptyReceiptLine() {
    return {
      id: '', rawName: '', name: '', quantity: 1, unit: '個', unitPrice: 0, amount: 0,
      category: '食品', outcomeTracked: true, trackedManual: false,
      outcome: 'in_stock', outcomeAt: '', outcomeReason: '', note: '', createdAt: ''
    };
  }

  function openReceiptModal(receiptId = '') {
    if (!receiptsAvailable()) { showToast('共有スペースに接続すると使えます'); return; }
    const receipt = receipts.find(item => item.id === receiptId) || null;
    // 保存済みの行は、ユーザーが決めた「聞くかどうか」をそのまま尊重する
    const lines = receipt ? receiptLinesOf(receipt.id).map(item => ({ ...item, trackedManual: true })) : [];
    // 行を足したり消したりすると下書きは上書きされるので、元の品名はここで別に控える
    receiptOriginalNames = new Map(lines.filter(item => item.id).map(item => [item.id, String(item.rawName || item.name || '')]));
    receiptDraft = { id: receipt?.id || '', lines: lines.length ? lines : [emptyReceiptLine()] };
    $('#receipt-modal-title').textContent = receipt ? 'レシートを編集' : 'レシートを追加';
    $('#receipt-id').value = receipt?.id || '';
    $('#receipt-store').value = receipt?.storeName || '';
    $('#receipt-date').value = receipt?.purchasedAt || today();
    $('#receipt-total').value = receipt ? String(Number(receipt.total || 0)) : '';
    $('#receipt-tax').value = receipt ? String(Number(receipt.taxTotal || 0)) : '';
    $('#receipt-method').value = PAYMENT_METHODS[receipt?.paymentMethod] ? receipt.paymentMethod : 'unknown';
    $('#receipt-note').value = receipt?.note || '';
    renderReceiptLines();
    $('#receipt-modal').hidden = false;
    $('#receipt-store').focus();
  }

  function renderReceiptLines() {
    const container = $('#receipt-lines');
    if (!container || !receiptDraft) return;
    container.innerHTML = receiptDraft.lines.map((line, index) => {
      const categories = RECEIPT_CATEGORIES
        .map(name => `<option value="${esc(name)}" ${(line.category || 'その他') === name ? 'selected' : ''}>${esc(name)}</option>`).join('');
      const outcomes = Object.entries(OUTCOME_LABELS)
        .map(([value, label]) => `<option value="${value}" ${(line.outcome || 'in_stock') === value ? 'selected' : ''}>${label}</option>`).join('');
      return `<div class="receipt-line" data-line-index="${index}">
        <div class="receipt-line-head"><strong>${index + 1}行目</strong><button type="button" class="mini-button danger" data-action="remove-receipt-line" data-index="${index}">削除</button></div>
        <label><span>品名</span><input type="text" maxlength="60" data-line-field="rawName" value="${esc(line.rawName || line.name || '')}" placeholder="例：もやし"></label>
        <div class="field-grid field-grid-2">
          <label><span>数量</span><input type="number" min="0" step="0.01" inputmode="decimal" data-line-field="quantity" value="${Number(line.quantity || 0)}"></label>
          <label><span>単位</span><input type="text" maxlength="8" data-line-field="unit" value="${esc(line.unit || '')}" placeholder="個"></label>
        </div>
        <div class="field-grid field-grid-2">
          <label><span>単価</span><div class="amount-input"><span>¥</span><input type="number" min="0" step="1" inputmode="numeric" data-line-field="unitPrice" value="${Number(line.unitPrice || 0)}"></div></label>
          <label><span>金額</span><div class="amount-input"><span>¥</span><input type="number" min="0" step="1" inputmode="numeric" data-line-field="amount" value="${Number(line.amount || 0)}"></div></label>
        </div>
        <div class="field-grid field-grid-2">
          <label><span>カテゴリ</span><select data-line-field="category">${categories}</select></label>
          <label><span>結末</span><select data-line-field="outcome">${outcomes}</select></label>
        </div>
        <label class="check-row"><input type="checkbox" data-line-field="outcomeTracked" data-manual="${line.trackedManual ? '1' : ''}" ${line.outcomeTracked ? 'checked' : ''}><span>ふりかえりで聞く</span></label>
      </div>`;
    }).join('');
    updateReceiptLineSum();
  }

  /** 画面に出ている明細行をそのまま読み取る（下書きの正はDOM側） */
  function readReceiptLinesFromDom() {
    return $$('#receipt-lines .receipt-line').map((row, index) => {
      const get = field => row.querySelector(`[data-line-field="${field}"]`);
      const stored = receiptDraft?.lines?.[index] || {};
      const trackedNode = get('outcomeTracked');
      const rawName = String(get('rawName')?.value || '').trim();
      return {
        ...stored,
        id: stored.id || '',
        lineNo: index + 1,
        rawName,
        name: rawName,
        quantity: Math.max(Number(get('quantity')?.value || 0), 0),
        unit: String(get('unit')?.value || '').trim(),
        unitPrice: Math.max(Math.round(Number(get('unitPrice')?.value || 0)), 0),
        amount: Math.max(Math.round(Number(get('amount')?.value || 0)), 0),
        category: get('category')?.value || 'その他',
        outcome: get('outcome')?.value || 'in_stock',
        outcomeTracked: Boolean(trackedNode?.checked),
        trackedManual: trackedNode?.dataset?.manual === '1'
      };
    });
  }

  /**
   * 明細行の入力に合わせて、金額と「ふりかえりで聞くか」を追従させる。
   * 描き直すと入力中のカーソルが飛ぶので、DOMを直接書き換えるだけにする。
   */
  function onReceiptLineInput(field) {
    const row = field.closest('.receipt-line');
    if (!row) return;
    const get = name => row.querySelector(`[data-line-field="${name}"]`);
    const key = field.dataset.lineField;
    if (key === 'outcomeTracked') { field.dataset.manual = '1'; return; }
    if (['quantity', 'unitPrice'].includes(key)) {
      const quantity = Number(get('quantity')?.value || 0);
      const unitPrice = Number(get('unitPrice')?.value || 0);
      const amountNode = get('amount');
      if (amountNode && quantity > 0 && unitPrice > 0) amountNode.value = String(Math.round(quantity * unitPrice));
    }
    const trackedNode = get('outcomeTracked');
    if (trackedNode && trackedNode.dataset?.manual !== '1') {
      trackedNode.checked = finance.classifyOutcomeTracked({
        category: get('category')?.value || '',
        amount: Number(get('amount')?.value || 0)
      });
    }
    updateReceiptLineSum();
  }

  /** 明細行の合計と、合計金額とのズレを出す。ズレていても保存はできる。 */
  function updateReceiptLineSum() {
    const node = $('#receipt-line-sum');
    if (!node) return;
    const sum = $$('#receipt-lines [data-line-field="amount"]')
      .reduce((total, input) => total + Math.max(Math.round(Number(input.value || 0)), 0), 0);
    const total = Math.max(Math.round(Number($('#receipt-total')?.value || 0)), 0);
    node.textContent = `明細の合計 ${formatAbsoluteYen(sum)}`;
    const mismatched = sum !== total && (sum > 0 || total > 0);
    node.classList.toggle('value-negative', mismatched);
    const note = $('#receipt-sum-note');
    if (note) note.textContent = mismatched ? `合計金額 ${formatAbsoluteYen(total)} と合っていません。保存はできますが「要確認」になります。` : '';
  }

  function addReceiptLine() {
    if (!receiptDraft) return;
    receiptDraft.lines = readReceiptLinesFromDom();
    receiptDraft.lines.push(emptyReceiptLine());
    renderReceiptLines();
  }

  function removeReceiptLine(index) {
    if (!receiptDraft) return;
    const lines = readReceiptLinesFromDom();
    lines.splice(Number(index) || 0, 1);
    receiptDraft.lines = lines.length ? lines : [emptyReceiptLine()];
    renderReceiptLines();
  }

  async function saveReceiptForm(event) {
    event.preventDefault();
    if (!receiptsAvailable()) { showToast('共有スペースに接続すると使えます'); return; }
    const current = receipts.find(item => item.id === (receiptDraft?.id || '')) || null;
    const total = Math.max(Math.round(Number($('#receipt-total').value || 0)), 0);
    const lines = readReceiptLinesFromDom().filter(line => line.rawName || line.amount > 0);
    const lineSum = lines.reduce((sum, line) => sum + line.amount, 0);
    // 明細を入れたのに合計と合わないときは、保存は通したうえで「要確認」にする
    const mismatched = lines.length > 0 && lineSum !== total;
    const method = $('#receipt-method').value;

    const receipt = {
      id: receiptDraft?.id || '',
      storeName: String($('#receipt-store').value || '').trim(),
      purchasedAt: $('#receipt-date').value || today(),
      total,
      taxTotal: Math.max(Math.round(Number($('#receipt-tax').value || 0)), 0),
      paymentMethod: PAYMENT_METHODS[method] ? method : 'unknown',
      transactionId: current?.transactionId || '',
      source: current?.source || 'manual',
      status: mismatched ? 'needs_review' : (current && current.status !== 'needs_review' ? current.status : 'pending'),
      note: String($('#receipt-note').value || '').trim(),
      createdAt: current?.createdAt || '',
      createdBy: current?.createdBy || ''
    };

    const payload = lines.map((line, index) => {
      const category = RECEIPT_CATEGORIES.includes(line.category) ? line.category : 'その他';
      const outcome = OUTCOME_LABELS[line.outcome] ? line.outcome : 'in_stock';
      return {
        id: line.id || '',
        lineNo: index + 1,
        rawName: line.rawName,
        // 正規化名は今のところレシートの表記そのまま。将来の名寄せのために別フィールドにしておく。
        name: line.name || line.rawName,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        amount: line.amount,
        category,
        outcomeTracked: line.trackedManual
          ? Boolean(line.outcomeTracked)
          : finance.classifyOutcomeTracked({ category, amount: line.amount }),
        outcome,
        outcomeAt: line.outcomeAt || '',
        outcomeReason: line.outcomeReason || '',
        wasteAmount: finance.wasteAmountOf({ amount: line.amount, outcome }),
        note: line.note || '',
        createdAt: line.createdAt || ''
      };
    });

    try {
      await cloud.saveReceipt(receipt, payload);
      await learnItemAliases(payload);
      receiptDraft = null;
      receiptOriginalNames = new Map();
      closeModal('receipt-modal');
      showToast(mismatched ? '保存しました。明細の合計が合わないので「要確認」にしました' : 'レシートを保存しました');
    } catch (error) {
      console.warn('レシートを保存できませんでした', error);
      showToast('レシートを保存できませんでした');
    }
  }

  async function deleteReceiptRow(receiptId) {
    if (!receiptsAvailable()) return;
    if (!window.confirm('このレシートと明細をすべて削除しますか？')) return;
    try {
      await cloud.deleteReceipt(receiptId);
      if (openReceiptId === receiptId) openReceiptId = '';
      showToast('レシートを削除しました');
    } catch (error) {
      console.warn('レシートを削除できませんでした', error);
      showToast('レシートを削除できませんでした');
    }
  }

  /** 一覧の結末セレクトから直接変えたとき */
  async function setReceiptOutcome(lineId, value) {
    if (!receiptsAvailable()) return;
    const item = receiptItems.find(row => row.id === lineId);
    if (!item) return;
    const outcome = OUTCOME_LABELS[value] ? value : 'in_stock';
    try {
      await cloud.updateReceiptItem(lineId, {
        outcome,
        outcomeAt: nowIso(),
        outcomeReason: ['in_stock', 'consumed'].includes(outcome) ? '' : (item.outcomeReason || ''),
        wasteAmount: finance.wasteAmountOf({ amount: item.amount, outcome })
      });
    } catch (error) {
      console.warn('結末を保存できませんでした', error);
      showToast('結末を保存できませんでした');
    }
  }

  /* ---------- 品名の名寄せ（辞書はユーザーの操作からだけ増やす） ----------
   * 機械的に寄せられるところ（ﾓﾔｼ→もやし）は finance-engine の normalizeItemName が担当する。
   * それでも寄らないところ（緑豆もやし→もやし）は意味の判断なので、機械は決して自動で寄せない。
   * ユーザーが品名を書き換えたときと、「まとめる」を押したときだけ辞書に足す。
   * ==================================================================== */

  /**
   * 明細の品名の書き換えから辞書を学ぶ。
   * 正規化しただけで同じになるもの（ﾓﾔｼ→もやし）は、辞書に入れても意味がないので入れない。
   */
  async function learnItemAliases(lines) {
    if (!receiptsAvailable() || !cloud?.saveItemAlias) return;
    const jobs = [];
    (lines || []).forEach(line => {
      const before = receiptOriginalNames.get(line.id || '');
      if (!before) return;
      const after = String(line.rawName || line.name || '').trim();
      if (!after) return;
      const aliasKey = finance.normalizeItemName(before);
      const canonicalKey = finance.normalizeItemName(after);
      if (!aliasKey || !canonicalKey || aliasKey === canonicalKey) return;
      jobs.push(cloud.saveItemAlias({ aliasKey, canonicalName: after, canonicalKey, category: line.category || '' }));
    });
    if (!jobs.length) return;
    try { await Promise.all(jobs); }
    catch (error) { console.warn('品名のまとめを保存できませんでした', error); }
  }

  /** 「まとめる」モーダルを開く。行を選ぶだけなので、候補は今の一覧から作る。 */
  function openMergeModal(key, name) {
    if (!receiptsAvailable()) { showToast('共有スペースに接続すると使えます'); return; }
    if (!key) return;
    mergeSource = { key, name: name || key };
    $('#merge-modal').hidden = false;
    renderMergeCard();
  }

  function renderMergeCard() {
    const body = $('#merge-body');
    if (!body || !mergeSource) return;
    const others = wasteRanking(20).filter(group => group.key !== mergeSource.key);
    body.innerHTML = `
      <p class="form-note"><strong>${esc(mergeSource.name)}</strong> を、どの品名としてまとめますか。まとめると、繰り返し捨てているものの集計で1つに数えます。</p>
      <div class="mini-list">${others.map(group => `<div class="mini-row"><span>${esc(group.name)}<small>${group.purchaseCount}回買って${group.wasteCount}回捨てた</small></span><button type="button" class="mini-button" data-action="merge-target" data-name="${esc(group.name)}">これにまとめる</button></div>`).join('') || emptyBlock('まとめ先の候補がありません', 'ほかの品名を捨てた記録が増えると選べるようになります。')}</div>
      <p class="form-note">まとめたものは、設定の「まとめた品名」から解除できます。</p>
      <div class="modal-actions"><button type="button" class="button button-quiet" data-close-modal="merge-modal">キャンセル</button></div>`;
  }

  /** 「◯◯ を △△ としてまとめる」を確定する。 */
  async function mergeItemInto(name) {
    const canonicalName = String(name || '').trim();
    if (!mergeSource || !canonicalName) return;
    const aliasKey = mergeSource.key;
    const canonicalKey = finance.normalizeItemName(canonicalName);
    if (!canonicalKey || canonicalKey === aliasKey) { showToast('同じ品名にはまとめられません'); return; }
    try {
      await cloud.saveItemAlias({ aliasKey, canonicalName, canonicalKey, category: '' });
      mergeSource = null;
      closeModal('merge-modal');
      showToast(`「${canonicalName}」にまとめました`);
    } catch (error) {
      console.warn('品名をまとめられませんでした', error);
      showToast('品名をまとめられませんでした');
    }
  }

  /** まとめを解除する（設定ページの一覧から） */
  async function unmergeItem(aliasKey) {
    if (!receiptsAvailable() || !aliasKey) return;
    try {
      await cloud.deleteItemAlias(aliasKey);
      showToast('まとめを解除しました');
    } catch (error) {
      console.warn('まとめを解除できませんでした', error);
      showToast('まとめを解除できませんでした');
    }
  }

  /** 設定ページの「まとめた品名」。ここが唯一の取り消し口。 */
  function renderAliasSettings() {
    if (!receiptsAvailable()) return '';
    const rows = itemAliases.slice()
      .sort((a, b) => String(a.canonicalName || '').localeCompare(String(b.canonicalName || ''), 'ja') || String(a.aliasKey || '').localeCompare(String(b.aliasKey || ''), 'ja'))
      .map(alias => `<div class="settings-inline"><strong>${esc(alias.aliasKey || alias.id)} → ${esc(alias.canonicalName)}</strong><button class="mini-button danger" data-action="unmerge-item" data-key="${esc(alias.aliasKey || alias.id)}">解除</button></div>`)
      .join('');
    return `<section class="settings-card"><h2>まとめた品名</h2><p>レシートの明細で品名を書き換えるか、「ムダ支出」の「まとめる」を押すと、表記ゆれをまとめた記録がここに残ります。解除すると別々の品名に戻ります。</p>${rows || '<p class="form-note">まとめた品名はまだありません。</p>'}</section>`;
  }

  /* ---------- ふりかえり（専用ページは作らず、モーダルで1件ずつ） ---------- */

  function openReviewModal() {
    const due = dueReviewItems();
    if (!due.length) { showToast('ふりかえりの対象はありません'); return; }
    reviewQueue = due;
    reviewIndex = 0;
    reviewReasonFor = '';
    $('#review-modal').hidden = false;
    renderReviewCard();
  }

  function renderReviewCard() {
    const body = $('#review-body');
    const progress = $('#review-progress');
    if (!body) return;
    const item = reviewQueue[reviewIndex];
    if (!item) {
      if (progress) progress.textContent = `${reviewQueue.length}件すべて確認しました`;
      body.innerHTML = `<div class="empty"><div><strong>ふりかえりは終わりです</strong>捨てた分は、記録ページの「ムダ支出」にまとまります。</div></div><div class="modal-actions"><button type="button" class="button button-primary" data-close-modal="review-modal">閉じる</button></div>`;
      return;
    }
    if (progress) progress.textContent = `${reviewIndex + 1} / ${reviewQueue.length}件目`;
    const asking = reviewReasonFor === item.id;
    body.innerHTML = `
      <div class="review-item">
        <strong class="review-name">${esc(item.name || item.rawName || '品名なし')}</strong>
        <small>${esc(item.storeName || '店名なし')}・${formatDate(item.purchasedAt, true)}に購入・${formatAbsoluteYen(item.amount)}・${esc(item.category || 'その他')}</small>
        <small>買ってから${item.elapsedDays}日</small>
      </div>
      ${asking
        ? `<p class="form-note">捨てた理由はどれですか。</p>
           <div class="review-choices review-choices-reason">${DISCARD_REASONS.map(entry => `<button type="button" class="button button-quiet" data-action="review-reason" data-reason="${esc(entry.reason)}">${esc(entry.reason)}</button>`).join('')}</div>
           <div class="modal-actions"><button type="button" class="button button-quiet button-small" data-action="review-cancel-reason">選び直す</button></div>`
        : `<div class="review-choices">
             <button type="button" class="button button-primary" data-action="review-answer" data-answer="consumed">使った</button>
             <button type="button" class="button button-quiet" data-action="review-answer" data-answer="in_stock">まだある</button>
             <button type="button" class="button button-quiet" data-action="review-answer" data-answer="discard">捨てた</button>
           </div>
           <p class="form-note">「まだある」を選ぶと、次の機会にもう一度たずねます。</p>`}`;
  }

  function answerReview(answer) {
    const item = reviewQueue[reviewIndex];
    if (!item) return null;
    if (answer === 'discard') { reviewReasonFor = item.id; renderReviewCard(); return null; }
    return applyReviewOutcome(item, answer === 'consumed' ? 'consumed' : 'in_stock', '');
  }

  function answerReviewReason(reason) {
    const item = reviewQueue[reviewIndex];
    if (!item) return null;
    const matched = DISCARD_REASONS.find(entry => entry.reason === reason) || DISCARD_REASONS[1];
    return applyReviewOutcome(item, matched.outcome, matched.reason);
  }

  /**
   * 1件分の答えを保存して次へ進む。
   * 「まだある」は outcome を変えず outcomeAt だけ更新する。
   * dueForReview は outcomeAt を基準日にするので、その日から数え直しになる。
   */
  async function applyReviewOutcome(item, outcome, reason) {
    reviewReasonFor = '';
    try {
      await cloud.updateReceiptItem(item.id, {
        outcome,
        outcomeAt: nowIso(),
        outcomeReason: reason || '',
        wasteAmount: finance.wasteAmountOf({ amount: item.amount, outcome })
      });
    } catch (error) {
      console.warn('ふりかえりを保存できませんでした', error);
      showToast('保存できませんでした');
      return;
    }
    reviewIndex += 1;
    renderReviewCard();
    if (reviewIndex >= reviewQueue.length) showToast('ふりかえりが終わりました');
  }

  /* ---------- ムダ支出レポート（記録ページの上部カード） ---------- */

  /** 繰り返し捨てているもの。名寄せ辞書を通してまとめる。 */
  function wasteRanking(limit = 5) {
    if (!receiptsAvailable()) return [];
    return finance.repeatedWasteRanking(decoratedReceiptItems(), { limit, aliases: itemAliases });
  }

  function renderWasteCard(range, summary) {
    if (!receiptsAvailable()) return '';
    const items = decoratedReceiptItems();
    if (!items.length) return '';
    const waste = finance.summarizeWaste(items, { from: range.startDate, to: range.endDate });
    const ranking = wasteRanking(5);
    const food = (summary.expense.categories || []).find(item => item.label === '食費');
    const foodTotal = food ? food.amount : 0;
    const slices = waste.total ? chartSlices(waste) : [];

    return `<section class="card chart-card waste-card">
      <div class="list-card-header"><div><span class="eyebrow">ムダ支出</span><h2>${esc(rangeLabel(range))}に捨てたもの</h2></div><strong class="value-negative">${formatAbsoluteYen(waste.total)}</strong></div>
      <div class="summary-strip">
        <div class="stat-card"><span>廃棄額</span><strong class="value-negative">${formatAbsoluteYen(waste.total)}</strong></div>
        <div class="stat-card"><span>食費に対する割合</span><strong>${foodTotal > 0 ? `${Math.round(waste.total / foodTotal * 100)}%` : '—'}</strong></div>
        <div class="stat-card"><span>捨てた明細</span><strong>${waste.wastedCount}件</strong></div>
      </div>
      ${waste.total ? renderDonut(slices, waste.total, 'ムダ') : ''}
      ${waste.total ? `<ul class="chart-legend">${slices.map(slice => `<li><div class="legend-row"><span class="legend-chip" style="background:${slice.color}"></span><span class="legend-label">${esc(slice.label)}${slice.grouped ? `<small>${slice.grouped}件のカテゴリ</small>` : ''}</span><span class="legend-amount">${formatAbsoluteYen(slice.amount)}</span><span class="legend-ratio">${Math.round(slice.ratio * 100)}%</span></div></li>`).join('')}</ul>` : '<p class="form-note">この期間に捨てたものはありません。</p>'}
      ${ranking.length ? `<div class="list-card-header"><div><span class="eyebrow">全期間</span><h2>繰り返し捨てているもの</h2></div><small class="muted">上位${ranking.length}件</small></div>
        <div class="mini-list">${ranking.map(group => `<div class="mini-row"><span>${esc(group.name)}<small>${group.purchaseCount}回買って${group.wasteCount}回捨てた</small></span><strong class="value-negative">${formatAbsoluteYen(group.wasteTotal)}</strong><button type="button" class="mini-button" data-action="merge-item" data-key="${esc(group.key)}" data-name="${esc(group.name)}">まとめる</button></div>`).join('')}</div>` : ''}
      <p class="form-note">レシートの明細から集計しています。取引の金額そのものは変えません。</p>
    </section>`;
  }

  /* ---------- Firestoreからの受け取り（state には入れない） ---------- */

  function handleReceipts(items) {
    receipts = Array.isArray(items) ? items : [];
    if (['home', 'records'].includes(currentPage)) renderPage();
  }

  function handleReceiptItems(items) {
    receiptItems = Array.isArray(items) ? items : [];
    if (['home', 'records'].includes(currentPage)) renderPage();
  }

  function handleItemAliases(items) {
    itemAliases = Array.isArray(items) ? items : [];
    if (['records', 'settings'].includes(currentPage)) renderPage();
    if (mergeSource && !$('#merge-modal')?.hidden) renderMergeCard();
  }

  /* ================= 将来の期間に使える金額（今使える金額の派生） ================= */

  function openFutureModal() {
    if (!state.accounts.length) { showToast('先に口座を追加してください'); return; }
    if (!$('#future-start').value || !$('#future-end').value) applyFuturePreset('nextMonth');
    $('#future-modal').hidden = false;
    renderFutureResult();
  }

  function applyFuturePreset(name) {
    if (name === 'nextSalary') {
      const salary = nextSalary();
      $('#future-start').value = today();
      $('#future-end').value = salary.paymentDate;
    } else {
      const month = finance.shiftMonthKey(finance.monthKeyOf(today()), name === 'monthAfter' ? 2 : 1);
      const range = finance.calendarMonthRange(month);
      $('#future-start').value = range.startDate;
      $('#future-end').value = range.endDate;
    }
    renderFutureResult();
  }

  function renderFutureResult() {
    const box = $('#future-content');
    if (!box) return;
    const startDate = $('#future-start').value;
    const endDate = $('#future-end').value;
    if (!startDate || !endDate) { box.innerHTML = emptyBlock('期間を選んでください'); return; }
    if (endDate < startDate) { box.innerHTML = emptyBlock('終了日は開始日より後にしてください'); return; }

    let result;
    try {
      result = finance.calculateFutureSpendable({
        ...buildEngineInput(),
        includeSalary: state.settings.wage.includeForecastInSpendable !== false
      }, { startDate, endDate });
    } catch (error) {
      box.innerHTML = emptyBlock('試算できませんでした', esc(error.message));
      return;
    }

    const rows = result.breakdown
      .filter(row => row.amount !== 0 || row.key === 'cash')
      .map(row => `<div class="breakdown-row"><div class="breakdown-label"><i class="breakdown-dot ${row.direction === 'in' ? 'income' : 'payment'}"></i>${row.key === 'cash' && result.isFuture ? '開始日時点の予測残高' : row.label}</div><strong class="breakdown-value ${row.amount < 0 ? 'value-negative' : 'value-positive'}">${formatSigned(row.amount)}</strong></div>`)
      .join('');

    const risky = result.basedOn && result.basedOn.verdict !== 'ok';

    box.innerHTML = `
      <div class="future-amount">
        <span>${formatDate(startDate, true)}〜${formatDate(endDate, true)}に使える金額</span>
        <strong class="${result.total < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(result.total)}</strong>
        <small>1日あたり ${formatDisplayedAmount(result.daily)}・${result.days}日間</small>
      </div>
      <div class="breakdown-list">${rows}</div>
      ${risky ? `<p class="form-note warn-note">開始日までに${formatDate(result.basedOn.shortfallDate || result.basedOn.minBalanceDate, true)}で「${esc(result.basedOn.verdictLabel)}」になる見込みです。先にそちらを確認してください。</p>` : ''}
      <p class="form-note">この試算には、まだ登録していない生活費は含まれません。実際に使える額はこれより少なくなります。</p>`;
  }

  /* ================= 機能A｜支払い能力チェック（詳細） ================= */

  function renderCashflow() {
    const check = cashflowCheck();
    if (!check) return '<div class="page-heading"><div><span class="eyebrow">支払い能力チェック</span><h1>支払い能力チェック</h1></div></div><section class="card empty"><div><strong>口座がありません</strong>口座を追加すると計算できます。</div></section>';

    const status = checkStatusOf(check);
    const plan = finance.suggestShortfallResolution(check, state.accounts);

    const timelineRows = check.eventDays.map(day => `<tr class="${day.shortfall ? 'row-danger' : day.belowDefense ? 'row-warn' : ''}">
        <td>${formatDate(day.date, true)}</td>
        <td class="num">${day.inflow ? formatFlowAmount(day.inflow, 'in') : '—'}</td>
        <td class="num">${day.outflow ? formatFlowAmount(day.outflow, 'out') : '—'}</td>
        <td class="num"><strong class="${day.primaryBalance < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(day.primaryBalance)}</strong></td>
        <td>${day.events.map(item => esc(item.memo || item.category || transactionLabel(item))).join('、')}</td>
      </tr>`).join('');

    const causeRows = check.causes.map(cause => miniRow({ title: esc(cause.memo || cause.category || '支出'), sub: `${formatDate(cause.date, true)}${cause.cardId ? `・${esc(cardName(cause.cardId))}` : ''}`, amount: cause.amount, direction: 'out' })).join('');

    const billRows = check.cardBills.map(group => miniRow({ title: esc(group.cardName), sub: `${formatDate(group.dueDate, true)}・${group.count}件・${esc(accountName(group.accountId))}`, amount: group.total, direction: 'out' })).join('');

    const salaryRows = check.salaryEvents.map(item => miniRow({ title: `${formatMonthLabel(item.workMonth)}分の給与`, sub: `${formatDate(item.paymentDate, true)}${item.paymentDate !== item.scheduledPaymentDate ? `・${formatDate(item.scheduledPaymentDate)}が休日のため繰り上げ` : ''}`, amount: item.totalAmount, direction: 'in' })).join('');

    const planRows = plan.suggestions.map(item => miniRow({ title: `${esc(item.accountName)}から振替`, sub: `${roleLabel(item.role)}${item.isProtected ? '・計算に含めない口座' : ''}`, amount: item.amount, direction: 'in' })).join('');

    return `
      <div class="page-heading"><div><span class="eyebrow">支払い能力チェック</span><h1>支払い能力チェック</h1></div><button class="button button-quiet button-small" data-page="home">ホームへ戻る</button></div>

      <section class="card check-hero ${status.className}">
        <span class="eyebrow">${formatDate(check.startDate)}〜${formatDate(check.endDate)}・${check.days}日間／判定は${esc(check.primaryAccountName || '生活費口座')}</span>
        <h1>${status.label}</h1>
        <p class="hero-subtitle">${status.detail}</p>
        <div class="summary-strip">
          <div class="stat-card"><span>期間内の最低予測残高</span><strong class="${check.minBalance < 0 ? 'value-negative' : ''}">${formatDisplayedAmount(check.minBalance)}</strong></div>
          <div class="stat-card"><span>最低残高になる日</span><strong>${formatDate(check.minBalanceDate, true)}</strong></div>
          <div class="stat-card"><span>不足が発生する日</span><strong>${check.shortfallDate ? formatDate(check.shortfallDate, true) : 'なし'}</strong></div>
          <div class="stat-card"><span>不足額</span><strong class="${check.shortfallAmount ? 'value-negative' : ''}">${check.shortfallAmount ? formatAbsoluteYen(check.shortfallAmount) : '—'}</strong></div>
          <div class="stat-card"><span>最低限残す金額</span><strong>${formatAbsoluteYen(check.defenseLine)}</strong></div>
        </div>
      </section>

      ${check.verdict !== 'ok' ? `<section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">不足解消の提案</span><h2>${formatDate(plan.byDate, true)}までに ${formatAbsoluteYen(plan.required)} を用意する</h2></div></div>
        <div class="mini-list">${planRows || emptyBlock('振替できる口座がありません', '収入を増やすか、予定を先送りする必要があります。')}</div>
        ${plan.covered ? '' : `<p class="form-note">口座の残高だけでは ${formatAbsoluteYen(plan.shortage)} 足りません。</p>`}
      </section>` : ''}

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">${check.shortfallDate || check.belowDefenseDate ? '不足の原因' : '大きな支出'}</span><h2>${formatDate(check.shortfallDate || check.belowDefenseDate || check.minBalanceDate, true)}までの予定</h2></div></div>
        <div class="mini-list">${causeRows || emptyBlock('大きな支出はありません')}</div>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">クレジットカード</span><h2>引落予定</h2></div></div>
        <div class="mini-list">${billRows || emptyBlock('カードの引落予定はありません')}</div>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">給与</span><h2>支給日と支給予定額</h2></div></div>
        <div class="mini-list">${salaryRows || emptyBlock('期間内の給与予定はありません')}</div>
      </section>

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">日付別</span><h2>残高推移</h2></div><small>予定がある日だけ表示・横スクロールできます</small></div>
        <div class="table-scroll">
          <table class="timeline-table">
            <thead><tr><th>日付</th><th class="num">入金</th><th class="num">出金</th><th class="num">予測残高</th><th>内容</th></tr></thead>
            <tbody>${timelineRows || '<tr><td colspan="5">この期間に予定はありません</td></tr>'}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderPlans() {
    const planned = sortedTransactions(state.transactions.filter(transaction => transaction.status === 'planned'));
    const filters = [['all', 'すべて'], ['payment', '支払い'], ['income', '収入'], ['saving', '貯金'], ['nisa', 'NISA'], ['transfer', '振込']];
    const filtered = planned.filter(transaction => planFilter === 'all' || transaction.kind === planFilter);
    const deadline = getNextDeadline();
    const within = planned.filter(transaction => transaction.dueDate <= deadline && transaction.dueDate >= today());
    const withinAmount = within.reduce((sum, transaction) => {
      if (['income', 'reimbursement'].includes(transaction.kind)) return sum + Number(transaction.amount);
      if (transaction.kind === 'transfer' && !isExternalTransfer(transaction)) return sum;
      return sum - Number(transaction.amount);
    }, 0);
    return `
      <div class="page-heading"><div><span class="eyebrow">予定</span><h1>予定</h1></div></div>
      <div class="summary-strip"><div class="stat-card"><span>${formatDate(deadline)}までの予定</span><strong>${within.length}件</strong></div><div class="stat-card"><span>期限内の収支見込み</span><strong class="${withinAmount >= 0 ? 'value-positive' : 'value-negative'}">${formatSigned(withinAmount)}</strong></div><div class="stat-card"><span>登録済みの予定</span><strong>${planned.length}件</strong></div></div>
      <div class="filters">${filters.map(([value, label]) => `<button class="filter-button ${planFilter === value ? 'active' : ''}" data-plan-filter="${value}">${label}</button>`).join('')}</div>
      <section class="card list-card"><div class="list-card-header"><h2>予定一覧</h2><small class="muted">確定すると残高に反映</small></div><div class="list">${renderTransactionRows(filtered, false) || emptyBlock('この種類の予定はありません', 'ホームの「予定を追加」から登録できます。')}</div></section>`;
  }

  /* ==========================================================
   * 記録の可視化
   *
   * 集計は「確定済み」の記録だけを対象にする。
   * 請求総額に吸収された明細(status: 'absorbed')は総額の内数なので必ず除外し、
   * カード利用が二重に計上されないようにしている（除外はエンジン側で実施）。
   * 貯金・NISAは支出に混ぜず、別枠として表示する。
   * 自分の口座どうしの振替は、家計全体では減っていないので集計しない。
   * ========================================================== */

  // 円グラフの配色。並び順は固定で、系列が減っても色は動かさない。
  const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
  const CHART_OTHER_COLOR = '#8b958f';
  const CHART_MAX_SLICES = 6;

  function recordRange() {
    if (recordRangeMode === 'custom' && recordStart && recordEnd) {
      return recordStart <= recordEnd
        ? { startDate: recordStart, endDate: recordEnd }
        : { startDate: recordEnd, endDate: recordStart };
    }
    return finance.monthRangeOf(recordMonth || today().slice(0, 7));
  }

  function rangeLabel(range) {
    if (recordRangeMode === 'custom') return `${formatDate(range.startDate)} 〜 ${formatDate(range.endDate)}`;
    const [year, month] = (recordMonth || today().slice(0, 7)).split('-');
    return `${year}年${Number(month)}月`;
  }

  /** 上位6件＋「その他」にまとめ、色を割り当てる */
  function chartSlices(bucket) {
    const categories = bucket.categories || [];
    if (categories.length <= CHART_MAX_SLICES) {
      return categories.map((item, index) => ({ ...item, color: CHART_COLORS[index] }));
    }
    const head = categories.slice(0, CHART_MAX_SLICES - 1).map((item, index) => ({ ...item, color: CHART_COLORS[index] }));
    const restAmount = categories.slice(CHART_MAX_SLICES - 1).reduce((sum, item) => sum + item.amount, 0);
    const restCount = categories.length - (CHART_MAX_SLICES - 1);
    return [...head, {
      label: 'その他',
      amount: restAmount,
      ratio: bucket.total > 0 ? restAmount / bucket.total : 0,
      color: CHART_OTHER_COLOR,
      grouped: restCount
    }];
  }

  /**
   * ドーナツ型の円グラフをインラインSVGで描く。ライブラリは使わない。
   * 隣り合う色が地の色で2px分離れるように、各セグメントを少し短くしている。
   */
  function renderDonut(slices, total, centerLabel) {
    if (!total || !slices.length) {
      return '<div class="donut-empty"><div><strong>データがありません</strong>この期間の記録がまだありません。</div></div>';
    }
    const radius = 38;
    const circumference = 2 * Math.PI * radius;
    const gap = slices.length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = slices.map(slice => {
      const length = Math.max(circumference * slice.ratio - gap, 0.6);
      const arc = `<circle class="donut-arc" cx="50" cy="50" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="13" stroke-linecap="butt" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${esc(slice.label)} ${formatAbsoluteYen(slice.amount)}（${Math.round(slice.ratio * 100)}%）</title></circle>`;
      offset += circumference * slice.ratio;
      return arc;
    }).join('');
    return `<div class="donut"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(centerLabel)}の内訳"><g transform="rotate(-90 50 50)">${arcs}</g></svg><div class="donut-center"><span>${esc(centerLabel)}</span><strong>${formatAbsoluteYen(total)}</strong></div></div>`;
  }

  /** 凡例。金額と割合を必ず文字で出すので、色だけに頼らずに読める。 */
  function renderChartLegend(slices, kind) {
    if (!slices.length) return '';
    return `<ul class="chart-legend">${slices.map(slice => {
      const active = recordCategory === slice.label;
      const clickable = !slice.grouped;
      return `<li><${clickable ? 'button type="button" class="legend-row' + (active ? ' active' : '') + `" data-action="filter-category" data-category="${esc(slice.label)}"` : 'div class="legend-row"'}><span class="legend-chip" style="background:${slice.color}"></span><span class="legend-label">${esc(slice.label)}${slice.grouped ? `<small>${slice.grouped}件のカテゴリ</small>` : ''}</span><span class="legend-amount">${formatAbsoluteYen(slice.amount)}</span><span class="legend-ratio">${Math.round(slice.ratio * 100)}%</span></${clickable ? 'button' : 'div'}></li>`;
    }).join('')}</ul>`;
  }

  function renderChartCard(title, bucket, kind) {
    const slices = chartSlices(bucket);
    return `<section class="card chart-card"><div class="list-card-header"><h2>${esc(title)}</h2><small class="muted">${bucket.categories.length}カテゴリ</small></div>${renderDonut(slices, bucket.total, title)}${renderChartLegend(slices, kind)}</section>`;
  }

  function renderRangeControl(range) {
    const month = recordMonth || today().slice(0, 7);
    const monthTab = recordRangeMode === 'month';
    return `<section class="card range-card">
      <div class="range-tabs"><button type="button" class="filter-button ${monthTab ? 'active' : ''}" data-action="range-mode" data-mode="month">月ごと</button><button type="button" class="filter-button ${monthTab ? '' : 'active'}" data-action="range-mode" data-mode="custom">期間を指定</button></div>
      ${monthTab
        ? `<div class="range-month"><button type="button" class="mini-button" data-action="range-month" data-step="-1">前の月</button><strong>${esc(rangeLabel(range))}</strong><button type="button" class="mini-button" data-action="range-month" data-step="1">次の月</button></div>`
        : `<div class="range-custom"><label><span>開始日</span><input type="date" id="record-start" value="${esc(range.startDate)}"></label><label><span>終了日</span><input type="date" id="record-end" value="${esc(range.endDate)}"></label></div>`}
      <div class="range-basis"><span>集計のしかた</span><div class="range-basis-buttons"><button type="button" class="filter-button ${recordBasis === 'real' ? 'active' : ''}" data-action="record-basis" data-basis="real">実質負担</button><button type="button" class="filter-button ${recordBasis === 'gross' ? 'active' : ''}" data-action="record-basis" data-basis="gross">総額</button></div></div>
    </section>`;
  }

  function setRecordRangeMode(mode) {
    recordRangeMode = mode === 'custom' ? 'custom' : 'month';
    if (recordRangeMode === 'custom' && (!recordStart || !recordEnd)) {
      const range = finance.monthRangeOf(recordMonth || today().slice(0, 7));
      recordStart = range.startDate;
      recordEnd = range.endDate;
    }
    renderPage();
  }

  function stepRecordMonth(step) {
    recordMonth = finance.shiftMonthKey(recordMonth || today().slice(0, 7), step);
    renderPage();
  }

  /** 記録ページの中のタブ。範囲指定の .filter-button と同じ見た目を使い回す。 */
  function renderRecordTabs() {
    const receiptTab = recordTab === 'receipts';
    return `<section class="card range-card"><div class="range-tabs"><button type="button" class="filter-button ${receiptTab ? '' : 'active'}" data-action="record-tab" data-tab="transactions">取引</button><button type="button" class="filter-button ${receiptTab ? 'active' : ''}" data-action="record-tab" data-tab="receipts">レシート</button></div></section>`;
  }

  function renderRecords() {
    const heading = '<div class="page-heading"><div><span class="eyebrow">記録</span><h1>支出と収入</h1></div></div>';
    if (recordTab === 'receipts') return `${heading}${renderRecordTabs()}${renderReceipts()}`;

    const range = recordRange();
    const summary = finance.summarizePeriod(state.transactions, range, { basis: recordBasis });
    const filters = [['settled', '確定済み'], ['planned', '未確定'], ['all', 'すべて']];

    // 吸収済みの明細は総額の内訳なので、一覧には出さず総額をタップして見せる
    let records = state.transactions.filter(transaction => transaction.status !== 'absorbed')
      .filter(transaction => recordFilter === 'all' || transaction.status === recordFilter);
    if (recordCategory) records = records.filter(transaction => (transaction.category || 'その他') === recordCategory);
    if (searchQuery) records = records.filter(transaction => `${transaction.memo} ${transaction.category} ${accountName(transaction.sourceAccountId)} ${transaction.cardId ? cardName(transaction.cardId) : ''}`.toLowerCase().includes(searchQuery.toLowerCase()));
    records = sortedTransactions(records).reverse();

    const netClass = summary.net >= 0 ? 'value-positive' : 'value-negative';
    return `
      ${heading}
      ${renderRecordTabs()}
      ${renderRangeControl(range)}
      ${renderWasteCard(range, summary)}
      <div class="summary-strip"><div class="stat-card"><span>収入</span><strong class="value-positive">${formatFlowAmount(summary.income.total, 'in')}</strong></div><div class="stat-card"><span>支出</span><strong class="value-negative">${formatFlowAmount(summary.expense.total, 'out')}</strong></div><div class="stat-card"><span>差引</span><strong class="${netClass}">${formatSigned(summary.net)}</strong></div></div>
      <section class="card info-card record-extra"><div class="formula-row"><span>貯蓄・投資（支出とは別枠）</span><strong>${formatAbsoluteYen(summary.saving.total)}</strong></div><div class="formula-row"><span>立替した分</span><strong>${formatAbsoluteYen(summary.lendingTotal)}</strong></div><p class="form-note">${esc(rangeLabel(range))}の確定済みの記録から集計しています。${recordBasis === 'real' ? '支出は立替分を差し引いた実質負担です。' : '支出は立替分を含む総額です。'}カードの明細は請求総額の内訳なので、二重に数えていません。</p></section>
      <div class="chart-grid">${renderChartCard('支出', summary.expense, 'expense')}${renderChartCard('収入', summary.income, 'income')}</div>
      <div class="filters"><input class="search" id="record-search" value="${esc(searchQuery)}" placeholder="メモ・カテゴリ・口座を検索">${filters.map(([value, label]) => `<button class="filter-button ${recordFilter === value ? 'active' : ''}" data-record-filter="${value}">${label}</button>`).join('')}</div>
      ${recordCategory ? `<div class="active-filter"><span>「${esc(recordCategory)}」で絞り込み中</span><button type="button" class="mini-button" data-action="filter-category" data-category="">解除</button></div>` : ''}
      <section class="card list-card"><div class="list-card-header"><h2>取引一覧</h2><small class="muted">${records.length}件</small></div><div class="list">${renderTransactionRows(records, false) || emptyBlock('記録がありません', '予定を確定するとここに残ります。')}</div></section>`;
  }

  function renderAccounts() {
    const accounts = state.accounts;
    const cards = state.cards;
    return `
      <div class="page-heading"><div><span class="eyebrow">口座</span><h1>口座</h1></div></div>
      <section class="accounts-grid">${accounts.map(item => {
        const protectedAccount = ['savings', 'investment'].includes(item.role);
        const pending = pendingExp(item.id);
        return `<article class="account-card ${protectedAccount ? 'account-protected' : ''}"><div class="account-top"><div><div class="account-role">${roleLabel(item.role)}</div><div class="account-name">${esc(item.name)}${item.isPrimary ? ' <span class="badge badge-settled">基準</span>' : ''}</div></div><div class="list-actions"><button class="mini-button" data-action="edit-account" data-id="${item.id}" aria-label="${esc(item.name)}を編集">編集</button><button class="mini-button danger" data-action="delete-account" data-id="${item.id}" aria-label="${esc(item.name)}を削除">削除</button></div></div><div class="account-balance">${formatDisplayedAmount(item.currentBalance)}</div><div class="account-bottom"><span>${protectedAccount ? '計算に含めない' : item.includeInSpendable ? '計算に含める' : '計算から除外'}</span><span>${pending ? `予定 ${formatFlowAmount(pending, 'out')}` : '予定なし'}</span></div></article>`;
      }).join('') || '<div class="card empty" style="grid-column:1/-1"><div><strong>口座を追加してください</strong>口座を登録すると計算できます。</div></div>'}</section>
      <section class="card cards-section"><div class="list-card-header"><div><span class="eyebrow">支払い方法</span><h2>クレジットカード</h2></div><button class="button button-quiet button-small" data-action="add-card">カードを追加</button></div><div class="credit-card-grid">${cards.map(item => `<article class="credit-card-item"><div class="credit-card-mark">${icon('card')}</div><div class="credit-card-main"><strong>${esc(item.name)}</strong><small>${esc(accountName(item.accountId))}から引落し</small><span>${item.closingDay ? `${item.closingDay}日締め` : '月末締め'} ・ ${item.paymentDay ? `${item.paymentDay}日払い` : '支払日未設定'}</span></div><div class="list-actions"><button class="mini-button" data-action="edit-card" data-id="${item.id}">編集</button><button class="mini-button danger" data-action="delete-card" data-id="${item.id}">削除</button></div></article>`).join('') || emptyBlock('カードは未登録です', '追加すると、支払いをカード別に記録できます。')}</div></section>`;
  }

  function renderCloudSettings() {
    const session = cloud?.getSession();
    if (!session?.user || !session.workspace) return '<section class="settings-card"><h2>共有</h2><p>Firebaseへ接続中です。</p></section>';
    const workspace = session.workspace;
    const owner = workspace.ownerUid === session.user.uid;
    const options = session.workspaces.map(item => `<option value="${esc(item.id)}" ${item.id === workspace.id ? 'selected' : ''}>${esc(item.name)}${item.ownerUid === session.user.uid ? '（所有）' : '（共有）'}</option>`).join('');
    const members = workspace.memberUids.map(memberUid => `<div class="sharing-member"><code title="${esc(memberUid)}">${esc(memberUid)}</code>${memberUid === workspace.ownerUid ? '<span class="badge badge-settled">所有者</span>' : owner ? `<button class="mini-button danger" data-action="remove-cloud-member" data-member-id="${esc(memberUid)}">削除</button>` : '<span class="badge">メンバー</span>'}</div>`).join('');
    const ownerTools = owner ? `<form id="workspace-name-form" class="form-stack"><label><span>共有スペース名</span><input id="workspace-name" value="${esc(workspace.name)}" maxlength="40" required></label><button class="button button-quiet" type="submit">名前を変更</button></form><form id="share-member-form" class="form-stack"><label><span>追加するメンバーID</span><input id="share-member-id" autocomplete="off" placeholder="相手のメンバーID" required></label><button class="button button-primary" type="submit">メンバーを追加</button></form>` : '';
    return `<section class="settings-card"><div class="list-card-header"><div><h2>共有</h2><span class="cloud-state">${syncStatus === 'saving' ? '保存中' : syncStatus === 'error' ? '同期エラー' : 'Firestoreに保存済み'}</span></div></div><p>同じ共有スペースのメンバーと、口座・予定・記録を共同で管理します。</p><div class="form-stack"><label><span>使用する共有スペース</span><select id="cloud-workspace-select">${options}</select></label><label><span>ログイン中</span><input value="${esc(session.user.email)}" readonly></label><label><span>あなたのメンバーID</span><div class="sharing-id"><code>${esc(session.user.uid)}</code><button class="mini-button" type="button" data-action="copy-member-id">コピー</button></div></label></div>${ownerTools}<div class="sharing-members">${members}</div><button class="button button-quiet button-full" type="button" data-action="cloud-logout">ログアウト</button></section>`;
  }

  /* ================= シフト（独立ページ） ================= */

  /** 表示中の支給月。月が替わっても自動で現在月へ戻さないため、ユーザー操作でのみ更新する。 */
  let shiftPaymentMonth = '';

  function formatMonthLabel(monthKey) {
    const [year, month] = String(monthKey || '').split('-');
    if (!year || !month) return '';
    return `${year}年${Number(month)}月`;
  }

  function currentShiftPaymentMonth() {
    if (!shiftPaymentMonth) shiftPaymentMonth = finance.paymentMonthForWorkDate(today(), state.settings.wage);
    return shiftPaymentMonth;
  }

  /** 支給月の選択肢。保存済みシフトの支給月を必ず含め、過去のデータが選べなくならないようにする。 */
  function shiftPaymentMonthOptions(selected) {
    const months = new Set();
    const base = finance.paymentMonthForWorkDate(today(), state.settings.wage);
    for (let offset = -6; offset <= 12; offset += 1) months.add(finance.shiftMonthKey(base, offset));
    state.workEntries.forEach(entry => {
      if (entry.date) months.add(finance.paymentMonthForWorkDate(entry.date, state.settings.wage));
    });
    if (selected) months.add(selected);
    return [...months].sort();
  }

  function renderShift() {
    const wage = state.settings.wage;
    const paymentMonth = currentShiftPaymentMonth();
    const salary = finance.calculateSalaryByPaymentMonth(state.workEntries, paymentMonth, wage, holidayOptions());
    const movedForward = salary.paymentDate !== salary.scheduledPaymentDate;
    const needsRate = !Number(wage.hourlyRate) && !salary.entries.some(entry => entry.rate > 0);

    const options = shiftPaymentMonthOptions(paymentMonth)
      .map(key => `<option value="${key}"${key === paymentMonth ? ' selected' : ''}>${formatMonthLabel(key)}支給</option>`)
      .join('');

    const rows = salary.entries.map(entry => `<div class="work-row">
        <div class="work-date"><strong>${formatDate(entry.date, true)}</strong><span class="badge ${entry.status === 'worked' ? 'badge-settled' : 'badge-planned'}">${entry.status === 'worked' ? '勤務済み' : '勤務予定'}</span></div>
        <div class="work-main"><strong>${formatHours(entry.hours)}</strong><small>${formatAbsoluteYen(entry.rate)}／時${entry.memo ? `・${esc(entry.memo)}` : ''}</small></div>
        <div class="work-side"><strong>${formatFlowAmount(entry.amount, 'in')}</strong><div class="list-actions"><button class="mini-button" data-action="edit-work" data-id="${entry.id}" aria-label="${formatDate(entry.date, true)}のシフトを編集">編集</button><button class="mini-button danger" data-action="delete-work" data-id="${entry.id}" aria-label="${formatDate(entry.date, true)}のシフトを削除">削除</button></div></div>
      </div>`).join('');

    return `
      <div class="page-heading"><div><span class="eyebrow">シフト</span><h1>シフト</h1></div><button class="button button-primary button-small" data-action="add-work">シフトを追加</button></div>

      <section class="card shift-control-card">
        <label class="shift-month-field"><span>対象の支給月</span><select id="shift-month">${options}</select></label>
        <div class="shift-meta">
          <div><span>対象勤務月</span><strong>${formatMonthLabel(salary.workMonth)}</strong><small>${formatDate(salary.workStartDate)}〜${formatDate(salary.workEndDate)}</small></div>
          <div><span>支給予定日</span><strong>${formatDate(salary.paymentDate, true)}</strong><small>${movedForward ? `${formatDate(salary.scheduledPaymentDate)}が休日のため前営業日` : '基本支給日どおり'}</small></div>
        </div>
      </section>

      <section class="summary-strip">
        <div class="stat-card"><span>勤務済み額</span><strong class="value-positive">${formatDisplayedAmount(salary.confirmedAmount)}</strong></div>
        <div class="stat-card"><span>予定込みの見込み額</span><strong class="value-positive">${formatDisplayedAmount(salary.totalAmount)}</strong></div>
        <div class="stat-card"><span>勤務済み時間</span><strong>${formatHours(salary.workedHours)}</strong></div>
        <div class="stat-card"><span>予定時間</span><strong>${formatHours(salary.plannedHours)}</strong></div>
      </section>

      ${needsRate ? '<section class="card notice-card"><strong>時給が未設定です</strong><p>設定の給与設定で基本時給を入力すると、シフトから見込み額を計算します。</p><button class="button button-quiet button-small" data-page="settings">給与設定へ</button></section>' : ''}

      <section class="card list-card">
        <div class="list-card-header"><div><span class="eyebrow">${formatMonthLabel(salary.workMonth)}の勤務</span><h2>シフト一覧</h2></div><small>${salary.entries.length}件</small></div>
        <div class="work-list">${rows || emptyBlock('この勤務月のシフトはありません', '「シフトを追加」から登録してください。')}</div>
      </section>`;
  }

  function renderSettings() {
    const wage = state.settings.wage;
    return `
      <div class="page-heading"><div><span class="eyebrow">設定</span><h1>設定</h1></div></div>
      <div class="settings-grid"><div class="stack">
        <section class="settings-card"><h2>メールからの取込候補</h2><p>カード利用のお知らせメールから作られた候補です。取り込むまで計算には反映されません。</p><div class="settings-inline"><strong>${pendingCandidates().length}件が未確認</strong><button class="button button-quiet button-small" data-page="imports">確認する</button></div></section>
        <section class="settings-card"><h2>計算設定</h2><p>今使える金額の計算に使う基準です。</p><form id="settings-form" class="form-stack"><label><span>最低限残す金額</span><div class="amount-input"><span>¥</span><input id="settings-defense" type="number" min="0" step="1" value="${Number(state.settings.defenseLine || 0)}"></div></label><label><span>今使える金額の判定期限</span><select id="settings-deadline"><option value="legacy14" ${state.settings.deadlineMode === 'legacy14' ? 'selected' : ''}>毎月14日締め</option></select></label><label><span>支払い能力チェックの期間</span><select id="settings-horizon"><option value="30" ${Number(state.settings.cashflowHorizonDays) === 30 ? 'selected' : ''}>30日先まで</option><option value="60" ${Number(state.settings.cashflowHorizonDays) === 60 ? 'selected' : ''}>60日先まで</option><option value="90" ${Number(state.settings.cashflowHorizonDays || 90) === 90 ? 'selected' : ''}>90日先まで</option><option value="180" ${Number(state.settings.cashflowHorizonDays) === 180 ? 'selected' : ''}>180日先まで</option></select></label><label><span>ふりかえりを始める曜日</span><select id="settings-review-day">${['日', '月', '火', '水', '木', '金', '土'].map((label, index) => `<option value="${index}" ${Number(state.settings.reviewDayOfWeek || 0) === index ? 'selected' : ''}>${label}曜日</option>`).join('')}</select><small class="field-hint">この曜日以降、ふりかえりの対象が残っている間はホームに案内を出します。</small></label><button class="button button-primary" type="submit">保存</button></form></section>
        <section class="settings-card"><h2>給与設定</h2><p>勤務月は1日から末日までの暦月、支給は翌月の給料日です。給料日が土日祝のときは前営業日へ繰り上げます。</p><form id="wage-settings-form" class="form-stack"><label><span>基本時給</span><div class="amount-input"><span>¥</span><input id="wage-hourly-rate" type="number" min="0" step="1" value="${Number(wage.hourlyRate || 0)}" required></div></label><div class="field-grid field-grid-2"><label><span>給料日</span><input id="wage-salary-payment-day" type="number" min="1" max="31" step="1" value="${Number(wage.salaryPaymentDay || 15)}" required><small class="field-hint">勤務月の翌月の日にち</small></label><label><span>給与の入金口座</span><select id="wage-deposit-account"><option value="">生活費口座（基準口座）</option>${state.accounts.map(item => `<option value="${item.id}" ${wage.depositAccountId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label></div><label class="check-row"><input id="wage-include-forecast" type="checkbox" ${wage.includeForecastInSpendable ? 'checked' : ''}><span>給与見込みを「今使える金額」に含める</span></label><p class="form-note">同じ給与を通常の「収入」にも登録すると二重計算になるため、どちらか一方を使ってください。</p><button class="button button-primary" type="submit">給与設定を保存</button></form></section>
        ${renderAliasSettings()}
        <section class="settings-card"><h2>バックアップ</h2><p>Firestoreへ自動保存します。手元にも残したい場合はJSONを書き出せます。</p><div class="field-grid field-grid-2"><button class="button button-quiet" data-action="export">JSONを書き出す</button><button class="button button-quiet" data-action="import">JSONを読み込む</button></div></section>
      </div><div class="stack">${renderCloudSettings()}<section class="settings-card"><h2>データ</h2><p>端末内にもキャッシュを残し、通信復帰後に同期します。</p><div class="formula-box"><div class="formula-row"><span>保存場所</span><strong>Cloud Firestore</strong></div><div class="formula-row"><span>最終更新</span><strong>${new Date(state.meta.updatedAt).toLocaleString('ja-JP')}</strong></div></div></section><section class="settings-card danger-zone"><h2>データをリセット</h2><p>この共有スペースの口座・予定・記録を削除して、初期設定に戻します。</p><button class="button button-danger button-full" data-action="reset">すべて削除</button></section></div></div>`;
  }

  /* ==========================================================
   * 請求総額の明細展開
   * 予定・記録のどちらの一覧でも同じ表示になる。
   * ========================================================== */

  const expandedStatements = new Set();
  let detailCache = new Map();

  /** 1回の描画のあいだだけ結果を使い回す */
  function statementDetails(statement) {
    if (!statement || statement.entryType !== 'statement' || !statement.cardId) return [];
    if (detailCache.has(statement.id)) return detailCache.get(statement.id);
    const details = finance.detailsOfStatement(statement, state.transactions, state.cards, holidayOptions());
    detailCache.set(statement.id, details);
    return details;
  }

  function toggleStatementDetails(id) {
    if (expandedStatements.has(id)) expandedStatements.delete(id);
    else expandedStatements.add(id);
    renderPage();
  }

  /**
   * 利用日時を「8/24 14:09」の形にする。時刻が無ければ日付だけ。
   * 利用日と、記録した時刻の日本時間の日付がずれている場合は、
   * どちらが正しいか判断できないので時刻は出さない。
   */
  function formatUsageMoment(transaction) {
    const usageDate = transaction.transactionDate || transaction.dueDate;
    const date = formatDate(usageDate);
    const instantDate = finance.jstDateStringOf(transaction.transactionAt);
    if (!instantDate || instantDate !== usageDate) return date;
    return `${date} ${finance.jstTimeStringOf(transaction.transactionAt)}`;
  }

  function renderStatementDetailPanel(statement, details) {
    const total = details.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const diff = Number(statement.amount || 0) - total;
    const rows = details.map(item => `<div class="detail-row"><div class="detail-when">${esc(formatUsageMoment(item))}</div><div class="detail-name">${esc(item.memo || 'カード利用')}${item.transactionAt ? '' : '<span class="detail-flag">時刻なし</span>'}</div><div class="detail-amount">${formatAbsoluteYen(Math.abs(Number(item.amount || 0)))}</div></div>`).join('');
    const note = diff === 0
      ? '請求総額と明細の合計が一致しています。'
      : diff > 0
        ? `明細に出ていない利用が ${formatAbsoluteYen(diff)} あります。`
        : `明細の合計が請求総額を ${formatAbsoluteYen(Math.abs(diff))} 上回っています。総額の入力をご確認ください。`;
    return `<div class="detail-panel"><div class="detail-panel-head"><span>メール取込の明細 ${details.length}件</span><strong>${formatAbsoluteYen(total)}</strong></div><div class="detail-rows">${rows}</div><p class="detail-note ${diff < 0 ? 'warn-note' : ''}">${esc(note)}</p></div>`;
  }

  function renderTransactionRows(transactions, compact) {
    return transactions.map(transaction => {
      const meta = kindMeta(transaction.kind);
      const isPositive = ['income', 'reimbursement'].includes(transaction.kind);
      const amountClass = transaction.kind === 'transfer' && !isExternalTransfer(transaction) ? 'value-muted' : (isPositive ? 'value-positive' : 'value-negative');
      const label = transactionLabel(transaction);
      const route = transaction.kind === 'transfer'
        ? (isExternalTransfer(transaction) ? `他人口座 ・ ${esc(transaction.destinationName || '振込先未設定')}` : `自分の口座 ・ ${esc(accountName(transaction.destinationAccountId))}`)
        : transaction.kind === 'payment' && transaction.cardId
          ? `${esc(cardName(transaction.cardId))} ・ ${esc(accountName(transaction.sourceAccountId))}`
          : `${esc(transaction.category || 'その他')} ・ ${esc(accountName(transaction.sourceAccountId))}`;
      const statusBadge = transaction.status === 'settled' ? '<span class="badge badge-settled">確定済み</span>' : transaction.status === 'cancelled' ? '<span class="badge">取消済み</span>' : '<span class="badge badge-planned">未確定</span>';
      const details = transaction.cardId && transaction.entryType === 'statement' ? statementDetails(transaction) : [];
      const expanded = details.length > 0 && expandedStatements.has(transaction.id);
      const grainBadge = transaction.cardId
        ? (transaction.entryType === 'itemized'
          ? `<span class="badge badge-muted">明細${transaction.status === 'absorbed' ? '（内訳）' : ''}</span>`
          : (details.length
            ? `<button type="button" class="badge badge-muted badge-toggle" data-action="toggle-details" data-id="${transaction.id}" aria-expanded="${expanded}">請求総額 ・ 明細${details.length}件<span class="badge-caret">${expanded ? '▲' : '▼'}</span></button>`
            : '<span class="badge badge-muted">請求総額</span>'))
        : '';
      const settleButton = transaction.status === 'planned' ? `<button class="mini-button" data-action="settle-event" data-id="${transaction.id}">確定</button>` : '';
      const detailPanel = expanded ? renderStatementDetailPanel(transaction, details) : '';
      return `<div class="list-row-wrap"><div class="list-row"><div class="list-date">${formatDate(transaction.dueDate)}</div><div class="list-main"><strong>${esc(transaction.memo || label)}</strong><small><span class="badge ${meta.badge}"><span class="kind-icon">${icon(meta.icon)}</span>${esc(label)}</span> ${route} ${statusBadge} ${grainBadge}</small></div><div class="list-side"><strong class="list-amount ${amountClass}">${formatTransactionAmount(transaction)}</strong>${!compact ? `<div class="list-actions">${settleButton}<button class="mini-button" data-action="edit-event" data-id="${transaction.id}">編集</button><button class="mini-button danger" data-action="delete-event" data-id="${transaction.id}">削除</button></div>` : ''}</div></div>${detailPanel}</div>`;
    }).join('');
  }

  function populateAccountSelect(selector, includeBlank = false) {
    const select = $(selector);
    if (!select) return;
    const options = state.accounts.map(item => `<option value="${item.id}">${esc(item.name)}（${roleLabel(item.role)}）</option>`).join('');
    select.innerHTML = `${includeBlank ? '<option value="">指定なし</option>' : ''}${options}`;
  }

  function populateCardSelect(selector) {
    const select = $(selector);
    if (!select) return;
    const options = state.cards.map(item => `<option value="${item.id}">${esc(item.name)}（${esc(accountName(item.accountId))}）</option>`).join('');
    select.innerHTML = `<option value="">口座から直接支払う</option>${options}`;
  }

  /** カード選択・利用日から引落予定日を自動計算する。自動計算後の手動変更は可能。 */
  function syncCardSourceAccount(updateDueDate = false) {
    const selectedCard = creditCard($('#event-card').value);
    if (selectedCard?.accountId) $('#event-source').value = selectedCard.accountId;

    const usageInput = $('#event-usage-date');
    if (selectedCard && !usageInput.value) usageInput.value = today();

    const dueDate = selectedCard && updateDueDate && usageInput.value
      ? finance.calculateCardPaymentDate(
        usageInput.value,
        selectedCard.closingDay,
        selectedCard.paymentDay,
        selectedCard.paymentMonthOffset ?? 1,
        holidayOptions()
      )
      : '';
    if (dueDate) $('#event-date').value = dueDate;

    $('#event-card-note').textContent = selectedCard
      ? dueDate
        ? `${formatDate(usageInput.value, true)}の利用として、引落予定日を${formatDate(dueDate, true)}に設定しました。日付は変更できます。`
        : `${selectedCard.name}の引落口座を選びました。利用日を変えると引落予定日を計算し直します。`
      : '登録済みのカードを選ぶと、引落口座を自動で選びます。';
  }

  /** 祝日の例外設定を計算エンジンへ渡す */
  function holidayOptions() {
    return { overrides: state?.settings?.holidayOverrides || {} };
  }

  /** カードを選んでいるときだけ「利用日」を表示し、残高反映日のラベルを引落予定日に切り替える */
  function updateCardDateUi() {
    const hasCard = $('#event-kind').value === 'payment' && Boolean($('#event-card').value);
    $('#event-usage-date-wrap').hidden = !hasCard;
    $('#event-entry-type-wrap').hidden = !hasCard;
    $('#event-date-label').textContent = hasCard ? '引落予定日' : '予定日';
    updateEntryTypeNote();
  }

  /** 請求総額を選んだときに、内数として外れる明細を明示する */
  function updateEntryTypeNote() {
    const note = $('#event-entry-type-note');
    if (!note) return;
    const cardId = $('#event-card').value;
    if (!cardId || $('#event-entry-type').value !== 'statement') {
      note.textContent = 'メール取込で作られた利用は「1件の利用」になります。';
      return;
    }
    const card = creditCard(cardId);
    const dueDate = $('#event-date').value;
    if (!card || !dueDate) { note.textContent = 'このカードの一定期間の請求をまとめた金額です。'; return; }
    const cycle = finance.cardBillingCycleOf({ entryType: 'statement', dueDate }, card, holidayOptions());
    const items = state.transactions.filter(item => item.cardId === cardId
      && item.entryType === 'itemized'
      && item.status === 'planned'
      && finance.cardBillingCycleOf(item, card, holidayOptions()) === cycle);
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    note.textContent = items.length
      ? `${formatMonthLabel(cycle)}分の請求としてまとめます。同じ請求分の取込明細${items.length}件（${formatAbsoluteYen(total)}）は内数として計算から外れます。`
      : `${formatMonthLabel(cycle)}分の請求としてまとめます。`;
  }

  /** カード取引の粒度。手入力は請求総額、メール取込は明細。 */
  function eventEntryTypeValue() {
    const hasCard = $('#event-kind').value === 'payment' && Boolean($('#event-card').value);
    if (!hasCard) return '';
    return $('#event-entry-type').value === 'itemized' ? 'itemized' : 'statement';
  }

  /** 確定・未確定の状態。新規追加は常に未確定。 */
  function eventStatusValue(current) {
    if (!current) return 'planned';
    if (current.status === 'cancelled') return 'cancelled';
    return $('#event-status').value === 'settled' ? 'settled' : 'planned';
  }

  /** 保存する取引の「実際に利用・発生した日」。カード以外は残高へ反映する日と同じ。 */
  function eventUsageDateValue() {
    const hasCard = $('#event-kind').value === 'payment' && Boolean($('#event-card').value);
    if (!hasCard) return $('#event-date').value;
    return $('#event-usage-date').value || $('#event-date').value;
  }

  function updateEventKindUi() {
    const kind = $('#event-kind').value;
    const isTransfer = kind === 'transfer';
    const isInternalTransfer = isTransfer && $('#event-transfer-type').value === 'internal';
    const hasDestination = ['saving', 'nisa'].includes(kind) || isInternalTransfer;
    $('#event-card-wrap').style.display = kind === 'payment' ? '' : 'none';
    updateCardDateUi();
    $('#event-transfer-type-wrap').style.display = isTransfer ? '' : 'none';
    $('#event-destination-wrap').style.display = hasDestination ? '' : 'none';
    $('#event-recipient-wrap').style.display = isTransfer && !isInternalTransfer ? '' : 'none';
    $('#event-lending-wrap').style.display = kind === 'payment' ? '' : 'none';
    $('#event-card').required = false;
    $('#event-destination').required = isInternalTransfer;
    $('#event-recipient').required = isTransfer && !isInternalTransfer;
    $('#event-source-label').textContent = ['income', 'reimbursement'].includes(kind) ? '入金先口座' : '出金元口座';
    $('#event-destination-label').textContent = isInternalTransfer ? '移動先口座' : '移動先口座（任意）';
    $('#event-form-note').textContent = kind === 'income'
      ? '予定収入は、期限までの使える額に加算します。'
      : isTransfer
        ? (isInternalTransfer ? '自分の別口座へ移動します。使える金額は変わりません。' : '他人口座への振込です。期限までの使える金額から差し引きます。')
        : ['saving', 'nisa'].includes(kind) ? '予定で保存します。確定すると残高に反映します。' : '予定で保存します。確定すると残高に反映します。';
  }

  function openEventModal(id = '', presetKind = 'payment') {
    const modal = $('#event-modal');
    const transaction = id ? state.transactions.find(item => item.id === id) : null;
    $('#event-modal-title').textContent = transaction ? '予定を編集' : '予定を追加';
    $('#event-id').value = transaction?.id || '';
    $('#event-kind').value = transaction?.kind || presetKind;
    $('#event-date').value = transaction?.dueDate || dateAdd(today(), 7);
    $('#event-usage-date').value = transaction?.transactionDate || '';
    $('#event-entry-type').value = transaction?.entryType === 'itemized' ? 'itemized' : 'statement';
    $('#event-status').value = transaction?.status === 'settled' ? 'settled' : 'planned';
    $('#event-status-wrap').hidden = !transaction;
    $('#event-amount').value = transaction?.amount ?? '';
    $('#event-lending').value = transaction?.lendingAmount ?? '';
    $('#event-memo').value = transaction?.memo || '';
    populateCardSelect('#event-card');
    $('#event-card').value = transaction?.cardId || '';
    $('#event-transfer-type').value = transaction?.transferType || 'internal';
    $('#event-recipient').value = transaction?.destinationName || '';
    $('#event-category').value = transaction?.category || '生活費';
    $('#event-exclude').checked = transaction?.affectsForecast === false;
    populateAccountSelect('#event-source');
    populateAccountSelect('#event-destination', true);
    $('#event-source').value = transaction?.sourceAccountId || primaryAccount()?.id || state.accounts[0]?.id || '';
    $('#event-destination').value = transaction?.destinationAccountId || '';
    updateEventKindUi();
    syncCardSourceAccount();
    modal.hidden = false;
    $('#event-amount').focus();
  }

  function closeModal(id) { const modal = $(`#${id}`); if (modal) modal.hidden = true; }

  function setAddMenu(open) {
    const menu = $('#add-menu');
    const button = $('#floating-add');
    if (!menu || !button) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function closeAddMenu() { setAddMenu(false); }

  function adjustAccount(accountId, delta) {
    const target = account(accountId);
    if (target) target.currentBalance = Number(target.currentBalance || 0) + Number(delta || 0);
  }

  /**
   * 「確定する」ときに満たしていなければならない条件。
   * 予定一覧の確定ボタン(settleEvent)と、確定済みで保存するとき(saveEvent)の両方から呼ぶ。
   * 問題があればユーザーに見せるメッセージを返し、問題が無ければ空文字を返す。
   */
  function validateSettlement(transaction) {
    const needsDestination = ['saving', 'nisa'].includes(transaction.kind)
      || (transaction.kind === 'transfer' && transaction.transferType === 'internal');
    if (needsDestination && !transaction.destinationAccountId) return '確定する前に移動先口座を指定してください';
    if (transaction.kind === 'transfer' && transaction.transferType === 'internal'
      && transaction.destinationAccountId === transaction.sourceAccountId) return '自分の別口座を移動先に指定してください';
    if (transaction.kind === 'transfer' && transaction.transferType === 'external'
      && !transaction.destinationName) return '確定する前に振込先の名前を入力してください';
    return '';
  }

  /**
   * 取引を確定したときの残高反映。増減の定義はエンジンの accountDeltasFor 1か所だけが持つ。
   * （「今使える金額」の集計も同じ関数を使うので、符号が食い違うことがない）
   */
  function applyEffect(transaction, sign = 1) {
    finance.accountDeltasFor(transaction)
      .forEach(({ accountId, delta }) => adjustAccount(accountId, delta * sign));
  }

  /** 確定を取り消したときの残高戻し。applyEffect と正反対の増減を当てる。 */
  function revertEffect(transaction) {
    applyEffect(transaction, -1);
  }

  /* ==========================================================
   * 請求総額と明細の吸収
   *
   * 請求総額を確定すると、同じ請求サイクルの明細はその総額に含まれている。
   * そのまま残すと明細が「未確定の予定」として復活し、二重に差し引かれてしまうため、
   * status を 'absorbed' に変えて計算対象から完全に外す。
   * 履歴としては残るので、総額の行をタップすれば内訳として閲覧できる。
   * 未確定に戻したときは元の未確定へ戻す。
   * ========================================================== */

  /**
   * 請求総額に紐づく明細を吸収済みにする。吸収した件数を返す。
   * target には対象の state を渡す（移行処理では、読み込み中の state を渡す）。
   */
  function absorbStatementDetails(statement, target = state) {
    if (!statement || statement.entryType !== 'statement' || !statement.cardId) return 0;
    const options = { overrides: target?.settings?.holidayOverrides || {} };
    const details = finance.detailsOfStatement(statement, target.transactions, target.cards || [], options);
    let absorbed = 0;
    details.forEach(detail => {
      if (detail.status !== 'planned') return;
      detail.status = 'absorbed';
      detail.absorbedBy = statement.id;
      detail.updatedAt = nowIso();
      absorbed += 1;
    });
    return absorbed;
  }

  /** 吸収済みの明細を未確定へ戻す。戻した件数を返す。 */
  function releaseStatementDetails(statementId) {
    let released = 0;
    state.transactions.forEach(item => {
      if (item.absorbedBy !== statementId) return;
      if (item.status === 'absorbed') item.status = 'planned';
      item.absorbedBy = '';
      item.updatedAt = nowIso();
      released += 1;
    });
    return released;
  }

  function saveEvent(event) {
    event.preventDefault();
    if (!state.accounts.length) { closeModal('event-modal'); showToast('先に口座を追加してください'); return; }
    const id = $('#event-id').value;
    const current = id ? state.transactions.find(item => item.id === id) : null;
    const next = createTransaction({
      id: id || '', kind: $('#event-kind').value, amount: Number($('#event-amount').value || 0), dueDate: $('#event-date').value,
      transactionDate: eventUsageDateValue(), transactionAt: current?.transactionAt || '', absorbedBy: current?.absorbedBy || '', dateEstimated: false,
      entryType: eventEntryTypeValue(), origin: current?.origin || '',
      status: eventStatusValue(current), sourceAccountId: $('#event-source').value, destinationAccountId: $('#event-destination').value || '', transferType: $('#event-transfer-type').value || 'internal', destinationName: $('#event-recipient').value.trim(), cardId: $('#event-kind').value === 'payment' ? ($('#event-card').value || '') : '', category: $('#event-category').value, memo: $('#event-memo').value.trim(), lendingAmount: Math.min(Number($('#event-lending').value || 0), Number($('#event-amount').value || 0)), affectsForecast: !$('#event-exclude').checked, recurringPlanId: current?.recurringPlanId || '', settledAt: current?.settledAt || '', createdAt: current?.createdAt || '', updatedAt: nowIso()
    });
    if (!next.amount || !next.dueDate || !next.sourceAccountId) { showToast('日付・金額・口座を入力してください'); return; }
    if (next.kind === 'transfer' && next.transferType === 'internal' && (!next.destinationAccountId || next.destinationAccountId === next.sourceAccountId)) { showToast('自分の別口座を移動先に指定してください'); return; }
    if (next.kind === 'transfer' && next.transferType === 'external' && !next.destinationName) { showToast('振込先の名前を入力してください'); return; }
    if (next.status === 'settled') {
      const settleError = validateSettlement(next);
      if (settleError) { showToast(settleError); return; }
    }
    const wasSettled = current?.status === 'settled';
    const willSettle = next.status === 'settled';
    let absorbedCount = 0;
    if (wasSettled && willSettle) {
      revertEffect(current); applyEffect(next);
    } else if (!wasSettled && willSettle) {
      applyEffect(next); next.settledAt = next.settledAt || today();
    } else if (wasSettled && !willSettle) {
      if (!window.confirm('未確定に戻します。確定したときに反映した残高も元に戻します。よろしいですか？')) return;
      revertEffect(current); next.settledAt = '';
    }
    if (current) state.transactions = state.transactions.map(item => item.id === id ? next : item);
    else state.transactions.push(next);
    // 請求総額の確定・確定解除に合わせて、内数の明細を吸収／解放する
    if (!wasSettled && willSettle) absorbedCount = absorbStatementDetails(next);
    if (wasSettled && !willSettle) releaseStatementDetails(next.id);
    persist(); closeModal('event-modal'); renderPage();
    showToast(absorbedCount
      ? `確定しました。メール取込の明細${absorbedCount}件を内訳にまとめました`
      : (current ? '予定を更新しました' : '予定を追加しました'));
  }

  function settleEvent(id) {
    const transaction = state.transactions.find(item => item.id === id);
    if (!transaction || transaction.status !== 'planned') return;
    const settleError = validateSettlement(transaction);
    if (settleError) { showToast(settleError); openEventModal(id); return; }
    transaction.status = 'settled'; transaction.settledAt = today(); transaction.updatedAt = nowIso(); applyEffect(transaction);
    const absorbed = absorbStatementDetails(transaction);
    persist(); renderPage();
    showToast(absorbed ? `確定しました。メール取込の明細${absorbed}件を内訳にまとめました` : '確定しました。残高を更新しました');
  }

  function deleteEvent(id) {
    const transaction = state.transactions.find(item => item.id === id);
    if (!transaction) return;
    if (!window.confirm(`${transaction.memo || kindMeta(transaction.kind).label}を削除しますか？${transaction.status === 'settled' ? '\n確定済みのため、残高も元に戻します。' : ''}`)) return;
    if (transaction.status === 'settled') revertEffect(transaction);
    // 総額を消すと内訳の行き場が無くなるため、吸収していた明細は未確定へ戻す
    releaseStatementDetails(id);
    state.transactions = state.transactions.filter(item => item.id !== id);
    persist(); renderPage(); showToast('削除しました');
  }

  function openAccountModal(id = '') {
    const current = id ? account(id) : null;
    $('#account-modal-title').textContent = current ? '口座を編集' : '口座を追加';
    $('#account-id').value = current?.id || '';
    $('#account-name').value = current?.name || '';
    $('#account-role').value = current?.role || 'spending';
    $('#account-balance').value = current?.currentBalance ?? 0;
    $('#account-spendable').checked = current ? current.includeInSpendable : true;
    $('#account-modal').hidden = false;
    $('#account-name').focus();
  }

  function saveAccount(event) {
    event.preventDefault();
    const id = $('#account-id').value;
    const role = $('#account-role').value;
    const current = id ? account(id) : null;
    const next = { id: id || uid('account'), name: $('#account-name').value.trim(), role, currentBalance: Number($('#account-balance').value || 0), includeInSpendable: $('#account-spendable').checked && !['savings', 'investment'].includes(role), reserveAmount: current?.reserveAmount || 0, isPrimary: role === 'primary' };
    if (!next.name) { showToast('口座名を入力してください'); return; }
    if (next.isPrimary) state.accounts.forEach(item => { item.isPrimary = false; });
    if (current) state.accounts = state.accounts.map(item => item.id === id ? next : item);
    else state.accounts.push(next);
    if (!state.accounts.some(item => item.isPrimary)) state.accounts[0].isPrimary = true;
    persist(); closeModal('account-modal'); renderPage(); showToast(current ? '口座を更新しました' : '口座を追加しました');
  }

  function deleteAccount(id) {
    const target = account(id);
    if (!target) return;
    if (target.isPrimary) { showToast('基準口座は削除できません'); return; }
    if (state.transactions.some(item => item.sourceAccountId === id || item.destinationAccountId === id) || state.cards.some(item => item.accountId === id)) { showToast('取引またはカードで使用中の口座は削除できません'); return; }
    if (!window.confirm(`${target.name}を削除しますか？`)) return;
    state.accounts = state.accounts.filter(item => item.id !== id); persist(); renderPage(); showToast('口座を削除しました');
  }

  function openCardModal(id = '') {
    const current = id ? creditCard(id) : null;
    $('#card-modal-title').textContent = current ? 'カードを編集' : 'カードを追加';
    $('#card-id').value = current?.id || '';
    $('#card-name').value = current?.name || '';
    populateAccountSelect('#card-account');
    $('#card-account').value = current?.accountId || primaryAccount()?.id || state.accounts[0]?.id || '';
    $('#card-closing-day').value = current?.closingDay || 0;
    $('#card-payment-day').value = current?.paymentDay || 27;
    $('#card-payment-month-offset').value = String(current?.paymentMonthOffset ?? 1);
    $('#card-modal').hidden = false;
    $('#card-name').focus();
  }

  function saveCard(event) {
    event.preventDefault();
    if (!state.accounts.length) { closeModal('card-modal'); showToast('先に引落口座を追加してください'); return; }
    const id = $('#card-id').value;
    const current = id ? creditCard(id) : null;
    const next = {
      id: id || uid('card'),
      name: $('#card-name').value.trim(),
      accountId: $('#card-account').value,
      closingDay: Number($('#card-closing-day').value || 0),
      paymentDay: Number($('#card-payment-day').value || 0),
      paymentMonthOffset: Number($('#card-payment-month-offset').value ?? 1),
      createdAt: current?.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    if (!next.name || !next.accountId) { showToast('カード名と引落口座を入力してください'); return; }
    if (next.closingDay < 0 || next.closingDay > 31 || next.paymentDay < 0 || next.paymentDay > 31) { showToast('締め日・支払日は0〜31で入力してください。0は月末を意味します'); return; }
    if (current) state.cards = state.cards.map(item => item.id === id ? next : item);
    else state.cards.push(next);
    persist(); closeModal('card-modal'); renderPage(); showToast(current ? 'カードを更新しました' : 'カードを追加しました');
  }

  function deleteCard(id) {
    const target = creditCard(id);
    if (!target) return;
    if (state.transactions.some(item => item.cardId === id)) { showToast('支払いで使用中のカードは削除できません'); return; }
    if (!window.confirm(`${target.name}を削除しますか？`)) return;
    state.cards = state.cards.filter(item => item.id !== id);
    persist(); renderPage(); showToast('カードを削除しました');
  }

  function openWorkModal(id = '') {
    const current = id ? state.workEntries.find(item => item.id === id) : null;
    $('#work-modal-title').textContent = current ? '勤務を編集' : '勤務を記録';
    $('#work-id').value = current?.id || '';
    $('#work-date').value = current?.date || today();
    $('#work-status').value = current?.status || 'worked';
    $('#work-hours').value = current?.hours ?? '';
    $('#work-rate').value = current?.hourlyRateOverride || '';
    $('#work-memo').value = current?.memo || '';
    $('#work-modal').hidden = false;
    $('#work-hours').focus();
  }

  function saveWork(event) {
    event.preventDefault();
    const id = $('#work-id').value;
    const current = id ? state.workEntries.find(item => item.id === id) : null;
    const next = {
      id: id || uid('work'),
      date: $('#work-date').value,
      status: $('#work-status').value === 'worked' ? 'worked' : 'planned',
      hours: Number($('#work-hours').value || 0),
      hourlyRateOverride: Number($('#work-rate').value || 0),
      memo: $('#work-memo').value.trim(),
      createdAt: current?.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    if (!next.date || next.hours <= 0 || next.hours > 24) { showToast('勤務日と勤務時間を確認してください'); return; }
    if (current) state.workEntries = state.workEntries.map(item => item.id === id ? next : item);
    else state.workEntries.push(next);
    persist(); closeModal('work-modal'); renderPage(); showToast(current ? '勤務を更新しました' : '勤務を記録しました');
  }

  function deleteWork(id) {
    const current = state.workEntries.find(item => item.id === id);
    if (!current) return;
    if (!window.confirm(`${formatDate(current.date, true)}の勤務を削除しますか？`)) return;
    state.workEntries = state.workEntries.filter(item => item.id !== id);
    persist(); renderPage(); showToast('勤務を削除しました');
  }

  function saveWageSettings(event) {
    event.preventDefault();
    // closingDay / paymentDay / paymentMonthOffset は旧設定との互換のため保持するだけで、給与試算には使わない
    const next = {
      ...state.settings.wage,
      hourlyRate: Number($('#wage-hourly-rate').value || 0),
      salaryPaymentDay: Number($('#wage-salary-payment-day').value || 15),
      salaryMonthOffset: 1,
      periodMode: 'calendarMonth',
      depositAccountId: $('#wage-deposit-account').value || '',
      includeForecastInSpendable: $('#wage-include-forecast').checked
    };
    if (next.hourlyRate < 0 || next.salaryPaymentDay < 1 || next.salaryPaymentDay > 31) { showToast('時給と給料日を確認してください'); return; }
    state.settings.wage = next;
    persist(); renderPage(); showToast('給与設定を保存しました');
  }


  function exportData() {
    const payload = { ...state, exportedAt: nowIso() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `yoryoku-backup-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('バックアップを書き出しました');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeState(JSON.parse(reader.result));
        if (!imported.accounts.length && !imported.transactions.length) throw new Error('データがありません');
        if (!window.confirm('現在のデータを読み込んだ内容で置き換えますか？')) return;
        imported.meta.onboarded = true; imported.meta.demo = false; state = imported; persist(); showApp(); showToast('バックアップを読み込みました');
      } catch (error) { showToast(`読み込みに失敗しました: ${error.message}`); }
    };
    reader.readAsText(file, 'utf-8');
  }

  function resetData() {
    if (!window.confirm('すべての口座・予定・記録・勤務を削除しますか？')) return;
    state = emptyState(); state.mode = 'cloud'; persist(); renderOnboarding(); showToast('データをリセットしました');
  }

  async function switchCloudWorkspace(workspaceId) {
    try {
      await cloud.selectWorkspace(workspaceId);
      const session = cloud.getSession();
      showToast(`${session.workspace?.name || '共有スペース'}を開きました`);
    } catch (error) { showToast(authErrorMessage(error)); }
  }

  async function addCloudMember(event) {
    event.preventDefault();
    try {
      await cloud.addMember($('#share-member-id').value);
      $('#share-member-id').value = '';
      renderPage();
      showToast('メンバーを追加しました');
    } catch (error) { showToast(authErrorMessage(error)); }
  }

  async function renameCloudWorkspace(event) {
    event.preventDefault();
    try {
      await cloud.renameWorkspace($('#workspace-name').value);
      await cloud.refreshWorkspaces();
      renderPage();
      showToast('共有スペース名を変更しました');
    } catch (error) { showToast(authErrorMessage(error)); }
  }

  async function removeCloudMember(memberUid) {
    if (!window.confirm('このメンバーを共有から外しますか？')) return;
    try {
      await cloud.removeMember(memberUid);
      renderPage();
      showToast('メンバーを削除しました');
    } catch (error) { showToast(authErrorMessage(error)); }
  }

  async function copyMemberId() {
    const memberId = cloud?.getSession()?.user?.uid || '';
    try { await navigator.clipboard.writeText(memberId); showToast('メンバーIDをコピーしました'); }
    catch (_) { showToast('メンバーIDを長押ししてコピーしてください'); }
  }

  async function logoutCloud() {
    if (!window.confirm('ログアウトしますか？')) return;
    await cloud.signOut();
    showAuth();
  }

  function showToast(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function handleClick(event) {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { currentPage = pageButton.dataset.page; $('#sidebar').classList.remove('open'); renderPage(); return; }
    const planButton = event.target.closest('[data-plan-filter]');
    if (planButton) { planFilter = planButton.dataset.planFilter; renderPage(); return; }
    const recordButton = event.target.closest('[data-record-filter]');
    if (recordButton) { recordFilter = recordButton.dataset.recordFilter; renderPage(); return; }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const name = action.dataset.action;
    if (name === 'record-tab') { recordTab = action.dataset.tab === 'receipts' ? 'receipts' : 'transactions'; renderPage(); return; }
    if (name === 'range-mode') { setRecordRangeMode(action.dataset.mode); return; }
    if (name === 'range-month') { stepRecordMonth(Number(action.dataset.step || 0)); return; }
    if (name === 'record-basis') { recordBasis = action.dataset.basis === 'gross' ? 'gross' : 'real'; renderPage(); return; }
    if (name === 'filter-category') { recordCategory = recordCategory === action.dataset.category ? '' : (action.dataset.category || ''); renderPage(); return; }
    if (name === 'google-login') { submitAuth(); return; }
    if (name === 'copy-member-id') { copyMemberId(); return; }
    if (name === 'cloud-logout') { logoutCloud(); return; }
    if (name === 'remove-cloud-member') { removeCloudMember(action.dataset.memberId); return; }
    if (name === 'toggle-add-menu') setAddMenu($('#add-menu').hidden);
    if (name === 'close-add-menu') closeAddMenu();
    if (name === 'add-event') { closeAddMenu(); openEventModal('', action.dataset.kind || 'payment'); }
    if (name === 'toggle-details') { toggleStatementDetails(action.dataset.id); return; }
    if (name === 'edit-event') openEventModal(action.dataset.id);
    if (name === 'delete-event') deleteEvent(action.dataset.id);
    if (name === 'settle-event') settleEvent(action.dataset.id);
    if (name === 'add-account') { closeAddMenu(); openAccountModal(); }
    if (name === 'edit-account') openAccountModal(action.dataset.id);
    if (name === 'delete-account') deleteAccount(action.dataset.id);
    if (name === 'add-card') { closeAddMenu(); openCardModal(); }
    if (name === 'edit-card') openCardModal(action.dataset.id);
    if (name === 'delete-card') deleteCard(action.dataset.id);
    if (name === 'open-future') { openFutureModal(); return; }
    if (name === 'future-preset') { applyFuturePreset(action.dataset.preset); return; }
    if (name === 'add-receipt') { closeAddMenu(); openReceiptModal(); return; }
    if (name === 'edit-receipt') { openReceiptModal(action.dataset.id); return; }
    if (name === 'delete-receipt') { deleteReceiptRow(action.dataset.id); return; }
    if (name === 'toggle-receipt') { openReceiptId = openReceiptId === action.dataset.id ? '' : action.dataset.id; renderPage(); return; }
    if (name === 'add-receipt-line') { addReceiptLine(); return; }
    if (name === 'remove-receipt-line') { removeReceiptLine(action.dataset.index); return; }
    if (name === 'merge-item') { openMergeModal(action.dataset.key, action.dataset.name); return; }
    if (name === 'merge-target') { mergeItemInto(action.dataset.name); return; }
    if (name === 'unmerge-item') { unmergeItem(action.dataset.key); return; }
    if (name === 'open-review') { openReviewModal(); return; }
    if (name === 'review-answer') { answerReview(action.dataset.answer); return; }
    if (name === 'review-reason') { answerReviewReason(action.dataset.reason); return; }
    if (name === 'review-cancel-reason') { reviewReasonFor = ''; renderReviewCard(); return; }
    if (name === 'accept-candidate') { acceptCandidate(action.dataset.id); return; }
    if (name === 'ignore-candidate') { ignoreCandidate(action.dataset.id); return; }
    if (name === 'delete-candidate') { deleteCandidate(action.dataset.id); return; }
    if (name === 'add-work') { closeAddMenu(); openWorkModal(); }
    if (name === 'edit-work') openWorkModal(action.dataset.id);
    if (name === 'delete-work') deleteWork(action.dataset.id);
    if (name === 'reset-what-if') updateWhatIf(0);
    if (name === 'export') exportData();
    if (name === 'import') $('#import-file').click();
    if (name === 'reset') resetData();
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const close = event.target.closest('[data-close-modal]'); if (close) closeModal(close.dataset.closeModal);
      if (event.target.classList.contains('modal-backdrop')) event.target.hidden = true;
      if (event.target.classList.contains('add-menu-backdrop')) closeAddMenu();
      handleClick(event);
    });
    $('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#event-kind').addEventListener('change', updateEventKindUi);
    $('#event-transfer-type').addEventListener('change', updateEventKindUi);
    $('#event-card').addEventListener('change', () => { updateCardDateUi(); syncCardSourceAccount(true); });
    $('#event-usage-date').addEventListener('change', () => syncCardSourceAccount(true));
    $('#event-entry-type').addEventListener('change', updateEntryTypeNote);
    $('#event-date').addEventListener('change', updateEntryTypeNote);
    $('#event-form').addEventListener('submit', saveEvent);
    $('#account-form').addEventListener('submit', saveAccount);
    $('#card-form').addEventListener('submit', saveCard);
    $('#work-form').addEventListener('submit', saveWork);
    document.addEventListener('submit', event => {
      if (event.target.id === 'receipt-form') { saveReceiptForm(event); return; }
      if (event.target.id === 'share-member-form') { addCloudMember(event); return; }
      if (event.target.id === 'workspace-name-form') { renameCloudWorkspace(event); return; }
      if (event.target.id === 'wage-settings-form') { saveWageSettings(event); return; }
      if (event.target.id !== 'settings-form') return;
      event.preventDefault(); state.settings.defenseLine = Number($('#settings-defense').value || 0); state.settings.deadlineMode = $('#settings-deadline').value; state.settings.cashflowHorizonDays = Number($('#settings-horizon').value || 90); state.settings.reviewDayOfWeek = Math.min(Math.max(Number($('#settings-review-day').value || 0), 0), 6); persist(); renderPage(); showToast('設定を保存しました');
    });
    $('#import-file').addEventListener('change', event => importData(event.target.files[0]));
    document.addEventListener('change', event => {
      const outcomeSelect = event.target.closest?.('[data-line-outcome]');
      if (outcomeSelect) { setReceiptOutcome(outcomeSelect.dataset.id, outcomeSelect.value); return; }
      const lineField = event.target.closest?.('[data-line-field]');
      if (lineField) { onReceiptLineInput(lineField); return; }
      if (event.target.id === 'receipt-total') { updateReceiptLineSum(); return; }
      if (event.target.id === 'cloud-workspace-select') { switchCloudWorkspace(event.target.value); return; }
      if (event.target.id === 'shift-month') { shiftPaymentMonth = event.target.value; renderPage(); return; }
      if (event.target.id === 'record-start') { recordStart = event.target.value; renderPage(); return; }
      if (event.target.id === 'record-end') { recordEnd = event.target.value; renderPage(); return; }
      if (['future-start', 'future-end'].includes(event.target.id)) renderFutureResult();
    });
    document.addEventListener('input', event => {
      const lineInput = event.target.closest?.('[data-line-field]');
      if (lineInput) { onReceiptLineInput(lineInput); return; }
      if (event.target.id === 'receipt-total') { updateReceiptLineSum(); return; }
      if (['what-if-amount', 'what-if-slider'].includes(event.target.id)) { updateWhatIf(event.target.value); return; }
      if (event.target.id === 'record-search') { searchQuery = event.target.value; const caret = event.target.selectionStart; renderPage(); const next = $('#record-search'); if (next) { next.focus(); next.setSelectionRange(caret, caret); } }
    });
  }

  async function run() {
    state = loadState();
    if (new URLSearchParams(location.search).get('demo') === '1') { state = seedDemoState(); persist(); }
    bindEvents();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js').catch(() => {});
    try {
      cloud = await window.firebaseSyncReady;
      const user = await cloud.waitForAuth();
      if (user) await startCloudSession();
      else showAuth();
    } catch (error) {
      showAuth(`Firebaseに接続できません: ${authErrorMessage(error)}`);
    }
    window.__YORYOKU__ = { getState: () => state, getCloudSession: () => cloud?.getSession() || null, getNextDeadline, pendingExp, buildEngineInput, spendableAmount, cashflowCheck, today, createTransaction, applyEffect, revertEffect, validateSettlement, setPage: page => { currentPage = page; renderPage(); }, setShiftMonth: month => { shiftPaymentMonth = month; renderPage(); }, setImportCandidates: handleImportCandidates, acceptCandidate, stripCandidate, setReceipts: handleReceipts, setReceiptItems: handleReceiptItems, setItemAliases: handleItemAliases, wasteRanking, learnItemAliases, setRecordTab: tab => { recordTab = tab === 'receipts' ? 'receipts' : 'transactions'; renderPage(); }, dueReviewItems, reviewWindowOpen, receiptsAvailable, openReceiptModal, openReviewModal, answerReview, answerReviewReason, saveReceiptForm, normalizeState, emptyState, nextCardPaymentDate: finance.nextCardPaymentDate, simulateSpending: finance.simulateSpending, aggregateCardBills: finance.aggregateCardBills, calculateWageForecast: finance.calculateWageForecast, seedDemo: () => { state = seedDemoState(); persist(); showApp(); } };
  }

  run();
})();
