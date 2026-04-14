const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const state = {
  token: null,
  me: null,
  currentView: "home",
  profile: null,
  remainTimer: null,
  invite: {
    enabled: false,
    level: "b",
    cost: 1000,
    ratioDays: 30,
  },
  publicOpen: {
    enabled: false,
    days: 30,
    total: 0,
    used: 0,
    left: 0,
  },
  renew: {
    mode: "code",
    activeTab: null,
    codeEnabled: true,
    pointsEnabled: false,
    pointsCost: 300,
    pointsDays: 30,
    checkExEnabled: false,
    lowActivityEnabled: false,
    activityCheckDays: 30,
  },
  turnstile: {
    enabled: false,
    siteKey: null,
    widgetId: null,
    token: null,
    requested: false,
    verifying: false,
    redeemWidgetId: null,
    redeemToken: null,
    redeemRequested: false,
    redeemVerifying: false,
  },
};

const VIEW_GROUPS = {
  home: ["user-status"],
  "admin-settings": ["admin-settings"],
};

const VIEW_ALIASES = {
  "user-status": "home",
  "stats-panel": "home",
};

function syncTurnstileLayoutMode() {
  const noTurnstile = !state.turnstile.enabled;
  document.body.classList.toggle("no-turnstile", noTurnstile);
}

function showToast(message, variant = "info", title = "") {
  const root = document.getElementById("toast-root");
  if (!root || !message) return;
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  const icon = variant === "success" ? "✓" : variant === "error" ? "!" : "i";
  const resolvedTitle = title || (variant === "success" ? "操作成功" : variant === "error" ? "操作失败" : "提示");
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(resolvedTitle)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;
  root.appendChild(toast);
  const remove = () => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 180);
  };
  setTimeout(remove, 2600);
}

function showResultModal(message, variant = "info", title = "") {
  const modal = document.getElementById("result-modal");
  const titleEl = document.getElementById("result-modal-title");
  const messageEl = document.getElementById("result-modal-message");
  const iconEl = document.getElementById("result-modal-icon");
  if (!modal || !titleEl || !messageEl || !iconEl) return;
  const icon = variant === "success" ? "✓" : variant === "error" ? "!" : "i";
  const resolvedTitle = title || (variant === "success" ? "操作成功" : variant === "error" ? "操作失败" : "操作提示");
  modal.classList.remove("hidden", "success", "error", "info");
  modal.classList.add(variant);
  titleEl.textContent = resolvedTitle;
  messageEl.textContent = message;
  iconEl.textContent = icon;
  modal.setAttribute("aria-hidden", "false");
}

function hideResultModal() {
  const modal = document.getElementById("result-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function getMoneyLabel(profile = state.profile) {
  const label = profile?.money_label;
  if (typeof label !== "string") return "积分";
  const trimmed = label.trim();
  return trimmed || "积分";
}

function setMoneyLabelText(profile = state.profile) {
  const labelEl =
    document.getElementById("checkin-balance-label") ||
    document.querySelector(".checkin-points-label");
  if (!labelEl) return;
  labelEl.textContent = `当前${getMoneyLabel(profile)}`;
}

function getLineByLevel(profile = state.profile) {
  const normalLine = String(profile?.emby_line || "").trim();
  const whitelistLine = String(profile?.emby_whitelist_line || "").trim();
  if (profile?.lv === "a") {
    return whitelistLine || normalLine || "白名单专线";
  }
  return normalLine || "普通线路";
}

const SERVICE_LINE_URL_PATTERN = /(https?:\/\/\S+|[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/\S*)?)/i;

function findServiceLineUrl(text) {
  const match = String(text || "").trim().match(SERVICE_LINE_URL_PATTERN);
  return match ? match[0].trim() : "";
}

function cleanServiceLineName(text) {
  return String(text || "")
    .replace(/^[\s:：|,，;；、]+/, "")
    .replace(/[\s:：|,，;；、]+$/g, "")
    .trim();
}

function parseNamedLine(rawLine, fallbackName, titleOverride = "") {
  const text = String(rawLine || "").trim();
  if (!text) return null;
  const url = findServiceLineUrl(text);
  if (!url) {
    return {
      name: cleanServiceLineName(titleOverride) || fallbackName,
      url: text,
    };
  }
  const inlineName = cleanServiceLineName(text.replace(url, ""));
  return {
    name: cleanServiceLineName(titleOverride) || inlineName || fallbackName,
    url,
  };
}

function parseLineList(raw, baseName) {
  const lines = String(raw || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = [];
  const pendingTitles = [];

  lines.forEach((line) => {
    const url = findServiceLineUrl(line);
    if (!url) {
      pendingTitles.push(line);
      return;
    }

    const fallbackName = lines.length > 1 ? `${baseName} ${items.length + 1}` : baseName;
    const titleText = pendingTitles.length ? pendingTitles.join(" / ") : "";
    const parsed = parseNamedLine(line, fallbackName, titleText);
    if (parsed) items.push(parsed);
    pendingTitles.length = 0;
  });

  if (pendingTitles.length) {
    pendingTitles.forEach((line, index) => {
      const fallbackName = `${baseName} ${items.length + index + 1}`;
      const parsed = parseNamedLine(line, fallbackName);
      if (parsed) items.push(parsed);
    });
  }

  return items;
}

function getServiceLineItems(profile = state.profile) {
  const normalLine = String(profile?.emby_line || "").trim();
  const whitelistLine = String(profile?.emby_whitelist_line || "").trim();
  const normalItems = parseLineList(normalLine, "普通线路");
  const whitelistItems = parseLineList(whitelistLine, "白名单线路");
  if (profile?.lv === "a") {
    return [...whitelistItems, ...normalItems];
  }
  return normalItems;
}

function setNotice(text, isError = false) {
  void text;
  void isError;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyText(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (err) {
    console.warn("clipboard write failed:", err);
  }
  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.focus();
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    return ok;
  } catch (err) {
    console.warn("copy fallback failed:", err);
    return false;
  }
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function objectToLines(obj) {
  if (!obj || typeof obj !== "object") return [String(obj ?? "")];
  return Object.entries(obj).map(([key, value]) => `${key}：${value ?? "-"}`);
}

function renderResult(targetId, payload, emptyText = "等待操作", variant = "info") {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.classList.remove("success", "error", "info");
  if (!payload) {
    el.classList.add("empty");
    el.textContent = emptyText;
    return;
  }
  el.classList.remove("empty");
  el.classList.add(variant);
  const lines = Array.isArray(payload)
    ? payload
    : typeof payload === "object"
      ? objectToLines(payload)
      : [String(payload)];
  el.textContent = lines.join("\n");
}

function renderResultHtml(targetId, html, emptyText = "等待操作", variant = "info") {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.classList.remove("success", "error", "info");
  if (!html) {
    el.classList.add("empty");
    el.textContent = emptyText;
    return;
  }
  el.classList.remove("empty");
  el.classList.add(variant);
  el.innerHTML = html;
}

function extractMediaStats(text = "") {
  const result = {
    movieCount: 0,
    seriesCount: 0,
    totalEpisodes: 0,
  };
  const movieMatch = text.match(/电影(?:数量|数)?\s*[：:]\s*(\d+)/);
  const seriesMatch = text.match(/(?:电视剧|剧集)(?:数量|数)?\s*[：:]\s*(\d+)/);
  const episodesMatch = text.match(/总集数\s*[：:]\s*(\d+)/);
  if (movieMatch) result.movieCount = Number(movieMatch[1]);
  if (seriesMatch) result.seriesCount = Number(seriesMatch[1]);
  if (episodesMatch) result.totalEpisodes = Number(episodesMatch[1]);
  return result;
}

const STAT_CARD_META = {
  movies: {
    kicker: "影片馆藏",
    unit: "部",
    icon: `
      <svg viewBox="0 0 24 24" focusable="false">
        <rect x="3.5" y="5.5" width="17" height="13" rx="3"></rect>
        <path d="M7.5 3.8v3.4M12 3.8v3.4M16.5 3.8v3.4M7.5 16.8v3.4M12 16.8v3.4M16.5 16.8v3.4"></path>
      </svg>
    `,
  },
  series: {
    kicker: "剧集内容",
    unit: "部",
    icon: `
      <svg viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="4.5" width="12.5" height="9.5" rx="2.4"></rect>
        <rect x="7.5" y="10" width="12.5" height="9.5" rx="2.4"></rect>
        <path d="M10.2 13.5h6.8M10.2 16.2h4.4"></path>
      </svg>
    `,
  },
  episodes: {
    kicker: "内容广度",
    unit: "集",
    icon: `
      <svg viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="3"></rect>
        <path d="M8 9.2h8M8 12h8M8 14.8h5.2"></path>
      </svg>
    `,
  },
  users: {
    kicker: "账户规模",
    unit: "人",
    icon: `
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M9 11a3.1 3.1 0 1 0 0-6.2A3.1 3.1 0 0 0 9 11ZM16.5 10.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"></path>
        <path d="M4.6 18.6c.8-2.5 2.8-3.8 6-3.8s5.2 1.3 6 3.8M14.3 18.4c.5-1.8 1.9-2.8 4.2-2.8"></path>
      </svg>
    `,
  },
};

function formatStatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("zh-CN");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(String(value))) {
    return Number(value).toLocaleString("zh-CN");
  }
  return String(value);
}

function renderStatCard(type, label, value) {
  const meta = STAT_CARD_META[type] || {};
  const formattedValue = formatStatValue(value);
  const classNames = ["home-mini-card", "stat-card", `stat-card-${type}`];
  if (formattedValue === "-") {
    classNames.push("is-empty");
  }

  return `
    <article class="${classNames.join(" ")}">
      <div class="stat-card-head">
        <div class="stat-card-title">${escapeHtml(label)}</div>
        <span class="stat-card-icon" aria-hidden="true">${meta.icon || ""}</span>
      </div>
      <div class="stat-card-main">
        <div class="value">${escapeHtml(formattedValue)}</div>
        ${meta.unit && formattedValue !== "-" ? `<div class="stat-card-unit">${escapeHtml(meta.unit)}</div>` : ""}
      </div>
    </article>
  `;
}

function renderInfoCard(label, value) {
  return `<div class="info-card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function renderKeyValueResultCard(title, fields) {
  const items = Object.entries(fields || {})
    .map(([label, value]) => `
      <div class="result-card-field">
        <span class="result-card-label">${escapeHtml(label)}</span>
        <span class="result-card-value">${escapeHtml(value ?? "-")}</span>
      </div>
    `)
    .join("");
  return `
    <div class="result-card-list">
      <div class="result-card-item">
        <div class="result-card-title">${escapeHtml(title)}</div>
        <div class="result-card-grid">${items}</div>
      </div>
    </div>
  `;
}

function renderSearchResultCards(items = []) {
  if (!items.length) {
    return `<div class="result-card-list"><div class="result-card-item"><div class="result-card-title">未找到匹配用户</div></div></div>`;
  }
  const cards = items.map((item) => `
    <div class="result-card-item">
      <div class="result-card-title">${escapeHtml(item.name || "未命名用户")}</div>
      <div class="result-card-grid">
        <div class="result-card-field"><span class="result-card-label">TG</span><span class="result-card-value">${escapeHtml(item.tg)}</span></div>
        <div class="result-card-field"><span class="result-card-label">等级</span><span class="result-card-value">${escapeHtml(item.lv || "-")}</span></div>
        <div class="result-card-field"><span class="result-card-label">EmbyID</span><span class="result-card-value">${escapeHtml(item.embyid || "-")}</span></div>
        <div class="result-card-field"><span class="result-card-label">到期时间</span><span class="result-card-value">${escapeHtml(toDisplayTime(item.expires_at))}</span></div>
      </div>
    </div>
  `).join("");
  return `<div class="result-card-list">${cards}</div>`;
}

function toDisplayTime(value) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function clearRemainCountdownTimer() {
  if (state.remainTimer !== null) {
    window.clearInterval(state.remainTimer);
    state.remainTimer = null;
  }
}

function getRemainDisplayState(hasAccount, isWhitelist, isDisabled, expiresAt) {
  if (!hasAccount) return { countdown: false, text: "请先注册" };
  if (isWhitelist) return { countdown: false, text: "白名单长期可用" };
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return { countdown: false, text: "未设置" };
  if (isDisabled) return { countdown: false, text: "已封禁" };
  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return { countdown: false, text: "已到期" };

  const totalSeconds = Math.floor(diffMs / 1000);
  const totalDays = Math.floor(totalSeconds / 86400);
  const months = Math.floor(totalDays / 30);
  const days = totalDays % 30;
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    countdown: true,
    months,
    days,
    hours,
    minutes,
    seconds,
  };
}

function buildRemainDisplayHtml(hasAccount, isWhitelist, isDisabled, expiresAt) {
  const stateData = getRemainDisplayState(hasAccount, isWhitelist, isDisabled, expiresAt);
  if (!stateData.countdown) {
    return {
      countdown: false,
      html: `<span class="remain-text">${escapeHtml(stateData.text)}</span>`,
    };
  }
  return {
    countdown: true,
    html: `
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.months)}</span><span class="remain-unit">月</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.days)}</span><span class="remain-unit">天</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.hours)}</span><span class="remain-unit">小时</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.minutes)}</span><span class="remain-unit">分钟</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.seconds)}</span><span class="remain-unit">秒</span></span>
    `,
  };
}

// Override remain copy and style marker with cleaner wording.
function getRemainDisplayState(hasAccount, isWhitelist, isDisabled, expiresAt) {
  if (!hasAccount) return { countdown: false, text: "请先开通账号" };
  if (isWhitelist) return { countdown: false, text: "白名单长期可用" };
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return { countdown: false, text: "暂未设置有效期" };
  if (isDisabled) return { countdown: false, text: "您已被封禁", tone: "danger" };

  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return { countdown: false, text: "账号已到期" };

  const totalSeconds = Math.floor(diffMs / 1000);
  const totalDays = Math.floor(totalSeconds / 86400);
  const months = Math.floor(totalDays / 30);
  const days = totalDays % 30;
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    countdown: true,
    months,
    days,
    hours,
    minutes,
    seconds,
  };
}

function buildRemainDisplayHtml(hasAccount, isWhitelist, isDisabled, expiresAt) {
  const stateData = getRemainDisplayState(hasAccount, isWhitelist, isDisabled, expiresAt);
  if (!stateData.countdown) {
    const textClass = stateData.tone === "danger" ? "remain-text remain-text-danger" : "remain-text";
    return {
      countdown: false,
      html: `<span class="${textClass}">${escapeHtml(stateData.text)}</span>`,
    };
  }
  return {
    countdown: true,
    html: `
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.months)}</span><span class="remain-unit">月</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.days)}</span><span class="remain-unit">天</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.hours)}</span><span class="remain-unit">小时</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.minutes)}</span><span class="remain-unit">分钟</span></span>
      <span class="remain-seg"><span class="remain-num">${pad2(stateData.seconds)}</span><span class="remain-unit">秒</span></span>
    `,
  };
}

function startRemainCountdown(hasAccount, isWhitelist, isDisabled, expiresAt) {
  clearRemainCountdownTimer();
  const el = document.getElementById("home-remain-value");
  if (!el) return;

  const update = () => {
    const target = document.getElementById("home-remain-value");
    if (!target) {
      clearRemainCountdownTimer();
      return;
    }
    const display = buildRemainDisplayHtml(hasAccount, isWhitelist, isDisabled, expiresAt);
    target.classList.toggle("is-countdown", display.countdown);
    target.classList.toggle("is-text", !display.countdown);
    target.innerHTML = display.html;
  };

  update();

  if (!hasAccount || isWhitelist || isDisabled || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    return;
  }

  state.remainTimer = window.setInterval(() => {
    update();
    if (Date.now() >= expiresAt.getTime()) {
      clearRemainCountdownTimer();
    }
  }, 1000);
}

function updateCheckinBalance(points) {
  const el = document.getElementById("checkin-balance");
  const labelEl = document.getElementById("checkin-balance-label");
  if (labelEl) {
    labelEl.textContent = `当前${getMoneyLabel()}`;
  }
  if (!el) return;
  el.textContent = `${points ?? "-"}`;
}

function renderCheckinInfo(profile) {
  const homeTodayEl = document.getElementById("home-checkin-today");
  const homeLastEl = document.getElementById("home-checkin-last");
  const checkinBtn = document.getElementById("checkin-btn");
  if (!profile) {
    if (checkinBtn) {
      checkinBtn.disabled = false;
      checkinBtn.textContent = "立即签到";
      checkinBtn.classList.remove("checked");
    }
    if (homeTodayEl) homeTodayEl.textContent = "今日状态：未签到";
    if (homeLastEl) homeLastEl.textContent = "最近签到：暂无记录";
    return;
  }
  const now = new Date();
  const checkinAt = profile.checkin_at ? new Date(profile.checkin_at) : null;
  const checkedToday = Boolean(
    checkinAt &&
    !Number.isNaN(checkinAt.getTime()) &&
    checkinAt.toDateString() === now.toDateString()
  );
  if (homeTodayEl) {
    homeTodayEl.textContent = `今日状态：${checkedToday ? "已签到" : "未签到"}`;
  }
  if (homeLastEl) {
    homeLastEl.textContent = `最近签到：${profile.checkin_at ? toDisplayTime(profile.checkin_at) : "暂无记录"}`;
  }
  if (checkinBtn) {
    checkinBtn.disabled = checkedToday;
    checkinBtn.textContent = checkedToday ? "已签到过了" : "立即签到";
    checkinBtn.classList.toggle("checked", checkedToday);
    checkinBtn.textContent = checkedToday ? "今日已签到" : "立即签到";
  }
}

function formatCheckinMessage(result) {
  const message = result?.message;
  const data = result?.data || {};
  const moneyLabel = getMoneyLabel();
  if (message === "already_checked_in") {
    return {
      variant: "info",
      text: [
        "今天已经签到过了",
        `签到时间：${toDisplayTime(data.checkin_at)}`,
      ],
    };
  }
  const reward = data.reward ?? 0;
  return {
    variant: "success",
    text: [
      "签到成功",
      `本次获得：${reward} ${moneyLabel}`,
      `签到时间：${toDisplayTime(data.checkin_at)}`,
    ],
  };
}

function mapCheckinError(message) {
  const mapping = {
    checkin_disabled: "签到功能未开启",
    insufficient_level: "当前账号权限不足，无法签到",
    user_not_found: "未找到用户记录，请先初始化账户",
    missing_authorization: "登录状态失效，请重新打开小程序",
    turnstile_required: "请先完成人机验证",
    turnstile_not_configured: "人机验证未正确配置",
    turnstile_verify_failed: "验证服务异常，请稍后重试",
    "timeout-or-duplicate": "验证已过期，请重新验证",
    "invalid-input-response": "验证失败，请重新验证",
  };
  return mapping[message] || message || "签到失败";
}

function mapRedeemError(message) {
  const mapping = {
    missing_code: "请输入兑换码后再提交",
    register_disabled_when_free_open: "当前处于自由注册状态，暂时无法使用兑换码",
    user_not_found: "未找到用户记录，请先初始化账户",
    register_code_not_allowed_for_existing_account: "你已有账户，请使用续期码",
    renew_code_not_allowed_for_unregistered_user: "你还没有账户，请先使用注册码",
    already_has_register_credit: "你已有待使用的注册资格，请先完成注册",
    invalid_code: "兑换码无效，请检查后重试",
    code_used: "该兑换码已被使用",
    emby_policy_update_failed: "账户状态恢复失败，请联系管理员",
    turnstile_required: "请先完成人机验证",
    turnstile_not_configured: "人机验证未正确配置",
    turnstile_verify_failed: "验证服务异常，请稍后重试",
    "timeout-or-duplicate": "验证已过期，请重新验证",
    "invalid-input-response": "验证失败，请重新验证",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "兑换失败";
}

function mapRenewError(message) {
  const mapping = {
    renew_points_disabled: "管理员未开启积分续期",
    renew_points_cost_invalid: "积分续期配置异常，请联系管理员",
    user_no_emby_account: "你还没有 Emby 账户，暂时无法续期",
    insufficient_points: "积分不足，无法续期",
    emby_policy_update_failed: "账户状态恢复失败，请联系管理员",
    user_not_found: "未找到用户记录，请稍后重试",
    turnstile_required: "请先完成人机验证",
    turnstile_not_configured: "人机验证未正确配置",
    turnstile_verify_failed: "验证服务异常，请稍后重试",
    "timeout-or-duplicate": "验证已过期，请重新验证",
    "invalid-input-response": "验证失败，请重新验证",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "续期失败";
}

function mapInviteError(message) {
  const mapping = {
    invite_disabled: "管理员未开启兑换邀请码",
    invite_level_insufficient: "当前账号等级不足，无法兑换邀请码",
    insufficient_points: "积分不足，无法兑换邀请码",
    invalid_period: "兑换类型无效，请重新选择",
    invalid_mode: "兑换模式无效，请重新选择",
    invalid_count: "兑换数量无效，请输入 1-50",
    invite_cost_invalid: "邀请码兑换配置异常，请联系管理员",
    user_not_found: "未找到用户记录，请先初始化账户",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "兑换邀请码失败";
}

function mapActivateError(message) {
  const mapping = {
    invalid_activate_method: "开通方式无效，请重试",
    user_not_found: "未找到用户记录，请稍后重试",
    user_already_has_emby: "你已拥有 Emby 账号",
    public_register_closed: "公开注册未开启",
    public_register_quota_reached: "公开注册名额已用完",
    no_register_credit: "没有可用注册码资格，请先使用注册码",
    points_exchange_disabled: "积分兑换未开启",
    invite_level_insufficient: "当前等级不足，无法积分兑换",
    insufficient_points: "积分不足，无法兑换开通",
    emby_create_failed: "开通失败，请稍后重试",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "开通失败";
}

function mapPasswordError(message) {
  const mapping = {
    invalid_password: "密码不能为空，格式按 bot 兼容处理",
    user_no_emby_account: "当前账号还没有开通 Emby",
    emby_password_update_failed: "Emby 密码更新失败，请稍后重试",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "修改密码失败";
}

function formatActivateSuccess(result, methodLabel = "开通") {
  const data = result?.data || {};
  return [
    `${methodLabel}成功`,
    `用户名：${data.name || "-"}`,
    `密码：${data.password || "-"}`,
    `安全码：${data.safe_code || "-"}`,
    `到期时间：${toDisplayTime(data.expires_at)}`,
  ];
}

function renderInviteItems(items = []) {
  const rows = (items || []).map((item, index) => `
    <div class="home-service-row">
      <div class="home-service-row-main">
        <div class="home-service-row-title">邀请码 ${index + 1}</div>
        <div class="home-service-row-link" title="${escapeHtml(item)}">${escapeHtml(item)}</div>
      </div>
      <button type="button" class="home-service-copy" data-copy="${escapeHtml(item)}">复制</button>
    </div>
  `).join("");
  return `
    <div class="home-service-list">
      ${rows || `<div class="helper-text">暂无可展示的邀请码</div>`}
    </div>
  `;
}

function updateActivateSheet(profile = state.profile) {
  const hasAccount = Boolean(profile?.has_account);
  const moneyLabel = getMoneyLabel(profile);
  const userLevel = String(profile?.lv || "d");
  const points = Number(profile?.points ?? 0);
  const registerCredits = Number(profile?.register_credits ?? 0);

  const publicEnabled = Boolean(profile?.public_open_enabled ?? state.publicOpen.enabled);
  const publicDays = Number(profile?.public_open_days ?? state.publicOpen.days ?? 30);
  const publicLeft = Number(profile?.public_open_left ?? state.publicOpen.left ?? 0);
  const publicBtn = document.getElementById("activate-public-btn");
  const publicMeta = document.getElementById("activate-public-meta");
  if (publicMeta) {
    if (hasAccount) {
      publicMeta.textContent = "你已有账号，无需重复开通";
    } else if (!publicEnabled) {
      publicMeta.textContent = "管理员未开启公开注册";
    } else if (publicLeft <= 0) {
      publicMeta.textContent = "公开注册名额已用完";
    } else {
      publicMeta.textContent = `可开通 ${publicDays} 天，剩余名额 ${publicLeft}`;
    }
  }
  if (publicBtn) {
    publicBtn.disabled = hasAccount || !publicEnabled || publicLeft <= 0;
  }

  const codeBtn = document.getElementById("activate-code-btn");
  const codeMeta = document.getElementById("activate-code-meta");
  if (codeMeta) {
    if (hasAccount) {
      codeMeta.textContent = "你已有账号，请在兑换中心使用续期码";
    } else if (registerCredits > 0) {
      codeMeta.textContent = `你有 ${registerCredits} 天注册码资格，点此可继续输入注册码`;
    } else {
      codeMeta.textContent = "输入管理员生成的注册码，系统将自动开通";
    }
  }
  if (codeBtn) {
    codeBtn.disabled = hasAccount;
  }

  const inviteEnabled = Boolean(profile?.invite_enabled ?? state.invite.enabled);
  const inviteLevel = String(profile?.invite_level ?? state.invite.level ?? "b");
  const inviteCost = Number(profile?.invite_cost ?? state.invite.cost ?? 1000);
  const pointsBtn = document.getElementById("activate-points-btn");
  const pointsMeta = document.getElementById("activate-points-meta");
  const levelAllowed = userLevel <= inviteLevel;
  const pointsEnough = points >= inviteCost;
  if (pointsMeta) {
    if (hasAccount) {
      pointsMeta.textContent = "你已有账号，无需积分兑换开通";
    } else if (!inviteEnabled) {
      pointsMeta.textContent = "管理员未开启积分兑换";
    } else if (!levelAllowed) {
      pointsMeta.textContent = "当前账号等级不足，无法积分兑换";
    } else if (!pointsEnough) {
      pointsMeta.textContent = `需要 ${inviteCost}${moneyLabel}，当前仅有 ${points}${moneyLabel}`;
    } else {
      pointsMeta.textContent = `消耗 ${inviteCost}${moneyLabel} 开通 ${publicDays} 天`;
    }
  }
  if (pointsBtn) {
    pointsBtn.disabled = hasAccount || !inviteEnabled || !levelAllowed || !pointsEnough;
  }
}

function getRenewMode(profile = state.profile) {
  void profile;
  return "code";
}

function getRedeemActiveTab(profile = state.profile) {
  const current = String(state.renew.activeTab || "").toLowerCase();
  const hasAccount = Boolean(profile?.has_account);
  const pointsEnabled = Boolean(profile?.renew_points_enabled ?? state.renew.pointsEnabled);
  const activityEnabled = Boolean(profile?.renew_low_activity_enabled ?? state.renew.lowActivityEnabled);
  if (current === "points" || current === "code" || current === "activity") {
    if (!hasAccount && current !== "code") return "code";
    if (current === "points" && !pointsEnabled) return "code";
    if (current === "activity" && !activityEnabled) return "code";
    return current;
  }
  return getRenewMode(profile);
}

function getRedeemPendingText(profile = state.profile) {
  return getRedeemActiveTab(profile) === "points" ? "等待续期" : "等待兑换";
}

function setRedeemActiveTab(tab, profile = state.profile) {
  const next = String(tab || "").toLowerCase() === "points" ? "points" : "code";
  if (!profile?.has_account && next === "points") {
    state.renew.activeTab = "code";
  } else {
    state.renew.activeTab = next;
  }
  updateRenewSheet(profile);
}

function updateRenewSheet(profile = state.profile) {
  const titleEl = document.getElementById("redeem-sheet-title");
  const descEl = document.querySelector("#redeem-sheet .redeem-sheet-desc");
  const modeCodeBtn = document.getElementById("redeem-mode-code-btn");
  const modePointsBtn = document.getElementById("redeem-mode-points-btn");
  const modeWrap = document.getElementById("redeem-mode-switch");
  const formEl = document.getElementById("redeem-sheet-form");
  const pointsWrap = document.getElementById("redeem-points-actions");
  const pointsMetaEl = document.getElementById("redeem-points-meta");
  const pointsBtn = document.getElementById("redeem-points-btn");

  const hasAccount = Boolean(profile?.has_account);
  const moneyLabel = getMoneyLabel(profile);
  const pointsEnabled = Boolean(profile?.renew_points_enabled ?? state.renew.pointsEnabled);
  const pointsCost = Number(profile?.renew_points_cost ?? state.renew.pointsCost ?? 300);
  const pointsDays = Number(profile?.renew_points_days ?? state.renew.pointsDays ?? 30);
  const points = Number(profile?.points ?? 0);
  const mode = getRedeemActiveTab(profile);

  if (titleEl) titleEl.textContent = "续费中心";
  if (descEl) {
    descEl.textContent = mode === "points"
      ? "按管理员规则消耗积分续期。"
      : "输入兑换码后立即生效，注册码和续期码均支持。";
  }
  if (modeWrap) modeWrap.hidden = false;
  if (modeCodeBtn) {
    modeCodeBtn.classList.toggle("active", mode === "code");
    modeCodeBtn.setAttribute("aria-pressed", mode === "code" ? "true" : "false");
  }
  if (modePointsBtn) {
    modePointsBtn.classList.toggle("active", mode === "points");
    modePointsBtn.setAttribute("aria-pressed", mode === "points" ? "true" : "false");
    modePointsBtn.disabled = !hasAccount;
  }
  if (formEl) formEl.hidden = mode !== "code";
  if (pointsWrap) pointsWrap.hidden = mode !== "points";

  let tip = `消耗 ${pointsCost}${moneyLabel} 可续期 ${pointsDays} 天。`;
  let canRenew = hasAccount && pointsEnabled && points >= pointsCost;
  if (!hasAccount) {
    tip = "你还没有 Emby 账户，暂时无法续期。";
    canRenew = false;
  } else if (!pointsEnabled) {
    tip = "管理员未开启积分续期。";
    canRenew = false;
  } else if (points < pointsCost) {
    tip = `积分不足，需要 ${pointsCost}${moneyLabel}，当前仅有 ${points}${moneyLabel}。`;
    canRenew = false;
  }
  if (pointsMetaEl) pointsMetaEl.textContent = tip;
  if (pointsBtn) {
    pointsBtn.disabled = !canRenew;
    pointsBtn.textContent = "立即续期";
  }
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  headers["Content-Type"] = "application/json";
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.message || "request_failed");
  }
  return data;
}

async function loginWithTelegram() {
  const initData = tg?.initData || "";
  if (!initData) {
    throw new Error("无法读取 Telegram initData，请在 Telegram 内打开。");
  }
  const result = await api("/webapp/auth/login", {
    method: "POST",
    body: JSON.stringify({ init_data: initData }),
  });
  state.token = result.data.token;
  state.me = result.data;
  const layout = document.getElementById("app-layout");
  if (result.data.role === "user") {
    if (layout) layout.classList.add("user-no-sidebar");
    setSidebarOpen(false);
    ["admin-settings"].forEach((id) => {
      const panel = document.getElementById(id);
      if (panel) panel.style.display = "none";
      const sideBtn = document.querySelector(`.sidebar button[data-view="${id}"]`);
      if (sideBtn) sideBtn.style.display = "none";
    });
  } else if (layout) {
    layout.classList.remove("user-no-sidebar");
  }
  if (result.data.role !== "owner") {
    document.querySelectorAll("[data-owner-only='true']").forEach((el) => {
      el.style.display = "none";
    });
  }
}

function renderHomepageBanner(data = {}) {
  const banner = data.banner || {};
  const bannerEl = document.getElementById("home-banner");
  const imageEl = document.getElementById("home-banner-image");
  const titleEl = document.getElementById("home-banner-title");
  const subtitleEl = document.getElementById("home-banner-subtitle");
  if (!bannerEl || !imageEl || !titleEl || !subtitleEl) return;

  if (!banner.enabled || !banner.image_url || !banner.link_url) {
    bannerEl.classList.remove("visible");
    bannerEl.style.display = "none";
    return;
  }

  bannerEl.classList.add("visible");
  bannerEl.style.display = "block";
  bannerEl.href = banner.link_url;
  imageEl.src = banner.image_url;
  titleEl.textContent = banner.title || "";
  subtitleEl.textContent = banner.subtitle || "";
  bannerEl.onclick = (event) => {
    event.preventDefault();
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(banner.link_url);
    } else {
      window.open(banner.link_url, "_blank", "noopener");
    }
  };
}

async function loadHomepageConfig() {
  try {
    const result = await api("/webapp/user/homepage-config");
    const data = result.data || {};
    renderHomepageBanner(data);
    state.invite.enabled = Boolean(data.invite?.enabled);
    state.invite.level = data.invite?.level || "b";
    state.invite.cost = Number(data.invite?.cost ?? 1000);
    state.invite.ratioDays = Number(data.invite?.ratio_days ?? 30);
    state.publicOpen.enabled = Boolean(data.public_open?.enabled);
    state.publicOpen.days = Number(data.public_open?.days ?? 30);
    state.publicOpen.total = Number(data.public_open?.total ?? 0);
    state.publicOpen.used = Number(data.public_open?.used ?? 0);
    state.publicOpen.left = Number(data.public_open?.left ?? 0);
    state.renew.mode = String(data.renew?.mode || state.renew.mode || "code").toLowerCase() === "points"
      ? "points"
      : "code";
    state.renew.codeEnabled = Boolean(data.renew?.code_enabled ?? state.renew.codeEnabled ?? true);
    state.renew.pointsEnabled = Boolean(data.renew?.points_enabled ?? state.renew.pointsEnabled);
    state.renew.pointsCost = Number(data.renew?.points_cost ?? state.renew.pointsCost ?? 300);
    state.renew.pointsDays = Number(data.renew?.points_days ?? state.renew.pointsDays ?? 30);
    state.renew.checkExEnabled = Boolean(data.renew?.check_ex_enabled ?? state.renew.checkExEnabled);
    state.renew.lowActivityEnabled = Boolean(data.renew?.low_activity_enabled ?? state.renew.lowActivityEnabled);
    state.renew.activityCheckDays = Number(data.renew?.activity_check_days ?? state.renew.activityCheckDays ?? 30);
    state.turnstile.enabled = Boolean(data.turnstile?.enabled);
    state.turnstile.siteKey = data.turnstile?.site_key || null;
    syncTurnstileLayoutMode();
    renderTurnstileWidget();
    renderRedeemTurnstileWidget();
    updateRenewSheet();
  } catch (err) {
    console.error("loadHomepageConfig failed:", err);
  }
}

function resetTurnstileWidget() {
  if (state.turnstile.widgetId !== null && window.turnstile?.reset) {
    window.turnstile.reset(state.turnstile.widgetId);
  }
  state.turnstile.token = null;
  state.turnstile.requested = false;
  state.turnstile.verifying = false;
  updateTurnstileVerifyButton();
}

function updateTurnstileVerifyButton() {
  const btn = document.getElementById("checkin-verify-btn");
  if (!btn) return;
  if (!state.turnstile.enabled) {
    btn.style.display = "none";
    btn.disabled = true;
    btn.dataset.state = "idle";
    return;
  }
  btn.style.display = "";
  if (state.turnstile.token) {
    btn.textContent = "验证已完成";
    btn.disabled = true;
    btn.dataset.state = "done";
    return;
  }
  btn.textContent = state.turnstile.verifying ? "验证中..." : "点击验证";
  btn.disabled = Boolean(state.turnstile.verifying);
  btn.dataset.state = state.turnstile.verifying ? "verifying" : "idle";
}

function resetRedeemTurnstileWidget() {
  if (state.turnstile.redeemWidgetId !== null && window.turnstile?.reset) {
    window.turnstile.reset(state.turnstile.redeemWidgetId);
  }
  state.turnstile.redeemToken = null;
  state.turnstile.redeemRequested = false;
  state.turnstile.redeemVerifying = false;
  updateRedeemTurnstileVerifyButton();
}

function updateRedeemTurnstileVerifyButton() {
  const btn = document.getElementById("redeem-verify-btn");
  if (!btn) return;
  if (!state.turnstile.enabled) {
    btn.style.display = "none";
    btn.disabled = true;
    btn.dataset.state = "idle";
    return;
  }
  btn.style.display = "";
  if (state.turnstile.redeemToken) {
    btn.textContent = "验证已完成";
    btn.disabled = true;
    btn.dataset.state = "done";
    return;
  }
  btn.textContent = state.turnstile.redeemVerifying ? "验证中..." : "点击验证";
  btn.disabled = Boolean(state.turnstile.redeemVerifying);
  btn.dataset.state = state.turnstile.redeemVerifying ? "verifying" : "idle";
}

function waitForTurnstileToken(timeoutMs = 12000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (state.turnstile.token) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

async function executeTurnstileVerify() {
  if (!state.turnstile.enabled) return true;
  renderTurnstileWidget();
  if (state.turnstile.token) return true;
  if (state.turnstile.widgetId === null || !window.turnstile?.execute) {
    showResultModal("验证组件加载中，请稍后再试。", "info", "请稍候");
    return false;
  }
  state.turnstile.requested = true;
  state.turnstile.verifying = true;
  updateTurnstileVerifyButton();
  try {
    window.turnstile.execute(state.turnstile.widgetId);
  } catch (err) {
    state.turnstile.verifying = false;
    state.turnstile.requested = false;
    updateTurnstileVerifyButton();
    console.error("turnstile execute failed:", err);
    showResultModal("触发验证失败，请重试。", "error", "验证失败");
    return false;
  }
  const ok = await waitForTurnstileToken();
  state.turnstile.verifying = false;
  updateTurnstileVerifyButton();
  if (!ok) {
    showResultModal("验证未完成，请点击验证后再签到。", "info", "需要验证");
    return false;
  }
  return true;
}

function waitForRedeemTurnstileToken(timeoutMs = 12000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (state.turnstile.redeemToken) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

async function executeRedeemTurnstileVerify(actionLabel = "提交") {
  if (!state.turnstile.enabled) return true;
  renderRedeemTurnstileWidget();
  if (state.turnstile.redeemToken) return true;
  if (state.turnstile.redeemWidgetId === null || !window.turnstile?.execute) {
    showResultModal("验证组件加载中，请稍后再试。", "info", "请稍候");
    return false;
  }
  state.turnstile.redeemRequested = true;
  state.turnstile.redeemVerifying = true;
  updateRedeemTurnstileVerifyButton();
  try {
    window.turnstile.execute(state.turnstile.redeemWidgetId);
  } catch (err) {
    state.turnstile.redeemVerifying = false;
    state.turnstile.redeemRequested = false;
    updateRedeemTurnstileVerifyButton();
    console.error("redeem turnstile execute failed:", err);
    showResultModal("触发验证失败，请重试。", "error", "验证失败");
    return false;
  }
  const ok = await waitForRedeemTurnstileToken();
  state.turnstile.redeemVerifying = false;
  updateRedeemTurnstileVerifyButton();
  if (!ok) {
    showResultModal(`验证未完成，请点击验证后再${actionLabel}。`, "info", "需要验证");
    return false;
  }
  return true;
}

function renderTurnstileWidget() {
  const wrap = document.getElementById("turnstile-wrap");
  const box = document.getElementById("turnstile-box");
  if (!wrap || !box) return;

  if (!state.turnstile.enabled || !state.turnstile.siteKey) {
    wrap.classList.add("hidden");
    state.turnstile.token = null;
    state.turnstile.requested = false;
    state.turnstile.verifying = false;
    updateTurnstileVerifyButton();
    return;
  }

  wrap.classList.remove("hidden");
  if (!window.turnstile?.render) {
    setTimeout(renderTurnstileWidget, 500);
    return;
  }
  if (state.turnstile.widgetId !== null) {
    updateTurnstileVerifyButton();
    return;
  }
  box.innerHTML = "";
  state.turnstile.widgetId = window.turnstile.render("#turnstile-box", {
    sitekey: state.turnstile.siteKey,
    theme: "light",
    size: "flexible",
    execution: "execute",
    callback(token) {
      state.turnstile.token = token;
      state.turnstile.requested = true;
      state.turnstile.verifying = false;
      updateTurnstileVerifyButton();
    },
    "expired-callback"() {
      state.turnstile.token = null;
      state.turnstile.requested = false;
      state.turnstile.verifying = false;
      updateTurnstileVerifyButton();
    },
    "error-callback"() {
      state.turnstile.token = null;
      state.turnstile.requested = false;
      state.turnstile.verifying = false;
      updateTurnstileVerifyButton();
    },
  });
  updateTurnstileVerifyButton();
}

function renderRedeemTurnstileWidget() {
  const wrap = document.getElementById("redeem-turnstile-wrap");
  const box = document.getElementById("redeem-turnstile-box");
  if (!wrap || !box) return;

  if (!state.turnstile.enabled || !state.turnstile.siteKey) {
    wrap.classList.add("hidden");
    state.turnstile.redeemToken = null;
    state.turnstile.redeemRequested = false;
    state.turnstile.redeemVerifying = false;
    updateRedeemTurnstileVerifyButton();
    return;
  }

  wrap.classList.remove("hidden");
  if (!window.turnstile?.render) {
    setTimeout(renderRedeemTurnstileWidget, 500);
    return;
  }
  if (state.turnstile.redeemWidgetId !== null) {
    updateRedeemTurnstileVerifyButton();
    return;
  }
  box.innerHTML = "";
  state.turnstile.redeemWidgetId = window.turnstile.render("#redeem-turnstile-box", {
    sitekey: state.turnstile.siteKey,
    theme: "light",
    size: "flexible",
    execution: "execute",
    callback(token) {
      state.turnstile.redeemToken = token;
      state.turnstile.redeemRequested = true;
      state.turnstile.redeemVerifying = false;
      updateRedeemTurnstileVerifyButton();
    },
    "expired-callback"() {
      state.turnstile.redeemToken = null;
      state.turnstile.redeemRequested = false;
      state.turnstile.redeemVerifying = false;
      updateRedeemTurnstileVerifyButton();
    },
    "error-callback"() {
      state.turnstile.redeemToken = null;
      state.turnstile.redeemRequested = false;
      state.turnstile.redeemVerifying = false;
      updateRedeemTurnstileVerifyButton();
    },
  });
  updateRedeemTurnstileVerifyButton();
}

function normalizeView(target) {
  if (!target) return "home";
  if (VIEW_GROUPS[target]) return target;
  return VIEW_ALIASES[target] || target;
}

function getViewSectionIds(target) {
  const normalized = normalizeView(target);
  return VIEW_GROUPS[normalized] || [normalized];
}

function scrollToViewSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showView(target) {
  const normalized = normalizeView(target);
  state.currentView = normalized;
  document.querySelectorAll(".sidebar button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === normalized);
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  getViewSectionIds(normalized).forEach((id) => {
    const view = document.getElementById(id);
    if (view) view.classList.add("active");
  });
}

/** 启动时根据 URL 或 Telegram 参数打开指定视图（签到按钮等） */
function getInitialPanelViewId() {
  const params = new URLSearchParams(window.location.search || "");
  const fromQuery = params.get("panel_view")?.trim();
  if (fromQuery) return fromQuery;
  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam && String(startParam).trim()) return String(startParam).trim();
  const raw = (window.location.hash || "").replace(/^#/, "").trim();
  return raw || "";
}

function applyInitialPanelView() {
  const id = getInitialPanelViewId();
  if (!id) return;
  if (id === "redeem-center" || id === "redeem") {
    openRedeemSheet();
    return;
  }
  if (id === "invite-code" || id === "invite") {
    openInviteSheet();
    return;
  }
  if (id === "activate-emby" || id === "activate") {
    openActivateSheet();
    return;
  }
  if (id === "checkin-points" || id === "checkin") {
    openCheckinSheet();
    return;
  }
  const normalized = normalizeView(id);
  const targetView = document.getElementById(normalized);
  const sourceView = document.getElementById(id);
  if (targetView?.classList?.contains("view") || VIEW_GROUPS[normalized]) {
    showView(normalized);
    if (sourceView?.classList?.contains("view") && id !== normalized) {
      requestAnimationFrame(() => scrollToViewSection(id));
    }
  }
}

function setSidebarOpen(isOpen) {
  const layout = document.getElementById("app-layout");
  const toggleBtn = document.getElementById("sidebar-toggle");
  if (!layout) return;
  layout.classList.toggle("sidebar-open", isOpen);
  layout.classList.toggle("sidebar-closed", !isOpen);
  if (toggleBtn) {
    toggleBtn.innerHTML = isOpen ? "✕" : '<span class="menu-icon">☰</span>';
  }
}

function syncSheetScrollLock() {
  const hasOpenSheet = Boolean(document.querySelector(".redeem-sheet.open, .checkin-sheet.open"));
  document.body.classList.toggle("sheet-open", hasOpenSheet);
}

function openRedeemSheet() {
  const sheet = document.getElementById("redeem-sheet");
  const panel = document.querySelector("#redeem-sheet .redeem-sheet-panel");
  if (!sheet) return;
  updateRenewSheet();
  renderResult("redeem-sheet-result", null, getRedeemPendingText());
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  syncSheetScrollLock();
  renderRedeemTurnstileWidget();
  updateRedeemTurnstileVerifyButton();
}

function closeRedeemSheet() {
  const sheet = document.getElementById("redeem-sheet");
  const panel = document.querySelector("#redeem-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  syncSheetScrollLock();
}

function openInviteSheet() {
  const sheet = document.getElementById("invite-sheet");
  const panel = document.querySelector("#invite-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  syncSheetScrollLock();
}

function closeInviteSheet() {
  const sheet = document.getElementById("invite-sheet");
  const panel = document.querySelector("#invite-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  syncSheetScrollLock();
}

function openActivateSheet() {
  const sheet = document.getElementById("activate-sheet");
  const panel = document.querySelector("#activate-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  updateActivateSheet();
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  syncSheetScrollLock();
}

function closeActivateSheet() {
  const sheet = document.getElementById("activate-sheet");
  const panel = document.querySelector("#activate-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  syncSheetScrollLock();
}

function openCheckinSheet() {
  const sheet = document.getElementById("checkin-sheet");
  const panel = document.querySelector("#checkin-sheet .checkin-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  syncSheetScrollLock();
  renderTurnstileWidget();
  updateTurnstileVerifyButton();
}

function closeCheckinSheet() {
  const sheet = document.getElementById("checkin-sheet");
  const panel = document.querySelector("#checkin-sheet .checkin-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  syncSheetScrollLock();
}

function bindSheetDragToClose(sheetSelector, handleSelector, panelSelector, closeFn) {
  const sheet = document.querySelector(sheetSelector);
  const handle = document.querySelector(handleSelector);
  const panel = document.querySelector(panelSelector);
  if (!sheet || !handle || !panel) return;

  let dragging = false;
  let startY = 0;
  let deltaY = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (!sheet.classList.contains("open")) return;
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    startY = event.clientY;
    deltaY = 0;
    panel.style.transition = "none";
    handle.setPointerCapture?.(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    deltaY = Math.max(0, event.clientY - startY);
    panel.style.transform = `translateY(${deltaY}px)`;
  });

  const stopDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = "transform 0.22s ease";
    if (deltaY > 120) {
      closeFn();
    } else {
      panel.style.transform = "translateY(0)";
    }
    deltaY = 0;
    handle.releasePointerCapture?.(event.pointerId);
  };

  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

function bindSidebar() {
  const layout = document.getElementById("app-layout");
  const toggleBtn = document.getElementById("sidebar-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");
  showView("home");
  if (toggleBtn && layout) {
    toggleBtn.addEventListener("click", () => {
      const isOpen = layout.classList.contains("sidebar-open");
      setSidebarOpen(!isOpen);
    });
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => setSidebarOpen(false));
  }
  document.querySelectorAll(".sidebar button[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view);
      setSidebarOpen(false);
    });
  });
  document.addEventListener("click", async (event) => {
    const copyTarget = event.target.closest("[data-copy]");
    if (copyTarget) {
      const ok = await copyText(copyTarget.dataset.copy || "");
      showToast(ok ? "已复制到剪贴板" : "复制失败，请长按手动复制", ok ? "success" : "error");
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === "open-redeem") {
        openRedeemSheet();
        setSidebarOpen(false);
        return;
      }
      if (action === "open-activate") {
        openActivateSheet();
        setSidebarOpen(false);
        return;
      }
      if (action === "open-redeem-from-activate") {
        closeActivateSheet();
        openRedeemSheet();
        setSidebarOpen(false);
        return;
      }
      if (action === "open-invite") {
        openInviteSheet();
        setSidebarOpen(false);
        return;
      }
      if (action === "close-redeem") {
        closeRedeemSheet();
        return;
      }
      if (action === "close-activate") {
        closeActivateSheet();
        return;
      }
      if (action === "close-invite") {
        closeInviteSheet();
        return;
      }
      if (action === "open-checkin") {
        openCheckinSheet();
        setSidebarOpen(false);
        return;
      }
      if (action === "close-checkin") {
        closeCheckinSheet();
        return;
      }
    }

    const btn = event.target.closest("[data-open-view]");
    if (!btn) return;
    if (btn.dataset.openView === "checkin-points") {
      openCheckinSheet();
      if (btn.closest(".sidebar")) setSidebarOpen(false);
      return;
    }
    showView(btn.dataset.openView);
    const scrollTarget = btn.dataset.scrollTarget;
    if (scrollTarget) {
      requestAnimationFrame(() => scrollToViewSection(scrollTarget));
    }
    if (btn.closest(".sidebar")) {
      setSidebarOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRedeemSheet();
      closeActivateSheet();
      closeInviteSheet();
      closeCheckinSheet();
    }
  });

  bindSheetDragToClose(
    "#redeem-sheet",
    "#redeem-sheet .redeem-sheet-handle",
    "#redeem-sheet .redeem-sheet-panel",
    closeRedeemSheet
  );
  bindSheetDragToClose(
    "#activate-sheet",
    "#activate-sheet .redeem-sheet-handle",
    "#activate-sheet .redeem-sheet-panel",
    closeActivateSheet
  );
  bindSheetDragToClose(
    "#invite-sheet",
    "#invite-sheet .redeem-sheet-handle",
    "#invite-sheet .redeem-sheet-panel",
    closeInviteSheet
  );
  bindSheetDragToClose(
    "#checkin-sheet",
    "#checkin-sheet .checkin-sheet-handle",
    "#checkin-sheet .checkin-sheet-panel",
    closeCheckinSheet
  );
}

function bindResultModal() {
  const closeBtn = document.getElementById("result-modal-close");
  const backdrop = document.getElementById("result-modal-backdrop");
  if (closeBtn) closeBtn.addEventListener("click", hideResultModal);
  if (backdrop) backdrop.addEventListener("click", hideResultModal);
}

async function loadUserStatus() {
  clearRemainCountdownTimer();
  const data = await api("/webapp/user/status");
  const profile = data.data || {};
  state.profile = profile;
  state.publicOpen.enabled = Boolean(profile.public_open_enabled ?? state.publicOpen.enabled);
  state.publicOpen.days = Number(profile.public_open_days ?? state.publicOpen.days ?? 30);
  state.publicOpen.total = Number(profile.public_open_total ?? state.publicOpen.total ?? 0);
  state.publicOpen.used = Number(profile.public_open_used ?? state.publicOpen.used ?? 0);
  state.publicOpen.left = Number(profile.public_open_left ?? state.publicOpen.left ?? 0);
  state.invite.enabled = Boolean(profile.invite_enabled ?? state.invite.enabled);
  state.invite.level = String(profile.invite_level ?? state.invite.level ?? "b");
  state.invite.cost = Number(profile.invite_cost ?? state.invite.cost ?? 1000);
  state.renew.mode = String(profile.renew_mode ?? state.renew.mode ?? "code").toLowerCase() === "points"
    ? "points"
    : "code";
  state.renew.codeEnabled = Boolean(profile.renew_code_enabled ?? state.renew.codeEnabled ?? true);
  state.renew.pointsEnabled = Boolean(profile.renew_points_enabled ?? state.renew.pointsEnabled);
  state.renew.pointsCost = Number(profile.renew_points_cost ?? state.renew.pointsCost ?? 300);
  state.renew.pointsDays = Number(profile.renew_points_days ?? state.renew.pointsDays ?? 30);
  state.renew.checkExEnabled = Boolean(profile.renew_check_ex_enabled ?? state.renew.checkExEnabled);
  state.renew.lowActivityEnabled = Boolean(profile.renew_low_activity_enabled ?? state.renew.lowActivityEnabled);
  state.renew.activityCheckDays = Number(profile.renew_activity_check_days ?? state.renew.activityCheckDays ?? 30);
  setMoneyLabelText(profile);
  updateCheckinBalance(profile.points ?? 0);
  const tgUser = state.me?.tg_user || {};
  const tgDisplayName = tgUser.username || tgUser.first_name || profile.name || "用户";
  const expiresAt = profile.expires_at ? new Date(profile.expires_at) : null;
  const isExpired = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now());
  const isWhitelist = profile.lv === "a";
  const hasAccount = Boolean(profile.has_account);
  const isDisabled = profile.lv === "c";
  const isAvailable = hasAccount && (isWhitelist || (!isExpired && !isDisabled));
  const canRenewAccount = hasAccount && !isWhitelist;
  const primaryAction = hasAccount ? (canRenewAccount ? "open-redeem" : "") : "open-activate";
  const primaryActionLabel = !hasAccount ? "启用Emby" : isWhitelist ? "白名单已启用" : "Emby已启用";
  const showRemainActionButton = !hasAccount || canRenewAccount;
  const userState = !hasAccount ? "未注册" : isWhitelist ? "白名单" : isDisabled ? "已封禁" : isExpired ? "已到期" : "正常";
  const embyState = isAvailable ? "可用" : "不可用";
  const remainDisplay = buildRemainDisplayHtml(hasAccount, isWhitelist, isDisabled, expiresAt);
  const showExpireLine = !isWhitelist;
  const expireLine = hasAccount && profile.expires_at
    ? `到期时间：${escapeHtml(toDisplayTime(profile.expires_at))}`
    : "注册后可查看到期时间";
  const serviceLineItems = getServiceLineItems(profile);
  const showServiceLines = isAvailable && serviceLineItems.length > 0;
  const serviceCardMode = showServiceLines || hasAccount ? "ok" : "warn";
  const serviceText = isDisabled
    ? "账号已封禁，线路已隐藏，解封后恢复可见"
    : isExpired
      ? "账号已到期，线路已隐藏，续费后恢复可见"
    : hasAccount
      ? "暂未配置线路，请联系管理员"
      : "请检查账号状态或联系管理员";
  const serviceRowsHtml = serviceLineItems.map((item) => `
    <div class="home-service-row">
      <div class="home-service-row-main">
        <div class="home-service-row-title">${escapeHtml(item.name)}</div>
        <div class="home-service-row-link" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
      </div>
      <button type="button" class="home-service-copy" data-copy="${escapeHtml(item.url)}">复制</button>
    </div>
  `).join("");
  const accountName = String(profile.name || profile.embyid || "-");
  const accountPassword = String(profile.password || "-");
  const serviceSub = hasAccount
    ? (isDisabled ? "账号解封后，线路地址会自动恢复显示。" : isExpired ? "账号续费后，线路地址会自动恢复显示。" : isAvailable ? "" : "账号当前不可用。")
    : (showServiceLines ? "当前暂无可用账号，开通后即可使用这些线路地址。" : "请检查账号状态或联系管理员");
  const serviceLineSectionHtml = showServiceLines ? `
        <div class="home-service-line">
          <div class="home-service-line-head">
            <span>Emby连接信息</span>
          </div>
          <div class="home-service-list">
            ${serviceRowsHtml || `
            <div class="home-service-row">
              <div class="home-service-row-main">
                <div class="home-service-row-title">未配置线路</div>
                <div class="home-service-row-link">请联系管理员</div>
              </div>
              <button type="button" class="home-service-copy" disabled>复制</button>
            </div>
            `}
          </div>
        </div>
  ` : "";
  const accountSectionHtml = hasAccount ? `
        <div class="home-service-line">
          <div class="home-service-line-head">
            <span>Emby账号信息</span>
          </div>
          <div class="home-service-list">
            <div class="home-service-row">
              <div class="home-service-row-main">
                <div class="home-service-row-title">用户名</div>
                <div class="home-service-row-link">${escapeHtml(accountName)}</div>
              </div>
              <button type="button" class="home-service-copy" data-copy="${escapeHtml(accountName)}">复制</button>
            </div>
            <div class="home-service-row">
              <div class="home-service-row-main">
                <div class="home-service-row-title">密码</div>
                <div class="home-service-row-link">${escapeHtml(accountPassword)}</div>
              </div>
              <button type="button" class="home-service-copy" data-copy="${escapeHtml(accountPassword)}">复制</button>
            </div>
          </div>
          <form id="emby-password-form" class="home-password-form">
            <input
              id="emby-new-password"
              type="text"
              placeholder="输入新密码（支持中英文 / emoji / 部分特殊字符）"
              autocomplete="off"
            />
            <button id="emby-password-submit" type="submit">修改Emby密码</button>
          </form>
          <div class="home-checkin-meta">修改后请使用新密码重新登录 Emby 客户端。</div>
        </div>
  ` : "";
  const serviceEmptyHtml = !showServiceLines ? `<div class="home-service-text">${escapeHtml(serviceText)}</div>` : "";
  const showWarn = !hasAccount;
  const moneyLabel = getMoneyLabel(profile);
  const inviteEnabled = Boolean(profile.invite_enabled ?? state.invite.enabled);
  const inviteLevel = String(profile.invite_level ?? state.invite.level ?? "b");
  const userLevel = String(profile.lv || "d");
  const inviteLevelAllowed = userLevel <= inviteLevel;
  const inviteCost = Number(profile.invite_cost ?? state.invite.cost ?? 1000);
  const inviteCanOpen = inviteEnabled && inviteLevelAllowed;
  const inviteBtnLabel = !inviteEnabled
    ? "邀请码未开启"
    : !inviteLevelAllowed
      ? "邀请码等级不足"
      : `兑换邀请码 ${inviteCost}${moneyLabel}`;
  const checkinAtDate = profile.checkin_at ? new Date(profile.checkin_at) : null;
  const checkedToday = Boolean(
    checkinAtDate &&
    !Number.isNaN(checkinAtDate.getTime()) &&
    checkinAtDate.toDateString() === new Date().toDateString()
  );
  const homeCheckinLast = profile.checkin_at ? toDisplayTime(profile.checkin_at) : "暂无记录";

  const homeCheckinBtnText = checkedToday ? "今日已签到" : "前往签到";

  const homeCheckinBadgeText = checkedToday ? "今日已领" : "今日可签";

  document.getElementById("user-status-data").innerHTML = `
    <div class="home-overview">
      <div class="home-panel home-basic">
        <div class="home-basic-title">${escapeHtml(tgDisplayName)}</div>
        <div class="home-basic-sub">TG ${escapeHtml(profile.tg || "-")}</div>
      </div>

      <div class="home-mini-grid">
        <div class="home-mini-card">
          <div class="home-mini-title">用户状态</div>
          <div class="home-value-chip">${escapeHtml(userState)}</div>
        </div>
        <div class="home-mini-card">
          <div class="home-mini-title">Emby状态</div>
          <div class="home-value-chip">${escapeHtml(embyState)}</div>
        </div>
      </div>

      <div class="home-panel home-remain-panel">
        <div class="home-panel-title home-remain-title">
          <span class="home-remain-title-main">
            <span class="home-remain-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <rect x="3.5" y="5.5" width="16.5" height="15" rx="3"></rect>
                <path d="M7 3.8v3.4M16 3.8v3.4M3.8 9.5h15.8"></path>
                <circle cx="15.8" cy="15.8" r="4.2"></circle>
                <path d="M15.8 13.9v2.1l1.5.9"></path>
              </svg>
            </span>
            <span>Emby可用时长</span>
          </span>
        </div>
        <div id="home-remain-value" class="home-remain-display ${remainDisplay.countdown ? "is-countdown" : "is-text"}">${remainDisplay.html}</div>
        ${showExpireLine ? `
        <div class="home-divider"></div>
        <div class="home-muted-line">${escapeHtml(expireLine)}</div>
        ` : ""}
        ${showRemainActionButton ? `<button type="button" class="home-primary-btn" data-action="${hasAccount ? "open-redeem" : "open-activate"}">${hasAccount ? "前往续费" : "启用Emby"}</button>` : ""}
      </div>

      <div class="home-panel home-points-panel ${checkedToday ? "checked" : ""}">
        <div class="home-points-head">
          <div class="home-panel-title home-points-title">${escapeHtml(moneyLabel)}</div>
          <span class="home-points-state">${escapeHtml(homeCheckinBadgeText)}</span>
        </div>
        <div class="home-points-balance-wrap">
          <div class="home-points-balance-label">当前余额</div>
          <div class="home-points-value">${escapeHtml(profile.points ?? 0)}</div>
        </div>
        <div class="home-divider"></div>
        <button type="button" class="home-primary-btn home-points-btn ${checkedToday ? "is-checked" : ""}" data-action="open-checkin" ${checkedToday ? "disabled" : ""}>${homeCheckinBtnText}</button>
        <div id="home-checkin-last" class="home-checkin-meta home-points-meta">最近签到：${escapeHtml(homeCheckinLast)}</div>
      </div>

      <div class="home-panel">
        <div class="home-panel-title">操作</div>
        <div class="home-action-grid">
          <button type="button" class="home-action-btn primary" ${primaryAction ? `data-action="${primaryAction}"` : "disabled"}>${primaryActionLabel}</button>
          <button type="button" class="home-action-btn secondary" data-action="open-invite" ${inviteCanOpen ? "" : "disabled"}>${inviteBtnLabel}</button>
        </div>
      </div>

      <div class="home-panel home-stats-panel">
        <div class="home-panel-title home-stats-title">媒体统计</div>
        <div id="stats-summary" class="home-mini-grid home-stats-grid"></div>
      </div>

      <div class="home-service-card ${serviceCardMode}">
        <div class="home-service-icon">${showServiceLines || hasAccount ? "✓" : "⟲"}</div>
        ${serviceLineSectionHtml || serviceEmptyHtml}
        ${showServiceLines && hasAccount ? `<div class="home-account-divider"></div>` : ""}
        ${accountSectionHtml}
        ${serviceSub ? `<div class="home-service-sub">${escapeHtml(serviceSub)}</div>` : ""}
      </div>

      ${showWarn ? `
      <div class="home-alert">
        <div class="home-alert-icon">!</div>
        <div>
          <div class="home-alert-title">您尚未注册账号</div>
          <div class="home-alert-desc">请先完成账号注册后再使用本服务。</div>
        </div>
      </div>
      ` : ""}
    </div>
  `;

  const checkinBtn = document.querySelector('#user-status-data .home-primary-btn[data-action="open-checkin"]');
  const pointsTitleEl = checkinBtn?.closest(".home-panel")?.querySelector(".home-panel-title");
  if (pointsTitleEl) {
    pointsTitleEl.textContent = moneyLabel;
  }
  const embyMiniTitle = document.querySelector('#user-status-data .home-mini-grid .home-mini-card:nth-child(2) .home-mini-title');
  if (embyMiniTitle) {
    embyMiniTitle.textContent = "Emby状态";
  }
  const remainTitleText = document.querySelector("#user-status-data .home-remain-title-main > span:last-of-type");
  if (remainTitleText) {
    remainTitleText.textContent = "账号可用状态";
  }
  const sidebarAccountBtn = document.querySelector('.sidebar button[data-role="account-action"]');
  if (sidebarAccountBtn) {
    if (primaryAction) {
      sidebarAccountBtn.dataset.action = primaryAction;
    } else {
      sidebarAccountBtn.removeAttribute("data-action");
    }
    sidebarAccountBtn.textContent = !hasAccount ? "启用 Emby" : isWhitelist ? "白名单已启用" : "前往续费";
    sidebarAccountBtn.disabled = !primaryAction;
  }
  const embyPasswordForm = document.getElementById("emby-password-form");
  if (embyPasswordForm) {
    embyPasswordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const passwordInput = document.getElementById("emby-new-password");
      const submitBtn = document.getElementById("emby-password-submit");
      const nextPassword = passwordInput?.value || "";
      if (!nextPassword.trim()) {
        showResultModal("请输入新的 Emby 密码。格式按 bot 兼容处理。", "info", "密码格式不正确");
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        await api("/webapp/user/password", {
          method: "POST",
          body: JSON.stringify({ password: nextPassword }),
        });
        if (passwordInput) passwordInput.value = "";
        showResultModal("Emby 密码已更新。", "success", "修改成功");
        await loadUserStatus();
      } catch (err) {
        const reason = mapPasswordError(err.message);
        showResultModal(`修改失败\n原因：${reason}`, "error", "修改失败");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
  if (hasAccount) {
    closeActivateSheet();
  }
  updateActivateSheet(profile);
  updateRenewSheet(profile);
  startRemainCountdown(hasAccount, isWhitelist, isDisabled, expiresAt);
  renderCheckinInfo(profile);
  await loadStats();
}

async function loadStats() {
  const [media] = await Promise.allSettled([
    api("/webapp/user/media-count"),
  ]);
  const mediaText = media.status === "fulfilled" ? (media.value.data?.text || "") : "";
  const mediaStats = extractMediaStats(mediaText);
  const hasMediaStats =
    /电影(?:数量|数)?\s*[：:]\s*\d+/.test(mediaText) ||
    /(?:电视剧|剧集)(?:数量|数)?\s*[：:]\s*\d+/.test(mediaText) ||
    /总集数\s*[：:]\s*\d+/.test(mediaText);

  const summaryEl = document.getElementById("stats-summary");
  if (summaryEl) {
    const statCards = [
      ["movies", "电影", hasMediaStats ? mediaStats.movieCount : "-"],
      ["series", "剧集", hasMediaStats ? mediaStats.seriesCount : "-"],
      ["episodes", "总集数", hasMediaStats ? mediaStats.totalEpisodes : "-"],
    ];
    summaryEl.innerHTML = statCards
      .map(([type, label, value]) => renderStatCard(type, label, value))
      .join("");
  }
}

function checkinLevelLabel(level) {
  const mapping = {
    a: "仅白名单",
    b: "白名单 + 普通用户",
    c: "除已删除外均可",
    d: "所有用户",
  };
  return mapping[level] || level || "-";
}

async function loadCheckinSettings() {
  if (!state.me || state.me.role !== "owner") return;
  try {
    const result = await api("/webapp/admin/settings/checkin");
    const data = result.data || {};
    const enabledEl = document.getElementById("checkin-enabled");
    const levelEl = document.getElementById("checkin-level");
    if (enabledEl) enabledEl.value = String(Boolean(data.enabled));
    if (levelEl) levelEl.value = data.level || "d";
    renderResult("checkin-settings-result", {
      签到状态: data.enabled ? "开启" : "关闭",
      签到权限: checkinLevelLabel(data.level),
      奖励区间: Array.isArray(data.reward_range) ? `${data.reward_range[0]} - ${data.reward_range[1]}` : "-",
    }, "等待读取配置", "info");
  } catch (err) {
    renderResult("checkin-settings-result", `读取失败：${err.message}`, "等待读取配置", "error");
  }
}

async function loadBannerSettings() {
  if (!state.me || state.me.role !== "owner") return;
  try {
    const result = await api("/webapp/admin/settings/banner");
    const data = result.data || {};
    const enabledEl = document.getElementById("banner-enabled");
    const titleEl = document.getElementById("banner-title");
    const subtitleEl = document.getElementById("banner-subtitle");
    const imageEl = document.getElementById("banner-image-url");
    const linkEl = document.getElementById("banner-link-url");
    if (enabledEl) enabledEl.value = String(Boolean(data.enabled));
    if (titleEl) titleEl.value = data.title || "";
    if (subtitleEl) subtitleEl.value = data.subtitle || "";
    if (imageEl) imageEl.value = data.image_url || "";
    if (linkEl) linkEl.value = data.link_url || "";
    renderResult("banner-settings-result", {
      广告状态: data.enabled ? "开启" : "关闭",
      广告标题: data.title || "-",
      图片地址: data.image_url || "-",
      跳转链接: data.link_url || "-",
    }, "等待读取配置", "info");
  } catch (err) {
    renderResult("banner-settings-result", `读取失败：${err.message}`, "等待读取配置", "error");
  }
}

function bindForms() {
  const submitActivate = async (method, methodLabel) => {
    const publicBtn = document.getElementById("activate-public-btn");
    const pointsBtn = document.getElementById("activate-points-btn");
    if (publicBtn) publicBtn.disabled = true;
    if (pointsBtn) pointsBtn.disabled = true;
    try {
      const result = await api("/webapp/user/activate", {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      const lines = formatActivateSuccess(result, methodLabel);
      renderResult("activate-sheet-result", lines, "等待操作", "success");
      showResultModal(lines.join("\n"), "success", "开通成功");
      await loadUserStatus();
      closeActivateSheet();
    } catch (err) {
      const reason = mapActivateError(err.message);
      renderResult("activate-sheet-result", `开通失败：${reason}`, "等待操作", "error");
      showResultModal(`开通失败\n原因：${reason}`, "error", "开通失败");
      updateActivateSheet();
    }
  };

  const activatePublicBtn = document.getElementById("activate-public-btn");
  if (activatePublicBtn) {
    activatePublicBtn.addEventListener("click", async () => {
      await submitActivate("public", "公开注册");
    });
  }

  const activatePointsBtn = document.getElementById("activate-points-btn");
  if (activatePointsBtn) {
    activatePointsBtn.addEventListener("click", async () => {
      await submitActivate("points", "积分兑换");
    });
  }

  const redeemModeCodeBtn = document.getElementById("redeem-mode-code-btn");
  if (redeemModeCodeBtn) {
    redeemModeCodeBtn.addEventListener("click", () => {
      setRedeemActiveTab("code");
      renderResult("redeem-sheet-result", null, "等待兑换");
    });
  }

  const redeemModePointsBtn = document.getElementById("redeem-mode-points-btn");
  if (redeemModePointsBtn) {
    redeemModePointsBtn.addEventListener("click", () => {
      setRedeemActiveTab("points");
      renderResult("redeem-sheet-result", null, "等待续期");
    });
  }

  const redeemModeActivityBtn = document.getElementById("redeem-mode-activity-btn");
  if (redeemModeActivityBtn) {
    redeemModeActivityBtn.addEventListener("click", () => {
      setRedeemActiveTab("activity");
      renderResult("redeem-sheet-result", null, getRedeemPendingText());
    });
  }

  const redeemPointsBtn = document.getElementById("redeem-points-btn");
  if (redeemPointsBtn) redeemPointsBtn.addEventListener("click", async () => {
    redeemPointsBtn.disabled = true;
    try {
      const verified = await executeRedeemTurnstileVerify("续期");
      if (!verified) return;
      const result = await api("/webapp/user/renew", {
        method: "POST",
        body: JSON.stringify({ turnstile_token: state.turnstile.redeemToken }),
      });
      const successText = "续期成功，请返回账户总览查看最新状态。";
      renderResult("redeem-sheet-result", result.data || successText, "等待续期", "success");
      showResultModal(successText, "success", "续期成功");
      closeRedeemSheet();
      await loadUserStatus();
    } catch (err) {
      const reason = mapRenewError(err.message);
      renderResult("redeem-sheet-result", `续期失败：${reason}`, "等待续期", "error");
      showResultModal(`续期失败\n原因：${reason}`, "error", "续期失败");
    } finally {
      if (state.turnstile.enabled) resetRedeemTurnstileWidget();
      updateRenewSheet();
    }
  });

  const redeemVerifyBtn = document.getElementById("redeem-verify-btn");
  if (redeemVerifyBtn) redeemVerifyBtn.addEventListener("click", async () => {
    if (state.turnstile.redeemVerifying) return;
    await executeRedeemTurnstileVerify(getRedeemActiveTab() === "points" ? "续期" : "兑换");
  });

  const redeemForm = document.getElementById("redeem-sheet-form");
  if (false && redeemForm) redeemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const verified = await executeRedeemTurnstileVerify("兑换");
      if (!verified) return;
      const code = document.getElementById("redeem-sheet-code").value.trim();
      const result = await api("/webapp/user/redeem", {
        method: "POST",
        body: JSON.stringify({ code, turnstile_token: state.turnstile.redeemToken }),
      });
      if (result.message === "register_credit_added" && !state.profile?.has_account) {
        try {
          const activateResult = await api("/webapp/user/activate", {
            method: "POST",
            body: JSON.stringify({ method: "credit" }),
          });
          const lines = formatActivateSuccess(activateResult, "注册码");
          renderResult("redeem-sheet-result", "注册码兑换成功，已自动开通。", "等待兑换", "success");
          renderResult("activate-sheet-result", lines, "等待操作", "success");
          showResultModal(lines.join("\n"), "success", "开通成功");
          document.getElementById("redeem-sheet-code").value = "";
          closeRedeemSheet();
          await loadUserStatus();
          return;
        } catch (activateErr) {
          const activateReason = mapActivateError(activateErr.message);
          renderResult("activate-sheet-result", `自动开通失败：${activateReason}`, "等待操作", "error");
          showResultModal(`注册码兑换成功，但自动开通失败\n原因：${activateReason}`, "error", "自动开通失败");
          document.getElementById("redeem-sheet-code").value = "";
          await loadUserStatus();
          openActivateSheet();
          return;
        }
      }

      const successText = result.message === "renewed"
        ? "续期成功，请返回账户总览查看最新状态。"
        : result.message === "register_credit_added"
          ? "注册码使用成功，请在“启用 Emby”中继续开通。"
          : "兑换成功，请返回账户总览查看最新状态。";
      renderResult("redeem-sheet-result", result.data || successText, "等待兑换", "success");
      setNotice("兑换成功");
      showResultModal(successText, "success", "兑换成功");
      document.getElementById("redeem-sheet-code").value = "";
      closeRedeemSheet();
      await loadUserStatus();
    } catch (err) {
      const reason = mapRedeemError(err.message);
      setNotice(reason, true);
      renderResult("redeem-sheet-result", `兑换失败：${reason}`, "等待兑换", "error");
      showResultModal(`兑换失败\n原因：${reason}`, "error", "兑换失败");
    } finally {
      if (state.turnstile.enabled) resetRedeemTurnstileWidget();
    }
  });

  const inviteForm = document.getElementById("invite-sheet-form");
  if (inviteForm) inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const period = document.getElementById("invite-sheet-period").value;
      const count = Number(document.getElementById("invite-sheet-count").value || 1);
      const mode = document.getElementById("invite-sheet-mode").value;
      const result = await api("/webapp/user/invite/exchange", {
        method: "POST",
        body: JSON.stringify({ period, count, mode }),
      });
      const items = result.data?.items || [];
      const cost = result.data?.cost ?? "-";
      const pointsLeft = result.data?.points_left ?? "-";
      const summaryHtml = `
        <div class="helper-text">本次消耗：${escapeHtml(cost)} ${escapeHtml(getMoneyLabel())}，剩余：${escapeHtml(pointsLeft)} ${escapeHtml(getMoneyLabel())}</div>
        ${renderInviteItems(items)}
      `;
      renderResultHtml("invite-sheet-result", summaryHtml, "等待兑换", "success");
      showResultModal(`已生成 ${items.length} 条邀请码，可在下方列表复制。`, "success", "兑换成功");
      await loadUserStatus();
    } catch (err) {
      const reason = mapInviteError(err.message);
      renderResult("invite-sheet-result", `兑换失败：${reason}`, "等待兑换", "error");
      showResultModal(`兑换失败\n原因：${reason}`, "error", "兑换失败");
    }
  });

  const checkinVerifyBtn = document.getElementById("checkin-verify-btn");
  if (checkinVerifyBtn) {
    checkinVerifyBtn.addEventListener("click", async () => {
      await executeTurnstileVerify();
    });
  }

  document.getElementById("checkin-btn").addEventListener("click", async () => {
    try {
      if (state.turnstile.enabled) {
        if (!state.turnstile.requested) {
          showResultModal("请先点击验证，再进行签到。", "info", "需要验证");
          return;
        }
        if (state.turnstile.verifying) {
          showResultModal("验证进行中，请稍候再试。", "info", "验证中");
          return;
        }
      }
      if (state.turnstile.enabled && !state.turnstile.token) {
        showResultModal("请先完成人机验证，再进行签到。", "info", "需要验证");
        return;
      }
      const result = await api("/webapp/user/checkin", {
        method: "POST",
        body: JSON.stringify({ turnstile_token: state.turnstile.token }),
      });
      const formatted = formatCheckinMessage(result);
      updateCheckinBalance(result.data?.points ?? state.profile?.points ?? 0);
      setNotice(formatted.variant === "success" ? "签到成功" : "签到请求已处理");
      showResultModal(formatted.text.join("\n"), formatted.variant, formatted.variant === "success" ? "签到成功" : "签到结果");
      if (state.turnstile.enabled) resetTurnstileWidget();
      await loadUserStatus();
    } catch (err) {
      const reason = mapCheckinError(err.message);
      setNotice(reason, true);
      showResultModal(`签到失败\n原因：${reason}`, "error", "签到失败");
      if (state.turnstile.enabled) resetTurnstileWidget();
    }
  });

  document.getElementById("search-users-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const q = encodeURIComponent(document.getElementById("search-query").value.trim());
      const result = await api(`/webapp/admin/users?query=${q}&page=1&page_size=20`);
      const items = result.data?.items || [];
      renderResultHtml("search-users-result", renderSearchResultCards(items), "等待查询", items.length ? "success" : "info");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("search-users-result", `查询失败：${err.message}`, "等待查询", "error");
    }
  });

  document.getElementById("open-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        tg: Number(document.getElementById("open-tg").value.trim()),
        name: document.getElementById("open-name").value.trim(),
        days: Number(document.getElementById("open-days").value.trim() || 30),
      };
      const result = await api("/webapp/admin/users/open", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderResultHtml("open-user-result", renderKeyValueResultCard("开通结果", {
        TG: result.data?.tg,
        用户名: result.data?.name,
        EmbyID: result.data?.embyid,
        到期时间: toDisplayTime(result.data?.expires_at),
      }), "等待开通", "success");
      showResultModal("已成功开通账户。", "success", "开通成功");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("open-user-result", `开通失败：${err.message}`, "等待开通", "error");
      showResultModal(`开通失败\n原因：${err.message}`, "error", "开通失败");
    }
  });

  document.getElementById("renew-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        query: document.getElementById("renew-query").value.trim(),
        days: Number(document.getElementById("renew-days").value.trim()),
      };
      const result = await api("/webapp/admin/users/renew", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderResultHtml("renew-user-result", renderKeyValueResultCard("续期结果", {
        TG: result.data?.tg,
        账户状态: result.data?.lv,
        到期时间: toDisplayTime(result.data?.expires_at),
      }), "等待续期", "success");
      showResultModal("账户续期已完成。", "success", "续期成功");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("renew-user-result", `续期失败：${err.message}`, "等待续期", "error");
      showResultModal(`续期失败\n原因：${err.message}`, "error", "续期失败");
    }
  });

  document.getElementById("ban-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        query: document.getElementById("ban-query").value.trim(),
        enable: document.getElementById("ban-enable").value === "true",
      };
      const result = await api("/webapp/admin/users/ban", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderResultHtml("ban-user-result", renderKeyValueResultCard("状态更新", {
        TG: result.data?.tg,
        当前等级: result.data?.lv,
        封禁状态: result.data?.disabled ? "已封禁" : "已解封",
      }), "等待执行", "success");
      showResultModal("账户状态更新成功。", "success", "操作成功");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("ban-user-result", `执行失败：${err.message}`, "等待执行", "error");
      showResultModal(`操作失败\n原因：${err.message}`, "error", "操作失败");
    }
  });

  document.getElementById("whitelist-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        query: document.getElementById("whitelist-query").value.trim(),
        enable: document.getElementById("whitelist-enable").value === "true",
      };
      const result = await api("/webapp/admin/users/whitelist", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderResultHtml("whitelist-user-result", renderKeyValueResultCard("白名单结果", {
        TG: result.data?.tg,
        当前等级: result.data?.lv,
      }), "等待执行", "success");
      showResultModal("白名单权限已更新。", "success", "操作成功");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("whitelist-user-result", `执行失败：${err.message}`, "等待执行", "error");
      showResultModal(`操作失败\n原因：${err.message}`, "error", "操作失败");
    }
  });

  document.getElementById("delete-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const query = encodeURIComponent(document.getElementById("delete-query").value.trim());
      const result = await api(`/webapp/admin/users/${query}`, { method: "DELETE" });
      renderResultHtml("delete-user-result", renderKeyValueResultCard("删除结果", {
        TG: result.data?.tg,
        删除状态: result.data?.deleted ? "已删除" : "失败",
      }), "等待删除", "success");
      showResultModal("账户删除成功。", "success", "删除成功");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("delete-user-result", `删除失败：${err.message}`, "等待删除", "error");
      showResultModal(`删除失败\n原因：${err.message}`, "error", "删除失败");
    }
  });

  document.getElementById("toggle-admin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        tg: Number(document.getElementById("admin-tg").value.trim()),
        enable: document.getElementById("admin-enable").value === "true",
      };
      const result = await api("/webapp/admin/admins/toggle", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderResult("toggle-admin-result", result.data || "操作成功", "等待执行", "success");
      showResultModal("管理员权限更新成功。", "success", "操作成功");
    } catch (err) {
      setNotice(err.message, true);
      renderResult("toggle-admin-result", `执行失败：${err.message}`, "等待执行", "error");
      showResultModal(`操作失败\n原因：${err.message}`, "error", "操作失败");
    }
  });

  const checkinSettingsForm = document.getElementById("checkin-settings-form");
  if (checkinSettingsForm) {
    checkinSettingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const payload = {
          enabled: document.getElementById("checkin-enabled").value === "true",
          level: document.getElementById("checkin-level").value,
        };
        const result = await api("/webapp/admin/settings/checkin", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderResult("checkin-settings-result", {
          签到状态: result.data?.enabled ? "开启" : "关闭",
          签到权限: checkinLevelLabel(result.data?.level),
          奖励区间: Array.isArray(result.data?.reward_range) ? `${result.data.reward_range[0]} - ${result.data.reward_range[1]}` : "-",
        }, "等待读取配置", "success");
        setNotice("签到设置已更新");
        showResultModal("签到设置已成功更新。", "success", "保存成功");
      } catch (err) {
        setNotice(err.message, true);
        renderResult("checkin-settings-result", `保存失败：${err.message}`, "等待读取配置", "error");
        showResultModal(`保存失败\n原因：${err.message}`, "error", "保存失败");
      }
    });
  }

  const bannerSettingsForm = document.getElementById("banner-settings-form");
  if (bannerSettingsForm) {
    bannerSettingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const payload = {
          enabled: document.getElementById("banner-enabled").value === "true",
          title: document.getElementById("banner-title").value.trim(),
          subtitle: document.getElementById("banner-subtitle").value.trim(),
          image_url: document.getElementById("banner-image-url").value.trim() || null,
          link_url: document.getElementById("banner-link-url").value.trim() || null,
        };
        const result = await api("/webapp/admin/settings/banner", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderResult("banner-settings-result", {
          广告状态: result.data?.enabled ? "开启" : "关闭",
          广告标题: result.data?.title || "-",
          图片地址: result.data?.image_url || "-",
          跳转链接: result.data?.link_url || "-",
        }, "等待读取配置", "success");
        renderHomepageBanner({ banner: result.data });
        setNotice("首页广告已更新");
        showResultModal("首页广告已更新。", "success", "保存成功");
      } catch (err) {
        setNotice(err.message, true);
        renderResult("banner-settings-result", `保存失败：${err.message}`, "等待读取配置", "error");
        showResultModal(`保存失败\n原因：${err.message}`, "error", "保存失败");
      }
    });
  }

}

function mapActivateError(message) {
  const mapping = {
    invalid_activate_method: "开通方式无效，请重试",
    user_not_found: "未找到用户记录，请稍后重试",
    user_already_has_emby: "你已拥有 Emby 账户",
    missing_activate_name: "请先输入 Emby 用户名",
    invalid_activate_name: "用户名格式不正确，请重新输入",
    invalid_safe_code: "安全码不能为空且不能包含空格，请按 bot 兼容规则输入",
    public_register_closed: "公开注册未开启",
    public_register_quota_reached: "公开注册名额已用完",
    no_register_credit: "没有可用注册码资格，请先使用注册码",
    points_exchange_disabled: "积分兑换未开启",
    invite_level_insufficient: "当前等级不足，无法积分兑换",
    insufficient_points: "积分不足，无法兑换开通",
    emby_create_failed: "开通失败，请稍后重试",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "开通失败";
}

function formatActivateSuccess(result, methodLabel = "开通") {
  const data = result?.data || {};
  return [
    `${methodLabel}成功`,
    `用户名：${data.name || "-"}`,
    `Emby密码：${data.password || "-"}`,
    `安全码：${data.safe_code || "-"}`,
    `到期时间：${toDisplayTime(data.expires_at)}`,
    "安全码仅用于敏感操作验证，不是 Emby 登录密码。",
  ];
}

function getActivateFormValues() {
  const name = document.getElementById("activate-name")?.value.trim() || "";
  const safeCode = document.getElementById("activate-safe-code")?.value.trim() || "";
  return { name, safeCode };
}

function clearActivateForm() {
  const nameInput = document.getElementById("activate-name");
  const safeCodeInput = document.getElementById("activate-safe-code");
  if (nameInput) nameInput.value = "";
  if (safeCodeInput) safeCodeInput.value = "";
}

function updateActivateSheet(profile = state.profile) {
  const hasAccount = Boolean(profile?.has_account);
  const moneyLabel = getMoneyLabel(profile);
  const userLevel = String(profile?.lv || "d");
  const points = Number(profile?.points ?? 0);
  const registerCredits = Number(profile?.register_credits ?? 0);

  const nameInput = document.getElementById("activate-name");
  const safeCodeInput = document.getElementById("activate-safe-code");
  const codeBtn = document.getElementById("activate-code-btn");
  const codeTitle = document.querySelector("#activate-code-btn .activate-option-title");

  if (nameInput) nameInput.disabled = hasAccount;
  if (safeCodeInput) safeCodeInput.disabled = hasAccount;
  if (codeTitle) {
    codeTitle.textContent = hasAccount
      ? "使用注册码"
      : registerCredits > 0
        ? "注册码开通"
        : "先兑换注册码";
  }

  const publicEnabled = Boolean(profile?.public_open_enabled ?? state.publicOpen.enabled);
  const publicDays = Number(profile?.public_open_days ?? state.publicOpen.days ?? 30);
  const publicLeft = Number(profile?.public_open_left ?? state.publicOpen.left ?? 0);
  const publicBtn = document.getElementById("activate-public-btn");
  const publicMeta = document.getElementById("activate-public-meta");
  if (publicMeta) {
    if (hasAccount) {
      publicMeta.textContent = "你已拥有账户，无需重复开通";
    } else if (!publicEnabled) {
      publicMeta.textContent = "管理员未开启公开注册";
    } else if (publicLeft <= 0) {
      publicMeta.textContent = "公开注册名额已用完";
    } else {
      publicMeta.textContent = `填写用户名和安全码后可开通 ${publicDays} 天，剩余名额 ${publicLeft}`;
    }
  }
  if (publicBtn) {
    publicBtn.disabled = hasAccount || !publicEnabled || publicLeft <= 0;
  }

  const codeMeta = document.getElementById("activate-code-meta");
  if (codeMeta) {
    if (hasAccount) {
      codeMeta.textContent = "你已拥有账户，请在兑换中心使用续期码";
    } else if (registerCredits > 0) {
      codeMeta.textContent = `你有 ${registerCredits} 天注册码资格，填写用户名和安全码后即可开通`;
    } else {
      codeMeta.textContent = "先输入注册码换取资格，再回来填写用户名和安全码完成开通";
    }
  }
  if (codeBtn) {
    codeBtn.disabled = hasAccount;
  }

  const inviteEnabled = Boolean(profile?.invite_enabled ?? state.invite.enabled);
  const inviteLevel = String(profile?.invite_level ?? state.invite.level ?? "b");
  const inviteCost = Number(profile?.invite_cost ?? state.invite.cost ?? 1000);
  const pointsBtn = document.getElementById("activate-points-btn");
  const pointsMeta = document.getElementById("activate-points-meta");
  const levelAllowed = userLevel <= inviteLevel;
  const pointsEnough = points >= inviteCost;
  if (pointsMeta) {
    if (hasAccount) {
      pointsMeta.textContent = "你已拥有账户，无需积分兑换开通";
    } else if (!inviteEnabled) {
      pointsMeta.textContent = "管理员未开启积分兑换";
    } else if (!levelAllowed) {
      pointsMeta.textContent = "当前账号等级不足，无法积分兑换";
    } else if (!pointsEnough) {
      pointsMeta.textContent = `需要 ${inviteCost}${moneyLabel}，当前仅有 ${points}${moneyLabel}`;
    } else {
      pointsMeta.textContent = `填写用户名和安全码后，消耗 ${inviteCost}${moneyLabel} 开通 ${publicDays} 天`;
    }
  }
  if (pointsBtn) {
    pointsBtn.disabled = hasAccount || !inviteEnabled || !levelAllowed || !pointsEnough;
  }
}

/* Legacy duplicated activation/redeem flow kept for reference only.
   Disabled to avoid duplicate bindings and double wrapping.
function rebindNode(selector) {
  const oldNode = document.querySelector(selector);
  if (!oldNode) return null;
  const newNode = oldNode.cloneNode(true);
  oldNode.replaceWith(newNode);
  return newNode;
}

function patchActivateFlowBindings() {
  const submitActivate = async (method, methodLabel) => {
    const { name, safeCode } = getActivateFormValues();
    if (!name) {
      showResultModal("请先输入 Emby 用户名。", "info", "资料未填写");
      return;
    }
    if (!/^\d{4,6}$/.test(safeCode)) {
      showResultModal("安全码不能为空且不能包含空格。", "info", "安全码格式不正确");
      return;
    }

    const publicBtn = document.getElementById("activate-public-btn");
    const codeBtn = document.getElementById("activate-code-btn");
    const pointsBtn = document.getElementById("activate-points-btn");
    if (publicBtn) publicBtn.disabled = true;
    if (codeBtn) codeBtn.disabled = true;
    if (pointsBtn) pointsBtn.disabled = true;

    try {
      const result = await api("/webapp/user/activate", {
        method: "POST",
        body: JSON.stringify({ method, name, safe_code: safeCode }),
      });
      const lines = formatActivateSuccess(result, methodLabel);
      renderResult("activate-sheet-result", lines, "等待操作", "success");
      showResultModal(lines.join("\n"), "success", "开通成功");
      clearActivateForm();
      await loadUserStatus();
      closeActivateSheet();
    } catch (err) {
      const reason = mapActivateError(err.message);
      renderResult("activate-sheet-result", `开通失败：${reason}`, "等待操作", "error");
      showResultModal(`开通失败\n原因：${reason}`, "error", "开通失败");
      updateActivateSheet();
    }
  };

  const activatePublicBtn = rebindNode("#activate-public-btn");
  if (activatePublicBtn) {
    activatePublicBtn.addEventListener("click", async () => {
      await submitActivate("public", "公开注册");
    });
  }

  const activatePointsBtn = rebindNode("#activate-points-btn");
  if (activatePointsBtn) {
    activatePointsBtn.addEventListener("click", async () => {
      await submitActivate("points", "积分兑换");
    });
  }

  const activateCodeBtn = rebindNode("#activate-code-btn");
  if (activateCodeBtn) {
    activateCodeBtn.addEventListener("click", async () => {
      const registerCredits = Number(state.profile?.register_credits ?? 0);
      if (registerCredits > 0) {
        await submitActivate("credit", "注册码开通");
        return;
      }
      closeActivateSheet();
      openRedeemSheet();
    });
  }

  const redeemForm = rebindNode("#redeem-sheet-form");
  if (redeemForm) {
    redeemForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (getRenewMode() === "points") {
        showResultModal("当前续期方式为积分续期，请点击“立即续期”按钮。", "info", "续期方式已切换");
        return;
      }
      try {
        const verified = await executeRedeemTurnstileVerify("兑换");
        if (!verified) return;
        const code = document.getElementById("redeem-sheet-code").value.trim();
        const result = await api("/webapp/user/redeem", {
          method: "POST",
          body: JSON.stringify({ code, turnstile_token: state.turnstile.redeemToken }),
        });

        if (result.message === "register_credit_added" && !state.profile?.has_account) {
          const successText = "注册码使用成功，请继续填写用户名和安全码完成开通。";
          renderResult("redeem-sheet-result", successText, "等待兑换", "success");
          renderResult("activate-sheet-result", successText, "等待操作", "info");
          showResultModal(successText, "success", "注册码已生效");
          document.getElementById("redeem-sheet-code").value = "";
          closeRedeemSheet();
          await loadUserStatus();
          openActivateSheet();
          return;
        }

        const successText = result.message === "renewed"
          ? "续期成功，请返回账户总览查看最新状态。"
          : result.message === "register_credit_added"
            ? "注册码使用成功，请在“启用 Emby”中继续开通。"
            : "兑换成功，请返回账户总览查看最新状态。";
        renderResult("redeem-sheet-result", result.data || successText, "等待兑换", "success");
        setNotice("兑换成功");
        showResultModal(successText, "success", "兑换成功");
        document.getElementById("redeem-sheet-code").value = "";
        closeRedeemSheet();
        await loadUserStatus();
    } catch (err) {
      const reason = mapRedeemError(err.message);
      setNotice(reason, true);
      renderResult("redeem-sheet-result", `兑换失败：${reason}`, "等待兑换", "error");
      showResultModal(`兑换失败\n原因：${reason}`, "error", "兑换失败");
    } finally {
      if (state.turnstile.enabled) resetRedeemTurnstileWidget();
    }
  });
  }
}

const originalLoadUserStatus = loadUserStatus;
loadUserStatus = async function (...args) {
  const result = await originalLoadUserStatus.apply(this, args);
  const accountTitles = document.querySelectorAll("#user-status-data .home-service-line:last-of-type .home-service-row-title");
  if (accountTitles[1]) {
    accountTitles[1].textContent = "Emby 密码";
  }
  const accountMeta = document.querySelector("#user-status-data .home-service-line:last-of-type .home-checkin-meta");
  if (accountMeta) {
    accountMeta.textContent = "上方为 Emby 登录密码；安全码仅用于敏感操作验证，不是 Emby 登录密码。";
  }
  return result;
};
*/

function mapActivateError(message) {
  const mapping = {
    invalid_activate_method: "开通方式无效，请重试",
    user_not_found: "未找到用户记录，请稍后重试",
    user_already_has_emby: "你已拥有 Emby 账户",
    already_has_register_credit: "你已拥有注册资格，请直接填写注册信息",
    missing_activate_name: "请先输入 Emby 用户名",
    invalid_activate_name: "用户名不能包含空格，请按 bot 规则重新输入",
    invalid_safe_code: "安全码不能为空且不能包含空格，请按 bot 兼容规则输入",
    public_register_closed: "公开注册未开启",
    public_register_quota_reached: "公开注册名额已用完",
    no_register_credit: "还没有可用资格，请先获取注册资格",
    points_exchange_disabled: "积分兑换未开启",
    invite_level_insufficient: "当前等级不足，无法积分兑换",
    insufficient_points: "积分不足，无法兑换开通",
    emby_create_failed: "注册失败，请检查用户名是否重复或包含 Emby 不支持的字符",
    missing_authorization: "登录状态失效，请重新打开小程序",
  };
  return mapping[message] || message || "开通失败";
}

function formatActivateSuccess(result, methodLabel = "注册") {
  const data = result?.data || {};
  return [
    `${methodLabel}成功`,
    `用户名：${data.name || "-"}`,
    `Emby密码：${data.password || "-"}`,
    `安全码：${data.safe_code || "-"}`,
    `到期时间：${toDisplayTime(data.expires_at)}`,
    "安全码仅用于敏感操作验证，不是 Emby 登录密码。",
  ];
}

function getActivateFormValues() {
  const name = document.getElementById("activate-register-name")?.value.trim() || "";
  const safeCode = document.getElementById("activate-register-safe-code")?.value.trim() || "";
  return { name, safeCode };
}

function clearActivateForm() {
  const nameInput = document.getElementById("activate-register-name");
  const safeCodeInput = document.getElementById("activate-register-safe-code");
  if (nameInput) nameInput.value = "";
  if (safeCodeInput) safeCodeInput.value = "";
}

function openActivateRegisterSheet() {
  const sheet = document.getElementById("activate-register-sheet");
  const panel = document.querySelector("#activate-register-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  updateRegisterSheet();
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  syncSheetScrollLock();
}

function closeActivateRegisterSheet() {
  const sheet = document.getElementById("activate-register-sheet");
  const panel = document.querySelector("#activate-register-sheet .redeem-sheet-panel");
  if (!sheet) return;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
  }
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  syncSheetScrollLock();
}

function updateRegisterSheet(profile = state.profile) {
  const hasAccount = Boolean(profile?.has_account);
  const registerCredits = Number(profile?.register_credits ?? 0);
  const metaEl = document.getElementById("activate-register-meta");
  const submitBtn = document.getElementById("activate-register-submit");
  const nameInput = document.getElementById("activate-register-name");
  const safeCodeInput = document.getElementById("activate-register-safe-code");
  const tgUser = state.me?.tg_user || {};
  const defaultName = String(tgUser.username || tgUser.first_name || "").trim();

  if (nameInput && !nameInput.value && defaultName) {
    nameInput.value = defaultName.replace(/\s+/g, "");
  }

  if (metaEl) {
    if (hasAccount) {
      metaEl.textContent = "你已拥有 Emby 账户，无需重复注册。";
    } else if (registerCredits > 0) {
      metaEl.textContent = `当前可用注册资格：${registerCredits} 天。用户名支持中英文和 emoji，请勿带空格；安全码按 bot 兼容处理，请勿带空格。`;
    } else {
      metaEl.textContent = "请先获取注册资格。";
    }
  }

  if (nameInput) nameInput.disabled = hasAccount || registerCredits <= 0;
  if (safeCodeInput) safeCodeInput.disabled = hasAccount || registerCredits <= 0;
  if (submitBtn) submitBtn.disabled = hasAccount || registerCredits <= 0;
}

function updateActivateSheet(profile = state.profile) {
  const hasAccount = Boolean(profile?.has_account);
  const moneyLabel = getMoneyLabel(profile);
  const userLevel = String(profile?.lv || "d");
  const points = Number(profile?.points ?? 0);
  const registerCredits = Number(profile?.register_credits ?? 0);
  const publicEnabled = Boolean(profile?.public_open_enabled ?? state.publicOpen.enabled);
  const publicDays = Number(profile?.public_open_days ?? state.publicOpen.days ?? 30);
  const publicLeft = Number(profile?.public_open_left ?? state.publicOpen.left ?? 0);
  const publicBtn = document.getElementById("activate-public-btn");
  const publicMeta = document.getElementById("activate-public-meta");
  const codeBtn = document.getElementById("activate-code-btn");
  const codeMeta = document.getElementById("activate-code-meta");
  const codeTitle = document.querySelector("#activate-code-btn .activate-option-title");
  const inviteEnabled = Boolean(profile?.invite_enabled ?? state.invite.enabled);
  const inviteLevel = String(profile?.invite_level ?? state.invite.level ?? "b");
  const inviteCost = Number(profile?.invite_cost ?? state.invite.cost ?? 1000);
  const pointsBtn = document.getElementById("activate-points-btn");
  const pointsMeta = document.getElementById("activate-points-meta");
  const levelAllowed = userLevel <= inviteLevel;
  const pointsEnough = points >= inviteCost;
  const hasCredit = registerCredits > 0;

  if (publicMeta) {
    if (hasAccount) {
      publicMeta.textContent = "你已拥有账户，无需重复获取资格";
    } else if (hasCredit) {
      publicMeta.textContent = "你已拥有注册资格，请直接填写注册信息";
    } else if (!publicEnabled) {
      publicMeta.textContent = "管理员未开启公开注册";
    } else if (publicLeft <= 0) {
      publicMeta.textContent = "公开注册名额已用完";
    } else {
      publicMeta.textContent = `领取 ${publicDays} 天注册资格，剩余名额 ${publicLeft}`;
    }
  }
  if (publicBtn) {
    publicBtn.disabled = hasAccount || hasCredit || !publicEnabled || publicLeft <= 0;
  }

  if (codeTitle) {
    codeTitle.textContent = hasCredit ? "填写注册信息" : "使用注册码";
  }
  if (codeMeta) {
    if (hasAccount) {
      codeMeta.textContent = "你已拥有账户，请在兑换中心使用续期码";
    } else if (hasCredit) {
      codeMeta.textContent = `你已获得 ${registerCredits} 天资格，点此填写用户名和安全码`;
    } else {
      codeMeta.textContent = "先兑换注册码拿到资格，再填写用户名和安全码";
    }
  }
  if (codeBtn) {
    codeBtn.disabled = hasAccount;
  }

  if (pointsMeta) {
    if (hasAccount) {
      pointsMeta.textContent = "你已拥有账户，无需积分兑换资格";
    } else if (hasCredit) {
      pointsMeta.textContent = "你已拥有注册资格，请直接填写注册信息";
    } else if (!inviteEnabled) {
      pointsMeta.textContent = "管理员未开启积分兑换";
    } else if (!levelAllowed) {
      pointsMeta.textContent = "当前账号等级不足，无法积分兑换";
    } else if (!pointsEnough) {
      pointsMeta.textContent = `需要 ${inviteCost}${moneyLabel}，当前仅有 ${points}${moneyLabel}`;
    } else {
      pointsMeta.textContent = `消耗 ${inviteCost}${moneyLabel} 领取 ${publicDays} 天注册资格`;
    }
  }
  if (pointsBtn) {
    pointsBtn.disabled = hasAccount || hasCredit || !inviteEnabled || !levelAllowed || !pointsEnough;
  }
}

function rebindNode(selector) {
  const oldNode = document.querySelector(selector);
  if (!oldNode) return null;
  const newNode = oldNode.cloneNode(true);
  oldNode.replaceWith(newNode);
  return newNode;
}

function syncFloatingNoAccountAlert(profile = state.profile) {
  const floatingAlert = document.getElementById("floating-no-account-alert");
  const homeView = document.getElementById("user-status");
  if (!floatingAlert) return;
  const shouldShow = Boolean(profile) && !profile?.has_account && homeView?.classList.contains("active");
  floatingAlert.classList.toggle("hidden", !shouldShow);
}

let activateRegisterSheetUiBound = false;
function bindActivateRegisterSheetUi() {
  if (activateRegisterSheetUiBound) return;
  activateRegisterSheetUiBound = true;

  bindSheetDragToClose(
    "#activate-register-sheet",
    "#activate-register-sheet .redeem-sheet-handle",
    "#activate-register-sheet .redeem-sheet-panel",
    closeActivateRegisterSheet
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeActivateRegisterSheet();
    }
  });
}

function patchActivateFlowBindings() {
  const submitQualification = async (method, methodLabel) => {
    const publicBtn = document.getElementById("activate-public-btn");
    const codeBtn = document.getElementById("activate-code-btn");
    const pointsBtn = document.getElementById("activate-points-btn");
    if (publicBtn) publicBtn.disabled = true;
    if (codeBtn) codeBtn.disabled = true;
    if (pointsBtn) pointsBtn.disabled = true;

    try {
      const result = await api("/webapp/user/activate", {
        method: "POST",
        body: JSON.stringify({ method }),
      });

      if (result.message === "register_credit_added") {
        const successText = `${methodLabel}资格已到账，请继续填写用户名和安全码完成注册。`;
        renderResult("activate-sheet-result", {
          获取方式: methodLabel,
          本次资格: `${result.data?.days || "-"} 天`,
          当前资格: `${result.data?.register_credits_left || result.data?.credit || "-"} 天`,
        }, "等待操作", "success");
        showResultModal(successText, "success", "资格获取成功");
        await loadUserStatus();
        closeActivateSheet();
        openActivateRegisterSheet();
        return;
      }
    } catch (err) {
      const reason = mapActivateError(err.message);
      renderResult("activate-sheet-result", `资格获取失败：${reason}`, "等待操作", "error");
      showResultModal(`资格获取失败\n原因：${reason}`, "error", "资格获取失败");
      updateActivateSheet();
    }
  };

  const submitRegister = async () => {
    const { name, safeCode } = getActivateFormValues();
    if (!name) {
      showResultModal("请先输入 Emby 用户名。", "info", "资料未填写");
      return;
    }
    if (/\s/.test(name)) {
      showResultModal("用户名不能包含空格，请按 bot 的输入方式填写。", "info", "用户名格式不正确");
      return;
    }
    if (!safeCode || /\s/.test(safeCode)) {
      showResultModal("安全码不能为空且不能包含空格。", "info", "安全码格式不正确");
      return;
    }

    const submitBtn = document.getElementById("activate-register-submit");
    if (submitBtn) submitBtn.disabled = true;

    try {
      const result = await api("/webapp/user/activate", {
        method: "POST",
        body: JSON.stringify({ method: "credit", name, safe_code: safeCode }),
      });
      const lines = formatActivateSuccess(result, "注册");
      renderResult("activate-register-result", lines, "等待提交", "success");
      showResultModal(lines.join("\n"), "success", "注册成功");
      clearActivateForm();
      await loadUserStatus();
      closeActivateRegisterSheet();
    } catch (err) {
      const reason = mapActivateError(err.message);
      renderResult("activate-register-result", `注册失败：${reason}`, "等待提交", "error");
      showResultModal(`注册失败\n原因：${reason}`, "error", "注册失败");
      updateRegisterSheet();
    } finally {
      updateRegisterSheet();
    }
  };

  const activatePublicBtn = rebindNode("#activate-public-btn");
  if (activatePublicBtn) {
    activatePublicBtn.addEventListener("click", async () => {
      await submitQualification("public", "公开注册");
    });
  }

  const activatePointsBtn = rebindNode("#activate-points-btn");
  if (activatePointsBtn) {
    activatePointsBtn.addEventListener("click", async () => {
      await submitQualification("points", "积分兑换");
    });
  }

  const activateCodeBtn = rebindNode("#activate-code-btn");
  if (activateCodeBtn) {
    activateCodeBtn.addEventListener("click", async () => {
      const registerCredits = Number(state.profile?.register_credits ?? 0);
      if (registerCredits > 0) {
        closeActivateSheet();
        openActivateRegisterSheet();
        return;
      }
      closeActivateSheet();
      openRedeemSheet();
    });
  }

  const redeemForm = rebindNode("#redeem-sheet-form");
  if (redeemForm) {
    redeemForm.addEventListener("submit", async (e) => {
      e.preventDefault();
    try {
      const verified = await executeRedeemTurnstileVerify("兑换");
      if (!verified) return;
      const code = document.getElementById("redeem-sheet-code").value.trim();
      const result = await api("/webapp/user/redeem", {
        method: "POST",
        body: JSON.stringify({ code, turnstile_token: state.turnstile.redeemToken }),
      });

        if (result.message === "register_credit_added" && !state.profile?.has_account) {
          const successText = "注册码使用成功，请继续填写用户名和安全码完成注册。";
          renderResult("redeem-sheet-result", successText, "等待兑换", "success");
          showResultModal(successText, "success", "注册码已生效");
          document.getElementById("redeem-sheet-code").value = "";
          closeRedeemSheet();
          await loadUserStatus();
          openActivateRegisterSheet();
          return;
        }

        const successText = result.message === "renewed"
          ? "续期成功，请返回账户总览查看最新状态。"
          : result.message === "register_credit_added"
            ? "注册码使用成功，请在“启用 Emby”中继续开通。"
            : "兑换成功，请返回账户总览查看最新状态。";
        renderResult("redeem-sheet-result", result.data || successText, "等待兑换", "success");
        setNotice("兑换成功");
        showResultModal(successText, "success", "兑换成功");
        document.getElementById("redeem-sheet-code").value = "";
        closeRedeemSheet();
        await loadUserStatus();
    } catch (err) {
      const reason = mapRedeemError(err.message);
      setNotice(reason, true);
      renderResult("redeem-sheet-result", `兑换失败：${reason}`, "等待兑换", "error");
      showResultModal(`兑换失败\n原因：${reason}`, "error", "兑换失败");
    } finally {
      if (state.turnstile.enabled) resetRedeemTurnstileWidget();
    }
  });
  }

  const registerForm = rebindNode("#activate-register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submitRegister();
    });
  }

  document.querySelectorAll("#activate-register-sheet [data-action='close-register']").forEach((node) => {
    node.addEventListener("click", () => {
      closeActivateRegisterSheet();
    });
  });
}

const patchedOriginalOpenActivateSheet = openActivateSheet;
openActivateSheet = function (...args) {
  if (!state.profile?.has_account && Number(state.profile?.register_credits ?? 0) > 0) {
    openActivateRegisterSheet();
    return;
  }
  return patchedOriginalOpenActivateSheet.apply(this, args);
};

const patchedLoadUserStatusBase = loadUserStatus;
loadUserStatus = async function (...args) {
  const result = await patchedLoadUserStatusBase.apply(this, args);
  document.querySelector("#user-status-data .home-alert")?.remove();
  const accountTitles = document.querySelectorAll("#user-status-data .home-service-line:last-of-type .home-service-row-title");
  if (accountTitles[1]) {
    accountTitles[1].textContent = "Emby 密码";
  }
  const accountMeta = document.querySelector("#user-status-data .home-service-line:last-of-type .home-checkin-meta");
  if (accountMeta) {
    accountMeta.textContent = "上方为 Emby 登录密码；安全码仅用于敏感操作验证，不是 Emby 登录密码。";
  }
  updateRegisterSheet();
  syncFloatingNoAccountAlert();
  return result;
};

const patchedOriginalShowView = showView;
showView = function (...args) {
  const result = patchedOriginalShowView.apply(this, args);
  syncFloatingNoAccountAlert();
  return result;
};

// Renew center behavior override:
// 1) three tabs in one row: code / points / activity
// 2) code is always available
// 3) points & activity availability follow bot settings
function getRedeemPendingText(profile = state.profile) {
  const tab = getRedeemActiveTab(profile);
  if (tab === "points") return "等待续期";
  if (tab === "activity") return "等待保号";
  return "等待兑换";
}

function setRedeemActiveTab(tab, profile = state.profile) {
  const raw = String(tab || "").toLowerCase();
  let next = "code";
  if (raw === "points") next = "points";
  if (raw === "activity") next = "activity";

  const hasAccount = Boolean(profile?.has_account);
  const pointsEnabled = Boolean(profile?.renew_points_enabled ?? state.renew.pointsEnabled);
  const activityEnabled = Boolean(profile?.renew_low_activity_enabled ?? state.renew.lowActivityEnabled);

  if (!hasAccount && next !== "code") next = "code";
  if (next === "points" && !pointsEnabled) next = "code";
  if (next === "activity" && !activityEnabled) next = "code";

  state.renew.activeTab = next;
  updateRenewSheet(profile);
}

function updateRenewSheet(profile = state.profile) {
  const titleEl = document.getElementById("redeem-sheet-title");
  const descEl = document.querySelector("#redeem-sheet .redeem-sheet-desc");
  const modeCodeBtn = document.getElementById("redeem-mode-code-btn");
  const modePointsBtn = document.getElementById("redeem-mode-points-btn");
  const modeActivityBtn = document.getElementById("redeem-mode-activity-btn");
  const modeWrap = document.getElementById("redeem-mode-switch");
  const formEl = document.getElementById("redeem-sheet-form");
  const pointsWrap = document.getElementById("redeem-points-actions");
  const activityWrap = document.getElementById("redeem-activity-actions");
  const pointsMetaEl = document.getElementById("redeem-points-meta");
  const activityMetaEl = document.getElementById("redeem-activity-meta");
  const pointsBtn = document.getElementById("redeem-points-btn");
  const redeemTurnstileWrap = document.getElementById("redeem-turnstile-wrap");

  const hasAccount = Boolean(profile?.has_account);
  const moneyLabel = getMoneyLabel(profile);
  const codeEnabled = Boolean(profile?.renew_code_enabled ?? state.renew.codeEnabled ?? true);
  const pointsEnabled = Boolean(profile?.renew_points_enabled ?? state.renew.pointsEnabled);
  const pointsCost = Number(profile?.renew_points_cost ?? state.renew.pointsCost ?? 300);
  const pointsDays = Number(profile?.renew_points_days ?? state.renew.pointsDays ?? 30);
  const checkExEnabled = Boolean(profile?.renew_check_ex_enabled ?? state.renew.checkExEnabled);
  const lowActivityEnabled = Boolean(profile?.renew_low_activity_enabled ?? state.renew.lowActivityEnabled);
  const activityCheckDays = Number(profile?.renew_activity_check_days ?? state.renew.activityCheckDays ?? 30);
  const points = Number(profile?.points ?? 0);

  let mode = getRedeemActiveTab(profile);
  if (mode === "points" && (!hasAccount || !pointsEnabled)) mode = "code";
  if (mode === "activity" && (!hasAccount || !lowActivityEnabled)) mode = "code";
  state.renew.activeTab = mode;

  if (titleEl) titleEl.textContent = "续费中心";
  if (descEl) {
    const policy = `续期码：开启；积分续期：${pointsEnabled ? "开启" : "关闭"}；活跃续期：${lowActivityEnabled ? "开启" : "关闭"}`;
    if (mode === "points") {
      descEl.textContent = `按管理员规则消耗积分续期。${policy}`;
    } else if (mode === "activity") {
      descEl.textContent = `活跃续期由 Bot 定时任务自动保号。${policy}`;
    } else {
      descEl.textContent = `输入兑换码后立即生效，注册码和续期码均支持。${policy}`;
    }
  }

  if (modeWrap) modeWrap.hidden = false;
  if (modeCodeBtn) {
    modeCodeBtn.classList.toggle("active", mode === "code");
    modeCodeBtn.setAttribute("aria-pressed", mode === "code" ? "true" : "false");
    modeCodeBtn.disabled = !codeEnabled;
  }
  if (modePointsBtn) {
    modePointsBtn.classList.toggle("active", mode === "points");
    modePointsBtn.setAttribute("aria-pressed", mode === "points" ? "true" : "false");
    modePointsBtn.disabled = !hasAccount || !pointsEnabled;
  }
  if (modeActivityBtn) {
    modeActivityBtn.classList.toggle("active", mode === "activity");
    modeActivityBtn.setAttribute("aria-pressed", mode === "activity" ? "true" : "false");
    modeActivityBtn.disabled = !hasAccount || !lowActivityEnabled;
  }

  if (formEl) formEl.hidden = mode !== "code";
  if (pointsWrap) pointsWrap.hidden = mode !== "points";
  if (activityWrap) activityWrap.hidden = mode !== "activity";

  const shouldShowRedeemTurnstile = mode === "code" || mode === "points";
  if (redeemTurnstileWrap) {
    if (!state.turnstile.enabled || !state.turnstile.siteKey || !shouldShowRedeemTurnstile) {
      redeemTurnstileWrap.classList.add("hidden");
    } else {
      redeemTurnstileWrap.classList.remove("hidden");
    }
  }

  let tip = `消耗 ${pointsCost}${moneyLabel} 可续期 ${pointsDays} 天。`;
  let canRenew = hasAccount && pointsEnabled && points >= pointsCost;
  if (!hasAccount) {
    tip = "你还没有 Emby 账户，暂时无法续期。";
    canRenew = false;
  } else if (!pointsEnabled) {
    tip = "管理员未开启积分续期。";
    canRenew = false;
  } else if (points < pointsCost) {
    tip = `积分不足，需要 ${pointsCost}${moneyLabel}，当前仅有 ${points}${moneyLabel}。`;
    canRenew = false;
  }
  if (pointsMetaEl) pointsMetaEl.textContent = tip;
  if (pointsBtn) {
    pointsBtn.disabled = !canRenew;
    pointsBtn.textContent = "立即续期";
  }

  if (activityMetaEl) {
    if (!hasAccount) {
      activityMetaEl.textContent = "你还没有 Emby 账户，暂时无法使用活跃续期。";
    } else if (!lowActivityEnabled) {
      activityMetaEl.textContent = "管理员未开启活跃续期（低活跃检测）。";
    } else {
      const checkExText = checkExEnabled ? "到期检测已开启" : "到期检测未开启";
      activityMetaEl.textContent = `活跃续期已开启（${activityCheckDays}天活跃检测）。${checkExText}。该模式由 Bot 定时任务自动执行，无需手动提交。`;
    }
  }
}

async function bootstrap() {
  try {
    syncTurnstileLayoutMode();
    bindSidebar();
    bindResultModal();
    bindForms();
    patchActivateFlowBindings();
    bindActivateRegisterSheetUi();
    renderResult("redeem-sheet-result", null, "等待兑换");
    renderResult("activate-sheet-result", null, "等待操作");
    renderResult("activate-register-result", null, "等待提交");
    renderResult("invite-sheet-result", null, "等待兑换");
    renderResult("checkin-result", null, "加载中...");
    renderResult("search-users-result", null, "等待查询");
    renderResult("open-user-result", null, "等待开通");
    renderResult("renew-user-result", null, "等待续期");
    renderResult("ban-user-result", null, "等待执行");
    renderResult("whitelist-user-result", null, "等待执行");
    renderResult("delete-user-result", null, "等待删除");
    renderResult("toggle-admin-result", null, "等待执行");
    renderResult("checkin-settings-result", null, "等待读取配置");
    renderResult("banner-settings-result", null, "等待读取配置");
    await loginWithTelegram();
    await loadHomepageConfig();
    await loadUserStatus();
    await loadCheckinSettings();
    await loadBannerSettings();
    applyInitialPanelView();
    setNotice("");
  } catch (err) {
    setNotice(err.message, true);
    document.getElementById("user-status-data").textContent = `初始化失败: ${err.message}`;
  }
}

bootstrap();
