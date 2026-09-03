const FENGYU_NEXTCLOUD_BASE = "https://ncaio.fengyu.com.tw/f/8988";
/**
 * 技術會議雲端儀表板 (Technical Meeting Cloud Dashboard) - 前端核心邏輯
 * 具備：
 * 1. 5 欄工作日 Google 日曆模式（六日隱藏，全月份同步與 Google 日曆切換）
 * 2. 9 大專案作業區（已移除東仁、億載、Wuma、佛教堂等非技術會議專案）
 * 3. 補齊新纖南港總部 26 筆待辦事項與全工區精準匹配
 * 4. 各專案技術議題管控表比照待辦事項表格顯示（預定產出日期篩選、固定表頭、4大KPI指標統計）
 * 5. 全域搜尋引擎（資料清洗去重 -> 結構化歸納 -> 智能總結 -> 精準深層跳轉）
 * 6. 多人在線 Heartbeat 15 秒不斷線心跳保活
 */

// 全域狀態
let appData = null;
let sessionToken = sessionStorage.getItem("nas_session_token");
let currentUser = null;
let heartbeatInterval = null;
let currentViewName = "總覽首頁";
let currentCalYear = 2026;
let currentCalMonth = 9;
let activeSearchType = "all";
let currentDrawerProject = null;
let currentControlFilterMode = "due"; // 'due', 'all', 'no_assignee', 'no_deliverable'
let currentControlSearchText = "";

// DOM 元件快取
const loginModal = document.getElementById("login-modal");
const appContainer = document.getElementById("app-container");
const loginForm = document.getElementById("login-form");
const loginAccountInput = document.getElementById("login-username") || document.getElementById("login-account");
const loginPinInput = document.getElementById("login-password") || document.getElementById("login-pin");
const loginError = document.getElementById("login-error-msg") || document.getElementById("login-error");
const btnLogout = document.getElementById("btn-logout");
const displayUserName = document.getElementById("display-user-name");
const displayUserDept = document.getElementById("display-user-dept");
const userAvatarIcon = document.getElementById("user-avatar-icon");
const headerOnlineCount = document.getElementById("header-online-count");
const btnOpenPresence = document.getElementById("btn-open-presence");

const navTabs = document.querySelectorAll(".nav-tab");
const tabPanes = document.querySelectorAll(".tab-pane");
const subnavBtns = document.querySelectorAll(".subnav-btn");
const subpanes = document.querySelectorAll(".subpane");

const projectModal = document.getElementById("project-modal");
const drawerCloseBtn = document.getElementById("drawer-close-btn");
const drawerTabs = document.querySelectorAll(".drawer-tab-btn");

const fileViewerModal = document.getElementById("file-viewer-modal");
const viewerCloseBtn = document.getElementById("viewer-close-btn");

// 常用工區名稱標準化比對器
function normalizeSiteName(name) {
  if (!name) return "";
  const s = String(name).trim();
  if (s.includes("新纖") || s.includes("新光合纖")) return "新光合纖南港";
  if (s.includes("公西")) return "公西檔案庫房";
  if (s.includes("崇明")) return "台南崇明商場";
  if (s.includes("朴子")) return "朴子安居";
  if (s.includes("坤門")) return "坤門安居";
  if (s.includes("平實")) return "平實安居";
  if (s.includes("立行")) return "立行倉儲物流";
  if (s.includes("中油")) return "中油綠能";
  if (s.includes("CDC") || s.includes("防疫")) return "CDC防疫中心";
  return s;
}

// 格式化為標準西曆 (YYYY/MM/DD)
function formatWesternDate(val) {
  if (!val) return '-';
  const s = String(val).trim();
  if (!s || s === '-' || s === '0') return '-';
  if (/^\d{5}$/.test(s)) {
    try {
      const serial = parseInt(s, 10);
      const dt = new Date((serial - 25569) * 86400 * 1000);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}/${m}/${d}`;
    } catch(e) {}
  }
  return s.replace(/-/g, '/');
}

// ==============================================================================
// 1. 初始化與 NAS 權限驗證
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initNavigations();
  initLoginHandler();
  initCalendarNavigation();
  initViewerModal();
  initMonthlyReportTabs();

  // 預設以工程同仁身分直接解鎖並載入儀表板，不阻擋使用者瀏覽
  const savedUser = sessionStorage.getItem("nas_user_profile");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
    }
  }

  if (!currentUser) {
    currentUser = {
      username: "ganmen",
      name: "工程部同仁",
      dept: "工程技術部",
      role: "admin",
      avatar: "fa-helmet-safety"
    };
    sessionStorage.setItem("nas_user_profile", JSON.stringify(currentUser));
  }

  sessionToken = sessionStorage.getItem("nas_session_token") || ("auto_token_" + Date.now());
  sessionStorage.setItem("nas_session_token", sessionToken);

  applyUserUI(currentUser);
  if (loginModal) loginModal.classList.add("hidden");
  if (appContainer) appContainer.classList.remove("blur-locked");

  startHeartbeat();
  await loadDashboardData();
});

function showLoginForm() {
  loginModal.classList.remove("hidden");
  appContainer.classList.add("blur-locked");
  if (loginAccountInput) loginAccountInput.focus();
}

function initLoginHandler() {
  // 快速登入標籤點擊監聽
  document.querySelectorAll(".quick-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const user = pill.dataset.user || "engineer";
      const pwd = pill.dataset.pwd || "nas2026";
      if (loginAccountInput) loginAccountInput.value = user;
      if (loginPinInput) loginPinInput.value = pwd;
      if (loginForm) loginForm.requestSubmit();
    });
  });

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (loginError) loginError.classList.add("hidden");

      const username = loginAccountInput ? loginAccountInput.value.trim() : "";
      const pin = loginPinInput ? loginPinInput.value.trim() : "";

      if (!username) {
        showLoginError("請輸入員工帳號或電子郵件");
        return;
      }

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, pin })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.status === "success" && data.token) {
            sessionToken = data.token;
            currentUser = data.user;
            sessionStorage.setItem("nas_session_token", sessionToken);
            sessionStorage.setItem("nas_user_profile", JSON.stringify(currentUser));

            applyUserUI(currentUser);
            loginModal.classList.add("hidden");
            appContainer.classList.remove("blur-locked");
            startHeartbeat();
            await loadDashboardData();
            return;
          }
        }
      } catch (err) {
        console.debug("Backend API login unavailable (static GitHub Pages mode), switching to client validation");
      }

      // 靜態 GitHub Pages 模式或離線驗證：支援任意帳號或快速按鈕直接解鎖
      let displayName = username;
      if (username.includes("@")) {
        displayName = username.split("@")[0];
      }
      let deptName = "工程技術部";
      let roleName = "engineer";
      let avatarIcon = "fa-helmet-safety";

      if (username.toLowerCase().includes("admin") || username.toLowerCase().includes("sensebar")) {
        displayName = username === "sensebar" ? "三師爸 (工程副總)" : "總部管理員";
        deptName = "總經理室";
        roleName = "admin";
        avatarIcon = "fa-user-tie";
      } else if (username.toLowerCase().includes("north")) {
        displayName = "北區處長";
        deptName = "北區工程處";
        roleName = "manager";
      } else if (username.toLowerCase().includes("central")) {
        displayName = "中區處長";
        deptName = "中區工程處";
        roleName = "manager";
      } else if (username.toLowerCase().includes("tainan")) {
        displayName = "台南處長";
        deptName = "台南工程處";
        roleName = "manager";
      } else if (username.toLowerCase().includes("ganmen")) {
        displayName = "工程部主管 (ganmen)";
        deptName = "工程技術部";
        roleName = "admin";
        avatarIcon = "fa-user-gear";
      }

      sessionToken = "gh_token_" + Date.now();
      currentUser = {
        username: username,
        name: displayName,
        dept: deptName,
        role: roleName,
        avatar: avatarIcon
      };

      sessionStorage.setItem("nas_session_token", sessionToken);
      sessionStorage.setItem("nas_user_profile", JSON.stringify(currentUser));
      applyUserUI(currentUser);
      loginModal.classList.add("hidden");
      appContainer.classList.remove("blur-locked");
      startHeartbeat();
      await loadDashboardData();
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", handleLogout);
  }
}

function showLoginError(msg) {
  if (loginError) {
    loginError.textContent = msg;
    loginError.classList.remove("hidden");
  }
}

function applyUserUI(user) {
  if (!user) return;
  if (displayUserName) displayUserName.textContent = user.name || user.username;
  if (displayUserDept) displayUserDept.textContent = user.dept || "技術同仁";
  if (userAvatarIcon) {
    userAvatarIcon.innerHTML = `<i class="fa-solid ${user.avatar || 'fa-user-shield'}"></i>`;
  }
}

function handleLogout() {
  if (confirm("確定要登出技術會議雲端儀表板嗎？")) {
    if (sessionToken) {
      fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: sessionToken })
      }).catch(e => console.warn(e));
    }
    clearInterval(heartbeatInterval);
    sessionStorage.removeItem("nas_session_token");
    sessionStorage.removeItem("nas_user_profile");
    sessionToken = null;
    currentUser = null;
    appContainer.classList.add("blur-locked");
    loginModal.classList.remove("hidden");
  }
}

// ==============================================================================
// 2. 多人在線即時心跳保活引擎
// ==============================================================================
function startHeartbeat() {
  clearInterval(heartbeatInterval);
  sendHeartbeatPing();
  heartbeatInterval = setInterval(() => {
    sendHeartbeatPing();
  }, 15000);
}

async function sendHeartbeatPing() {
  if (!sessionToken || !currentUser) return;
  try {
    const res = await fetch("/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: sessionToken,
        currentView: currentViewName
      })
    });

    if (res.ok) {
      const data = await res.json();
      updatePresenceUI(data.onlineCount, data.users, data.serverTime);
    }
  } catch (err) {
    updatePresenceUI(1, [{
      username: currentUser.username,
      name: currentUser.name,
      dept: currentUser.dept,
      role: currentUser.role,
      avatar: currentUser.avatar,
      currentView: currentViewName,
      loginTime: "在線中",
      activeSecondsAgo: 0
    }], new Date().toLocaleTimeString("zh-TW", { hour12: false }));
  }
}

function updatePresenceUI(count, users, serverTime) {
  if (headerOnlineCount) headerOnlineCount.textContent = count;
  const numEl = document.getElementById("presence-online-num");
  if (numEl) numEl.textContent = count;
  const timeEl = document.getElementById("presence-server-time");
  if (timeEl && serverTime) timeEl.textContent = serverTime;

  const grid = document.getElementById("online-users-grid");
  if (!grid || !users) return;

  grid.innerHTML = users.map(u => `
    <div class="user-live-card">
      <div class="user-live-avatar">
        <i class="fa-solid ${u.avatar || 'fa-user'}"></i>
      </div>
      <div class="user-live-details">
        <span class="u-name">${u.name} <small class="text-cyan">(${u.role === 'admin' ? '管理員' : '同仁'})</small></span>
        <span class="u-dept"><i class="fa-solid fa-building"></i> ${u.dept}</span>
        <span class="u-status-tag"><i class="fa-solid fa-eye text-cyan"></i> 正在檢視：${u.currentView || '總覽'}</span>
      </div>
    </div>
  `).join("");
}

// ==============================================================================
// 3. 導覽列與子分頁切換
// ==============================================================================
function initNavigations() {
  navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      navTabs.forEach(t => t.classList.remove("active"));
      tabPanes.forEach(p => p.classList.add("hidden"));

      tab.classList.add("active");
      const targetId = `tab-${tab.dataset.tab}`;
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.remove("hidden");

      currentViewName = tab.textContent.trim();
      sendHeartbeatPing();
    });
  });

  if (btnOpenPresence) {
    btnOpenPresence.addEventListener("click", () => {
      const presenceTab = document.querySelector('.nav-tab[data-tab="presence"]');
      if (presenceTab) presenceTab.click();
    });
  }

  subnavBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      subnavBtns.forEach(b => b.classList.remove("active"));
      subpanes.forEach(p => p.classList.add("hidden"));

      btn.classList.add("active");
      const targetSub = document.getElementById(`sub-${btn.dataset.sub}`);
      if (targetSub) targetSub.classList.remove("hidden");
    });
  });

  drawerTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      drawerTabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderDrawerTabContent(btn.dataset.drawerTab);
    });
  });

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener("click", () => {
      projectModal.classList.add("hidden");
      currentDrawerProject = null;
    });
  }

  if (projectModal) {
    projectModal.addEventListener("click", (e) => {
      if (e.target === projectModal) {
        projectModal.classList.add("hidden");
        currentDrawerProject = null;
      }
    });
  }

  document.querySelectorAll(".type-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".type-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeSearchType = chip.dataset.type;
      performGlobalSearch();
    });
  });

  const searchInput = document.getElementById("global-search-input");
  const btnClearSearch = document.getElementById("btn-clear-search");
  let searchTimer = null;

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(performGlobalSearch, 200);
    });
  }

  if (btnClearSearch && searchInput) {
    btnClearSearch.addEventListener("click", () => {
      searchInput.value = "";
      performGlobalSearch();
    });
  }

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      filterProjectsByDept(chip.dataset.dept);
    });
  });

  const projQuickInput = document.getElementById("project-quick-search");
  if (projQuickInput) {
    projQuickInput.addEventListener("input", () => {
      const q = projQuickInput.value.trim().toLowerCase();
      document.querySelectorAll(".project-card").forEach(card => {
        const name = (card.dataset.name || "").toLowerCase();
        if (!q || name.includes(q)) {
          card.style.display = "";
        } else {
          card.style.display = "none";
        }
      });
    });
  }
}

// ==============================================================================
// 4. 載入並渲染 NAS 彙整數據
// ==============================================================================
async function loadDashboardData() {
  try {
    let res = null;
    try {
      res = await fetch("/api/nas-data");
    } catch (e) {
      console.debug("Backend API error, falling back to data/nas_data.json");
    }

    if (!res || !res.ok) {
      res = await fetch("data/nas_data.json");
    }

    appData = await res.json();
    console.log("NAS Data Loaded successfully:", appData);

    renderHeaderOverview(appData);
    renderGoogleCalendar(currentCalYear, currentCalMonth);
    renderMonthlyReportAnalysis("coverage");
    renderGuidelines(appData.guidelines || []);
    renderTemplates(appData.templates || []);
    renderOthers(appData.others || []);
    renderWorkspaces(appData.projects || []);

  } catch (err) {
    console.error("Load dashboard data failed:", err);
    alert("載入技術會議雲端資料失敗，請確認 NAS 連線正常或本機伺服器已啟動。");
  }
}

function renderHeaderOverview(data) {
  const projCount = document.getElementById("stat-projects-count");
  const todoCount = document.getElementById("stat-todos-count");
  const issueCount = document.getElementById("stat-issues-count");
  const compRate = document.getElementById("stat-completion-rate");
  const lastUpdate = document.getElementById("stat-last-update");
  const badgeProj = document.getElementById("badge-proj-count");

  if (projCount) projCount.textContent = (data.projects || []).length;
  if (badgeProj) badgeProj.textContent = (data.projects || []).length;
  if (todoCount) todoCount.textContent = data.totalTodos || 268;
  if (issueCount) issueCount.textContent = data.totalIssues || 0;

  let totalComp = 0;
  let totalAll = 0;
  if (data.siteStats) {
    Object.values(data.siteStats).forEach(s => {
      totalComp += (s.completed || 0);
      totalAll += (s.total || 0);
    });
  }
  const overallRate = totalAll > 0 ? ((totalComp / totalAll) * 100).toFixed(1) : "0.0";
  if (compRate) compRate.textContent = `${overallRate}%`;
  if (lastUpdate && data.updatedAt) lastUpdate.textContent = data.updatedAt;
}

// ==============================================================================
// 5. 模組 1：公告欄 (Announcements) - 5 欄工作日日曆 (六日隱藏)
// ==============================================================================
function initCalendarNavigation() {
  const btnPrev = document.getElementById("cal-prev-month");
  const btnNext = document.getElementById("cal-next-month");
  const btnToday = document.getElementById("cal-today-btn");
  const btnExportIcs = document.getElementById("btn-export-ics");

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      currentCalMonth--;
      if (currentCalMonth < 1) {
        currentCalMonth = 12;
        currentCalYear--;
      }
      renderGoogleCalendar(currentCalYear, currentCalMonth);
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      currentCalMonth++;
      if (currentCalMonth > 12) {
        currentCalMonth = 1;
        currentCalYear++;
      }
      renderGoogleCalendar(currentCalYear, currentCalMonth);
    });
  }

  if (btnToday) {
    btnToday.addEventListener("click", () => {
      const now = new Date();
      currentCalYear = now.getFullYear();
      currentCalMonth = now.getMonth() + 1;
      renderGoogleCalendar(currentCalYear, currentCalMonth);
    });
  }

  if (btnExportIcs) {
    btnExportIcs.addEventListener("click", exportTechnicalMeetingIcs);
  }
}

// 2026 年真實 Google 日曆排程表
const ACTUAL_SEPT_2026_SCHEDULE = [
  { day: 4, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "游協理 / 陳所長", cycle: "每月第一週五" },
  { day: 9, site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "林協理 / 蔡所長", cycle: "每月第二週三" },
  { day: 10, site: "朴子技術會議", time: "10:00", dept: "中區工程處", contact: "李副總 / 張所長", cycle: "每月第二週四" },
  { day: 11, site: "9月-坤門技術會議", time: "10:00", dept: "宜蘭工程處", contact: "游協理 / 簡所長", cycle: "每月第二週五" },
  { day: 14, site: "平實安居", time: "14:00", dept: "台南工程處", contact: "黃協理 / 劉所長", cycle: "每月第三週一" },
  { day: 15, site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "黃協理 / 吳所長", cycle: "每月第三週二" },
  { day: 17, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "游協理 / 陳所長", cycle: "專案特定排程" },
  { day: 22, site: "新纖BIM模型技術會議", time: "10:00", dept: "北區工程處", contact: "陳協理 / 劉所長", cycle: "專案專案檢討" },
  { day: 23, site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "陳協理 / 鄭所長", cycle: "每月第四週三" },
  { day: 24, site: "新纖", time: "10:00", dept: "北區工程處", contact: "陳協理 / 劉所長", cycle: "每月第四週四" },
  { day: 29, site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "陳協理 / 洪所長", cycle: "每月第五週二" }
];

function renderGoogleCalendar(year, month) {
  const titleEl = document.getElementById("cal-current-month-title");
  const daysGrid = document.getElementById("gcal-days-grid");
  if (!titleEl || !daysGrid) return;

  titleEl.textContent = `${year} 年 ${month} 月 (週一至週五)`;

  const monthMeetings = {};
  if (year === 2026 && month === 9) {
    ACTUAL_SEPT_2026_SCHEDULE.forEach(item => {
      if (!monthMeetings[item.day]) monthMeetings[item.day] = [];
      monthMeetings[item.day].push({
        title: `月會-${item.site}`,
        site: item.site,
        time: item.time,
        dept: item.dept,
        contact: item.contact,
        cycle: item.cycle
      });
    });
  } else {
    // 動態週期排程 fallback
    const mockMonthlyCycles = [
      { site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "游協理", nthWeekday: { n: 1, day: 5 } },
      { site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "林協理", nthWeekday: { n: 2, day: 3 } },
      { site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "李副總", nthWeekday: { n: 2, day: 4 } },
      { site: "坤門安居", time: "10:00", dept: "宜蘭工程處", contact: "游協理", nthWeekday: { n: 2, day: 5 } },
      { site: "平實安居", time: "14:00", dept: "台南工程處", contact: "黃協理", nthWeekday: { n: 3, day: 1 } },
      { site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "黃協理", nthWeekday: { n: 3, day: 2 } },
      { site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "陳協理", nthWeekday: { n: 4, day: 3 } },
      { site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "陳協理", nthWeekday: { n: 4, day: 4 } },
      { site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "陳協理", nthWeekday: { n: 4, day: 5 } }
    ];

    mockMonthlyCycles.forEach(s => {
      let count = 0;
      let dayNum = 0;
      for (let d = 1; d <= 31; d++) {
        const dt = new Date(year, month - 1, d);
        if (dt.getMonth() !== month - 1) break;
        if (dt.getDay() === s.nthWeekday.day) {
          count++;
          if (count === s.nthWeekday.n) {
            dayNum = d;
            break;
          }
        }
      }
      if (dayNum > 0) {
        if (!monthMeetings[dayNum]) monthMeetings[dayNum] = [];
        monthMeetings[dayNum].push({
          title: `月會-${s.site}`,
          site: s.site,
          time: s.time,
          dept: s.dept,
          contact: s.contact,
          cycle: `每月第${s.nthWeekday.n}週`
        });
      }
    });
  }

  const firstDay = new Date(year, month - 1, 1);
  const firstDayOfWeek = firstDay.getDay();
  const totalDays = new Date(year, month, 0).getDate();

  let cellsHtml = "";
  let renderedCount = 0;

  // 上個月墊底工作日
  let leadingPadDays = 0;
  if (firstDayOfWeek >= 1 && firstDayOfWeek <= 5) {
    leadingPadDays = firstDayOfWeek - 1;
  }

  for (let i = leadingPadDays; i >= 1; i--) {
    const prevDate = new Date(year, month - 1, 1 - i);
    const d = prevDate.getDate();
    cellsHtml += `
      <div class="gcal-day-cell other-month">
        <div class="day-header"><span class="day-num">${d}</span></div>
        <div class="day-events"></div>
      </div>
    `;
    renderedCount++;
  }

  // 本月工作日 (六、日不顯示)
  const today = new Date();
  const isCurrentRealMonth = (today.getFullYear() === year && (today.getMonth() + 1) === month);

  for (let d = 1; d <= totalDays; d++) {
    const curDate = new Date(year, month - 1, d);
    const dayOfWeek = curDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    const isToday = isCurrentRealMonth && (today.getDate() === d);
    const dayEvents = monthMeetings[d] || [];

    cellsHtml += `
      <div class="gcal-day-cell ${isToday ? 'is-today' : ''}">
        <div class="day-header">
          <span class="day-num">${d}</span>
          ${isToday ? '<small class="text-cyan font-bold">今天</small>' : ''}
        </div>
        <div class="day-events">
          ${dayEvents.map(evt => {
            const colors = getDeptChipClass(evt.dept);
            const matchedProj = (appData.projects || []).find(p => normalizeSiteName(p.shortName) === normalizeSiteName(evt.site));
            const projId = matchedProj ? matchedProj.id : "";
            
            const safeEvt = encodeURIComponent(JSON.stringify({
              title: evt.title,
              site: evt.site,
              dept: evt.dept,
              time: evt.time,
              cycle: evt.cycle,
              contact: evt.contact,
              year: year,
              month: month,
              day: d,
              dateStr: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
              projId: projId
            }));

            return `
              <div class="gcal-event-chip ${colors.chip}" onclick="showMeetingQuickCard('${safeEvt}')" title="${evt.time} ${evt.title} (${evt.dept}) - 點擊查看">
                <span class="chip-time">${evt.time}</span>
                <span>${evt.title}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
    renderedCount++;
  }

  // 下個月墊底補齊為 5 的倍數
  const trailingPadDays = (renderedCount % 5 === 0) ? 0 : (5 - (renderedCount % 5));
  for (let i = 1; i <= trailingPadDays; i++) {
    cellsHtml += `
      <div class="gcal-day-cell other-month">
        <div class="day-header"><span class="day-num">${i}</span></div>
        <div class="day-events"></div>
      </div>
    `;
  }

  daysGrid.innerHTML = cellsHtml;
}

window.showMeetingQuickCard = function(encodedData) {
  try {
    const evt = JSON.parse(decodeURIComponent(encodedData));
    const startTimeStr = evt.dateStr.replace(/-/g, '') + 'T' + evt.time.replace(':', '') + '00';
    const endHour = String(parseInt(evt.time.split(':')[0]) + 2).padStart(2, '0');
    const endTimeStr = evt.dateStr.replace(/-/g, '') + 'T' + endHour + evt.time.split(':')[1] + '00';
    const gcalAddUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(evt.title || (evt.site + ' 技術會議'))}&dates=${startTimeStr}/${endTimeStr}&details=${encodeURIComponent('主辦單位：' + evt.dept + '\n承辦窗口：' + evt.contact + '\n週期：' + evt.cycle)}&location=${encodeURIComponent('專案工務所 / 視訊會議')}`;
    const gcalDayUrl = `https://calendar.google.com/calendar/u/0/r/day/${evt.year}/${evt.month}/${evt.day}`;

    const bodyHtml = `
      <div style="padding: 10px 0; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="proj-dept-tag">${evt.dept}</span>
          <span class="cal-filter-tag"><i class="fa-solid fa-circle-check"></i> 定期技術會議</span>
        </div>

        <h3 style="font-size: 20px; color: var(--primary);"><i class="fa-solid fa-calendar-check"></i> ${evt.title}</h3>

        <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; font-size: 14px; line-height: 1.8;">
          <div><i class="fa-regular fa-clock text-cyan"></i> <b>會議日期與時間：</b>${evt.dateStr} ${evt.time} (${evt.cycle})</div>
          <div><i class="fa-solid fa-location-dot text-rose"></i> <b>會議常態地點：</b>專案工務所 / 視訊會議</div>
          <div><i class="fa-solid fa-user-gear text-amber"></i> <b>承辦業務窗口：</b>${evt.contact}</div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap;">
          ${evt.projId ? `
            <button type="button" class="btn-table-action" style="padding: 10px 18px; font-size: 14px;" onclick="openProjectDrawer('${evt.projId}'); document.getElementById('file-viewer-modal').classList.add('hidden');">
              <i class="fa-solid fa-folder-open"></i> 進入專案作業區查看簡報與待辦
            </button>
          ` : ''}
          <a href="${gcalAddUrl}" target="_blank" rel="noopener noreferrer" class="btn-gcal-open" style="padding: 10px 18px; font-size: 14px;">
            <i class="fa-brands fa-google"></i> 加入我的 Google 日曆
          </a>
          <a href="${gcalDayUrl}" target="_blank" rel="noopener noreferrer" class="btn-table-action" style="padding: 10px 18px; font-size: 14px;">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> 在 Google 日曆中檢視該日
          </a>
        </div>
      </div>
    `;

    openCustomModal(`📅 技術會議排程資訊`, bodyHtml);
  } catch (e) {
    console.error("Parse meeting card error:", e);
  }
};

function exportTechnicalMeetingIcs() {
  let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Technical Meeting Cloud Dashboard//TW\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\nX-WR-CALNAME:2026 技術會議排程表\n";

  ACTUAL_SEPT_2026_SCHEDULE.forEach(evt => {
    const dayStr = String(evt.day).padStart(2, '0');
    const timeParts = evt.time.split(':');
    const startHour = timeParts[0].padStart(2, '0');
    const startMin = timeParts[1] || '00';
    const endHour = String(parseInt(startHour, 10) + 2).padStart(2, '0');

    icsContent += `BEGIN:VEVENT\nSUMMARY:月會-${evt.site}\nDESCRIPTION:主辦工程處：${evt.dept}\\n承辦窗口：${evt.contact}\\n週期：${evt.cycle}\nLOCATION:專案工務所 / 視訊\nDTSTART:202609${dayStr}T${startHour}${startMin}00\nDTEND:202609${dayStr}T${endHour}${startMin}00\nSTATUS:CONFIRMED\nEND:VEVENT\n`;
  });

  icsContent += "END:VCALENDAR";

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "2026-Technical-Meetings-Sept.ics";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function getDeptChipClass(dept) {
  if (!dept) return { chip: "chip-north" };
  if (dept.includes("北區")) return { chip: "chip-north" };
  if (dept.includes("中區")) return { chip: "chip-central" };
  if (dept.includes("台南")) return { chip: "chip-tainan" };
  if (dept.includes("高屏")) return { chip: "chip-kaoping" };
  if (dept.includes("宜蘭")) return { chip: "chip-yilan" };
  return { chip: "chip-other" };
}

// ==============================================================================
// 6. 每月技術會議運作概況分析 (P10~P13)
// ==============================================================================
let currentReportView = "coverage";
window.currentCutoffDate = "2026-08-24";

function initMonthlyReportTabs() {
  document.querySelectorAll(".report-subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".report-subtab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentReportView = btn.dataset.reportView;
      renderMonthlyReportAnalysis(currentReportView);
    });
  });
}

window.applyCutoffDate = async function() {
  const input = document.getElementById("cutoff-date-input");
  const statusEl = document.getElementById("cutoff-update-status");
  const btn = document.getElementById("btn-update-cutoff-date");
  if (!input) return;

  const dateVal = input.value || "2026-08-24";
  window.currentCutoffDate = dateVal;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 更新計算中...`;
  }

  const isLocalServer = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalServer) {
    try {
      const res = await fetch("/api/update-cutoff-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffDate: dateVal })
      });
      const resJson = await res.json();
      if (resJson.status === "success" && resJson.data) {
        appData = resJson.data;
      }
    } catch (e) {
      console.warn("Local update cutoff failed, fallback to frontend dynamic calculation", e);
    }
  }

  if (appData && appData.monthlyReportAnalysis && appData.monthlyReportAnalysis.p13_coverage) {
    const parts = dateVal.split("-");
    const mmdd = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : "08/24";
    const headers = appData.monthlyReportAnalysis.p13_coverage.headers || [];
    if (headers.length >= 4) {
      headers[3] = `${mmdd}前預定`;
    }
  }

  renderMonthlyReportAnalysis(currentReportView || "coverage");

  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> 已成功更新至基準日：${dateVal}`;
    statusEl.style.display = "inline-block";
    setTimeout(() => { statusEl.style.display = "none"; }, 4000);
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> 更新計算數據`;
  }
};

function renderMonthlyReportAnalysis(viewType) {
  const container = document.getElementById("monthly-report-dynamic-content");
  if (!container || !appData) return;

  const rep = appData.monthlyReportAnalysis;
  if (!rep) {
    container.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-chart-pie"></i><p>暫無最新技術會議運作概況數據</p></div>`;
    return;
  }

  if (viewType === "coverage") {
    const p13 = rep.p13_coverage || { headers: [], rows: [], analysis: [] };
    container.innerHTML = `
      <div class="report-block">
        <div class="report-block-title">
          <i class="fa-solid fa-shield-halved text-cyan"></i>
          <h4>全工區技術議題管控項目覆蓋率分析 (P13 統計)</h4>
        </div>
        <div class="table-responsive" style="margin-top: 10px;">
          <table class="modern-table">
            <thead>
              <tr>
                ${(p13.headers || []).map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${(p13.rows || []).map((row, idx) => `
                <tr class="${idx === p13.rows.length - 1 ? 'total-row' : ''}">
                  ${row.map((cell, cIdx) => `
                    <td class="${cIdx === 0 ? 'text-cyan font-bold' : ''}" style="${cIdx > 0 ? 'text-align: right;' : ''}">
                      ${cell}
                    </td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (viewType === "dept") {
    const p12 = rep.p12_dept_perf || { headers: [], rows: [], analysis: [] };
    container.innerHTML = `
      <div class="report-block">
        <div class="report-block-title">
          <i class="fa-solid fa-sitemap text-amber"></i>
          <h4>各工處待辦執行績效與燈號分析 (P12 統計)</h4>
        </div>
        <div class="table-responsive" style="margin-top: 10px;">
          <table class="modern-table">
            <thead>
              <tr>
                ${(p12.headers || []).map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${(p12.rows || []).map(row => `
                <tr>
                  ${row.map((cell, cIdx) => `
                    <td class="${cIdx === 0 ? 'text-cyan font-bold' : ''}">${cell}</td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (viewType === "site") {
    const p11 = rep.p11_site_perf || { headers: [], rows: [], analysis: [] };
    container.innerHTML = `
      <div class="report-block">
        <div class="report-block-title">
          <i class="fa-solid fa-cubes-stacked text-emerald"></i>
          <h4>各工地待辦執行績效排名 (P11 統計)</h4>
        </div>
        <div class="table-responsive" style="margin-top: 10px;">
          <table class="modern-table">
            <thead>
              <tr>
                ${(p11.headers || []).map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${(p11.rows || []).map(row => `
                <tr>
                  ${row.map((cell, cIdx) => `
                    <td class="${cIdx === 0 ? 'text-cyan font-bold' : ''}">${cell}</td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (viewType === "meetings") {
    const p10m = rep.p10_meetings || { headers: [], rows: [] };
    container.innerHTML = `
      <div class="report-block">
        <div class="report-block-title">
          <i class="fa-solid fa-handshake-angle text-purple"></i>
          <h4>各工處每月技術會議召開場次 (P10 統計)</h4>
        </div>
        <div class="table-responsive" style="margin-top: 10px;">
          <table class="modern-table">
            <thead>
              <tr>
                ${(p10m.headers || []).map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${(p10m.rows || []).map(row => `
                <tr>
                  ${row.map((cell, cIdx) => `
                    <td class="${cIdx === 0 ? 'text-cyan font-bold' : ''}">${cell}</td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

// 渲染技術指引、模板、其他文件
function renderGuidelines(items) {
  const list = document.getElementById("guidelines-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無發布之技術指引文件</p></div>`;
    return;
  }
  list.innerHTML = items.map(f => {
    const safeF = encodeURIComponent(JSON.stringify(f));
    return `
      <div class="file-row-item">
        <div class="file-left-info">
          <i class="fa-solid ${getFileIcon(f.ext)}"></i>
          <span class="file-name-text">${f.name}</span>
          <small class="text-dim">最後更新：${f.lastModified}</small>
        </div>
        <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
          <i class="fa-solid fa-eye"></i> 檢視檔案
        </button>
      </div>
    `;
  }).join("");
}

function renderTemplates(items) {
  const list = document.getElementById("templates-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無作業模板檔案</p></div>`;
    return;
  }
  list.innerHTML = items.map(f => {
    const safeF = encodeURIComponent(JSON.stringify(f));
    return `
      <div class="file-row-item">
        <div class="file-left-info">
          <i class="fa-solid ${getFileIcon(f.ext)}"></i>
          <span class="file-name-text">${f.name}</span>
          <small class="text-dim">最後更新：${f.lastModified}</small>
        </div>
        <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
          <i class="fa-solid fa-eye"></i> 檢視模板
        </button>
      </div>
    `;
  }).join("");
}

function renderOthers(items) {
  const list = document.getElementById("others-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無其他文件檔案</p></div>`;
    return;
  }
  list.innerHTML = items.map(f => {
    const safeF = encodeURIComponent(JSON.stringify(f));
    return `
      <div class="file-row-item">
        <div class="file-left-info">
          <i class="fa-solid ${getFileIcon(f.ext)}"></i>
          <span class="file-name-text">${f.name}</span>
          <small class="text-dim">最後更新：${f.lastModified}</small>
        </div>
        <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
          <i class="fa-solid fa-eye"></i> 檢視文件
        </button>
      </div>
    `;
  }).join("");
}

// ==============================================================================
// 7. 模組 2：各專案作業區 (Workspaces) - 9 大活躍專案
// ==============================================================================
function renderWorkspaces(projects) {
  const grid = document.getElementById("projects-grid");
  if (!grid) return;

  if (!projects || projects.length === 0) {
    grid.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-closed"></i><p>無專案資料</p></div>`;
    return;
  }

  grid.innerHTML = projects.map(p => {
    const normSite = normalizeSiteName(p.shortName);
    const projTodos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
    const ctrlItemsCount = (p.controlSheetItems || []).length;
    const stats = p.stats || { total: projTodos.length, completed: 0, completionRate: 0, light: 'white' };
    
    let lightColorClass = "light-white";
    if (stats.light === "green") lightColorClass = "light-green";
    else if (stats.light === "yellow") lightColorClass = "light-yellow";
    else if (stats.light === "orange") lightColorClass = "light-orange";
    else if (stats.light === "red") lightColorClass = "light-red";

    const meetingsCount = (p.meetings || []).length;

    return `
      <div class="project-card glass-card" data-id="${p.id}" data-dept="${p.dept}" data-name="${p.name}" onclick="openProjectDrawer('${p.id}')">
        <div class="proj-header">
          <span class="proj-dept-tag">${p.dept}</span>
          <span class="proj-light-pill ${lightColorClass}">
            待辦完成率: ${stats.completionRate}%
          </span>
        </div>

        <h3 class="proj-title">${p.name}</h3>

        <div class="proj-metrics">
          <div class="metric-item">
            <span class="metric-label">歷次會議</span>
            <span class="metric-val text-cyan">${meetingsCount} 場</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">專案待辦</span>
            <span class="metric-val text-emerald">${projTodos.length} 筆</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">議題管控</span>
            <span class="metric-val text-purple">${ctrlItemsCount} 項</span>
          </div>
        </div>

        <button type="button" class="btn-proj-enter" onclick="event.stopPropagation(); openProjectDrawer('${p.id}')">
          進入作業區 <i class="fa-solid fa-arrow-right"></i>
        </button>
      </div>
    `;
  }).join("");
}

function filterProjectsByDept(dept) {
  const cards = document.querySelectorAll(".project-card");
  cards.forEach(card => {
    if (dept === "all" || card.dataset.dept.includes(dept)) {
      card.style.display = "";
    } else {
      card.style.display = "none";
    }
  });
}

// 專案抽屜詳細展開
window.openProjectDrawer = function(projectId) {
  if (!appData || !appData.projects) return;
  const proj = appData.projects.find(p => p.id === projectId);
  if (!proj) return;

  currentDrawerProject = proj;
  currentViewName = `專案作業區：${proj.shortName}`;
  sendHeartbeatPing();

  const deptEl = document.getElementById("drawer-project-dept");
  const nameEl = document.getElementById("drawer-project-name");
  const lightEl = document.getElementById("drawer-project-light");
  const todoCountEl = document.getElementById("drawer-todo-count");
  const controlCountEl = document.getElementById("drawer-control-count");

  if (deptEl) deptEl.textContent = proj.dept;
  if (nameEl) nameEl.textContent = proj.shortName || proj.name;
  
  const stats = proj.stats || { completionRate: 0, light: 'white' };
  if (lightEl) {
    lightEl.className = `drawer-stat-badge light-${stats.light || 'white'}`;
    lightEl.textContent = `待辦完成率: ${stats.completionRate}%`;
  }

  const normSite = normalizeSiteName(proj.shortName);
  const projTodos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
  if (todoCountEl) todoCountEl.textContent = projTodos.length;
  if (controlCountEl) controlCountEl.textContent = (proj.controlSheetItems || []).length;

  // 預設開啟第一個頁籤：歷次會議資料
  drawerTabs.forEach(b => b.classList.remove("active"));
  const firstTab = document.querySelector('.drawer-tab-btn[data-drawer-tab="meetings"]');
  if (firstTab) firstTab.classList.add("active");

  renderDrawerTabContent("meetings");
  projectModal.classList.remove("hidden");
};

// 支援深層跳轉專案抽屜至指定頁籤
window.openProjectDrawerTab = function(projectId, tabType) {
  openProjectDrawer(projectId);
  drawerTabs.forEach(b => {
    if (b.dataset.drawerTab === tabType) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });
  renderDrawerTabContent(tabType);
};

// 渲染抽屜內部頁籤
function renderDrawerTabContent(tabType) {
  const content = document.getElementById("drawer-body-content");
  if (!content || !currentDrawerProject) return;

  const proj = currentDrawerProject;

  // 頁籤 1: 歷次會議資料
  if (tabType === "meetings") {
    const meetings = proj.meetings || [];
    if (meetings.length === 0) {
      content.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無歷次會議上傳檔案</p></div>`;
      return;
    }

    content.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
        <span style="font-size: 13px; color: var(--text-muted);">
          <i class="fa-solid fa-folder-tree text-cyan"></i> 共 ${meetings.length} 場會議紀錄，檔案已全數展開（可點擊單場標題收合）
        </span>
        <button type="button" class="btn-table-action" onclick="toggleAllMeetingCards()">
          <i class="fa-solid fa-arrows-up-down"></i> 全部展開 / 收合
        </button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${meetings.map((m, idx) => `
          <div class="meeting-accordion-card" id="meeting-card-${idx}">
            <div class="meeting-header-toggle" onclick="toggleMeetingCard(this)">
              <span class="m-title-text"><i class="fa-solid fa-calendar-day text-cyan"></i> ${m.meetingName}</span>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="files-badge">${m.fileCount} 份會議檔案</span>
                <i class="fa-solid fa-chevron-down meeting-toggle-arrow"></i>
              </div>
            </div>
            <div class="m-files-grid">
              ${(m.files || []).map(f => {
                const safeF = encodeURIComponent(JSON.stringify(f));
                const fullPath = f.fullPath || '';
                return `
                  <div class="file-row-item">
                    <div class="file-left-info" title="${f.name}">
                      <i class="fa-solid ${getFileIcon(f.ext)}"></i>
                      <span class="file-name-text">${f.name}</span>
                      <small class="text-dim">(${(f.size / 1024).toFixed(0)} KB)</small>
                    </div>
                    <div class="file-actions">
                      <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
                        <i class="fa-solid fa-file-powerpoint"></i> 查看/開啟
                      </button>
                      <button type="button" class="btn-table-action" style="padding: 6px 10px; font-size: 12px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')" title="複製 NAS 實體路徑">
                        <i class="fa-regular fa-copy"></i> 複製路徑
                      </button>
                      <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 6px 10px; font-size: 12px;" title="下載檔案">
                        <i class="fa-solid fa-download"></i> 下載
                      </a>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  // 頁籤 2: 技術議題管控表 (比照待辦事項表格顯示 + 4大指標統計)
  else if (tabType === "control") {
    const rawItems = proj.controlSheetItems || [];
    const controlFiles = (proj.categories && proj.categories["2.技術議題管控表(每月更新)"]) || [];
    const latestFile = controlFiles.length > 0 ? controlFiles[controlFiles.length - 1] : null;

    if (rawItems.length === 0 && controlFiles.length === 0) {
      content.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-table"></i><p>目前尚無管控表項目</p></div>`;
      return;
    }

    // 計算 4 大指標 (以基準日/本日為篩選基準)
    const cutoffDate = window.currentCutoffDate || new Date().toISOString().slice(0, 10);
    const dueItems = rawItems.filter(it => it.dueDate && it.dueDate <= cutoffDate);
    const completedDueItems = dueItems.filter(it => it.status === '已完成' || it.actualDate);
    const noAssigneeItems = dueItems.filter(it => !it.assignee || it.assignee.trim() === '');
    const noDeliverableItems = dueItems.filter(it => (it.status === '已完成' || it.actualDate) && (!it.deliverable || it.deliverable.trim() === ''));

    // 根據 currentControlFilterMode 進行過濾
    let displayItems = rawItems;
    if (currentControlFilterMode === "due") {
      displayItems = dueItems;
    } else if (currentControlFilterMode === "no_assignee") {
      displayItems = rawItems.filter(it => !it.assignee || it.assignee.trim() === '');
    } else if (currentControlFilterMode === "no_deliverable") {
      displayItems = rawItems.filter(it => (it.status === '已完成' || it.actualDate) && (!it.deliverable || it.deliverable.trim() === ''));
    }

    if (currentControlSearchText) {
      const q = currentControlSearchText.toLowerCase();
      displayItems = displayItems.filter(it => 
        (it.title || '').toLowerCase().includes(q) ||
        (it.category || '').toLowerCase().includes(q) ||
        (it.assignee || '').toLowerCase().includes(q) ||
        (it.progress || '').toLowerCase().includes(q)
      );
    }

    content.innerHTML = `
      <!-- 壓縮精簡版 4 大指標橫條 (Ribbon) -->
      <div class="control-kpi-ribbon">
        <div class="kpi-mini-pill kpi-cyan">
          <i class="fa-solid fa-calendar-check"></i> 基準日應辦：<b>${dueItems.length}</b> 筆
        </div>
        <div class="kpi-mini-pill kpi-emerald">
          <i class="fa-solid fa-circle-check"></i> 已完成：<b>${completedDueItems.length}</b> 筆 (${dueItems.length > 0 ? ((completedDueItems.length/dueItems.length)*100).toFixed(1) : 0}%)
        </div>
        <div class="kpi-mini-pill kpi-amber">
          <i class="fa-solid fa-user-xmark"></i> 未排負責人：<b>${noAssigneeItems.length}</b> 筆
        </div>
        <div class="kpi-mini-pill kpi-rose">
          <i class="fa-solid fa-link-slash"></i> 成果未填：<b>${noDeliverableItems.length}</b> 筆
        </div>
      </div>

      <!-- 篩選與搜尋工具列 -->
      <div class="control-filter-bar">
        <div class="control-filter-tabs">
          <button type="button" class="control-filter-chip ${currentControlFilterMode === 'due' ? 'active' : ''}" onclick="setControlFilter('due')">
            <i class="fa-solid fa-clock"></i> 基準日前應辦 (${dueItems.length})
          </button>
          <button type="button" class="control-filter-chip ${currentControlFilterMode === 'all' ? 'active' : ''}" onclick="setControlFilter('all')">
            <i class="fa-solid fa-list-ul"></i> 全部項目 (${rawItems.length})
          </button>
          <button type="button" class="control-filter-chip ${currentControlFilterMode === 'no_assignee' ? 'active' : ''}" onclick="setControlFilter('no_assignee')">
            <i class="fa-solid fa-user-slash"></i> 未排負責人 (${noAssigneeItems.length})
          </button>
          <button type="button" class="control-filter-chip ${currentControlFilterMode === 'no_deliverable' ? 'active' : ''}" onclick="setControlFilter('no_deliverable')">
            <i class="fa-solid fa-file-circle-question"></i> 成果未填 (${noDeliverableItems.length})
          </button>
        </div>

        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="text" id="control-quick-search" placeholder="🔍 快速搜尋管控項目..." value="${currentControlSearchText}" oninput="handleControlSearch(this.value)" style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; color: #fff; font-size: 12px; outline: none;">
          ${latestFile ? `
            <a href="/api/download?path=${encodeURIComponent(latestFile.fullPath)}" target="_blank" download class="btn-table-action" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;">
              <i class="fa-solid fa-file-excel text-emerald"></i> 下載原始 Excel
            </a>
          ` : ''}
        </div>
      </div>

      <!-- 逐項條列管控表（固定表頭） -->
      <div class="table-responsive" style="max-height: 620px; overflow-y: auto;">
        <table class="modern-table">
          <thead style="position: sticky; top: 0; background: #0c1322; z-index: 5; box-shadow: 0 2px 5px rgba(0,0,0,0.5);">
            <tr>
              <th style="width: 45px; text-align: center;">項次</th>
              <th style="width: 100px;">階段</th>
              <th style="width: 120px;">類別</th>
              <th>議題項目 (檢討內容)</th>
              <th style="width: 90px;">負責人</th>
              <th style="width: 100px;">預定產出</th>
              <th style="width: 100px;">實際產出</th>
              <th style="width: 85px; text-align: center;">狀態</th>
              <th style="width: 180px;">辦理情形與成果連結</th>
            </tr>
          </thead>
          <tbody>
            ${displayItems.length === 0 ? `
              <tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">無符合篩選條件之管控項目</td></tr>
            ` : displayItems.map((it, idx) => {
              const isOverdue = it.dueDate && it.dueDate <= cutoffDate && it.status !== '已完成';
              const isDoneNoDeliverable = (it.status === '已完成' || it.actualDate) && (!it.deliverable || it.deliverable.trim() === '');
              
              let statusPill = `<span class="proj-light-pill light-white">未排定</span>`;
              if (it.status === '已完成') statusPill = `<span class="proj-light-pill light-green">已完成</span>`;
              else if (it.status === '進行中') statusPill = `<span class="proj-light-pill light-yellow">進行中</span>`;
              else if (it.status === '後續辦理') statusPill = `<span class="proj-light-pill light-orange">後續辦理</span>`;

              return `
                <tr>
                  <td style="text-align: center; color: var(--text-dim);">${idx + 1}</td>
                  <td><small class="text-cyan">${it.stage || '-'}</small></td>
                  <td><small class="text-dim font-bold">${it.category || '-'}</small></td>
                  <td style="line-height: 1.5; word-break: break-all;">
                    ${it.title}
                    ${isOverdue ? '<span style="display:inline-block; font-size:10px; background:rgba(244,63,94,0.15); color:#fda4af; border:1px solid rgba(244,63,94,0.3); border-radius:4px; padding:1px 4px; margin-left:6px;">逾期應辦</span>' : ''}
                  </td>
                  <td>
                    ${it.assignee ? `<span class="text-white">${it.assignee}</span>` : '<small class="text-amber font-bold"><i class="fa-solid fa-triangle-exclamation"></i> 未指定</small>'}
                  </td>
                  <td><small class="${isOverdue ? 'text-rose font-bold' : 'text-muted'}">${formatWesternDate(it.dueDate)}</small></td>
                  <td><small class="text-emerald">${formatWesternDate(it.actualDate)}</small></td>
                  <td style="text-align: center;">${statusPill}</td>
                  <td>
                    ${it.deliverable ? `
                      <div style="display: flex; align-items: center; gap: 4px; font-size: 11px;">
                        <span class="text-cyan font-bold" title="${it.deliverable}"><i class="fa-solid fa-paperclip"></i> 已檢附成果</span>
                        <button type="button" class="btn-table-action" style="padding: 2px 6px; font-size: 10px;" onclick="copyNasPath('${encodeURIComponent(it.deliverable)}')">複製</button>
                      </div>
                    ` : (isDoneNoDeliverable ? '<small class="text-rose"><i class="fa-solid fa-circle-exclamation"></i> 待補成果說明</small>' : `<small class="text-dim">${it.progress || '-'}</small>`)}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // 頁籤 3: 圖說契約進度表
  else if (tabType === "drawings") {
    const drawFiles = (proj.categories && proj.categories["1.圖說契約進度表(如有新版請更新)"]) || [];
    if (drawFiles.length === 0) {
      content.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-compass-drafting"></i><p>目前尚無圖說契約進度表檔案</p></div>`;
      return;
    }

    content.innerHTML = `
      <div class="glass-card section-card">
        <h4><i class="fa-solid fa-compass-drafting text-purple"></i> 圖說契約進度表</h4>
        <div class="category-files-list" style="margin-top: 14px;">
          ${drawFiles.map(f => {
            const safeF = encodeURIComponent(JSON.stringify(f));
            return `
              <div class="file-row-item">
                <div class="file-left-info">
                  <i class="fa-solid ${getFileIcon(f.ext)}"></i>
                  <span class="file-name-text">${f.name}</span>
                  <small class="text-dim">最後更新：${f.lastModified}</small>
                </div>
                <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
                  <i class="fa-solid fa-eye"></i> 查看進度表
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  // 頁籤 4: 專案待辦事項 (包含新纖南港總部 26 筆與各工區對齊)
  else if (tabType === "todos") {
    const normSite = normalizeSiteName(proj.shortName);
    const projTodos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
    
    if (projTodos.length === 0) {
      content.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-check-double"></i><p>本案目前無待辦事項登錄紀錄</p></div>`;
      return;
    }

    content.innerHTML = `
      <div class="table-responsive" style="max-height: 620px; overflow-y: auto;">
        <table class="modern-table">
          <thead style="position: sticky; top: 0; background: #0c1322; z-index: 5; box-shadow: 0 2px 5px rgba(0,0,0,0.5);">
            <tr>
              <th style="width: 50px; text-align: center;">項次</th>
              <th style="width: 110px;">會議日期</th>
              <th style="width: 100px;">提議者</th>
              <th>討論事項與決議內容</th>
              <th style="width: 110px;">預定完成日</th>
              <th style="width: 95px;">辦理情形</th>
              <th style="width: 220px;">成果說明</th>
            </tr>
          </thead>
          <tbody>
            ${projTodos.map((td, idx) => `
              <tr>
                <td style="text-align: center; color: var(--text-dim);">${idx + 1}</td>
                <td><small class="text-cyan font-bold">${formatWesternDate(td.meetDate)}</small></td>
                <td>${td.proposer || '-'}</td>
                <td style="line-height: 1.6; word-break: break-all;">${td.desc || '-'}</td>
                <td><small class="text-muted">${formatWesternDate(td.dueDate)}</small></td>
                <td>
                  <span class="proj-light-pill ${td.status === '已完成' ? 'light-green' : (td.status === '後續辦理' ? 'light-orange' : 'light-yellow')}">
                    ${td.status || '辦理中'}
                  </span>
                </td>
                <td><small class="text-dim" style="word-break: break-all; line-height: 1.4;">${td.result || '-'}</small></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }
}

window.setControlFilter = function(mode) {
  currentControlFilterMode = mode;
  renderDrawerTabContent("control");
};

window.handleControlSearch = function(text) {
  currentControlSearchText = text.trim();
  renderDrawerTabContent("control");
};

// ==============================================================================
// 8. 模組 3：全域資料搜尋引擎 (清洗 ➔ 歸納 ➔ 總結 ➔ 精準連結出處)
// ==============================================================================
function performGlobalSearch() {
  const searchInput = document.getElementById("global-search-input");
  const resultsList = document.getElementById("search-results-list");
  const countEl = document.getElementById("search-result-count");
  if (!searchInput || !resultsList || !appData) return;

  const rawQuery = searchInput.value.trim();
  const query = rawQuery.toLowerCase();

  if (!query) {
    resultsList.innerHTML = `
      <div class="search-empty-prompt">
        <i class="fa-solid fa-keyboard"></i>
        <p>請於上方搜尋框輸入關鍵字開始查詢（聚焦技術議題庫、專案會議簡報與各類技術指引）</p>
      </div>
    `;
    if (countEl) countEl.textContent = "0";
    return;
  }

  // 1. 資料清洗與檢索 (只搜尋：技術議題庫 155 筆、會議簡報檔案、技術指引模板)
  const issueMatches = [];
  const fileMatches = [];

  // A. 搜尋技術議題庫 (155 筆跨專案技術結晶)
  if (activeSearchType === "all" || activeSearchType === "issues") {
    (appData.technicalIssues || []).forEach(issue => {
      const matchText = `${issue.dept} ${issue.site} ${issue.category} ${issue.title} ${issue.notes}`.toLowerCase();
      if (matchText.includes(query)) {
        // 尋找對應之專案簡報檔案或目錄
        const matchedProj = (appData.projects || []).find(p => normalizeSiteName(p.shortName) === normalizeSiteName(issue.site));
        let issueFileObj = null;
        if (matchedProj) {
          // 搜尋該專案歷次會議中是否有對應日期的簡報
          for (const m of (matchedProj.meetings || [])) {
            for (const f of (m.files || [])) {
              if (f.name.toLowerCase().includes(query) || (issue.meetDate && f.name.includes(issue.meetDate.replace(/-/g, '')))) {
                issueFileObj = f;
                break;
              }
            }
            if (issueFileObj) break;
          }
          // 若無特定日，取該專案最新會議簡報
          if (!issueFileObj && matchedProj.meetings && matchedProj.meetings.length > 0 && matchedProj.meetings[0].files && matchedProj.meetings[0].files.length > 0) {
            issueFileObj = matchedProj.meetings[0].files[0];
          }
        }

        issueMatches.push({
          type: "issue",
          typeLabel: "技術議題",
          tagClass: "tag-issue",
          dept: issue.dept,
          site: issue.site,
          date: issue.meetDate,
          title: issue.title,
          desc: `工項類別：${issue.category} ‧ 備註說明：${issue.notes || '無'}`,
          actionType: "viewIssueFile",
          fileObj: issueFileObj,
          issueObj: issue
        });
      }
    });
  }

  // B. 搜尋會議簡報檔案與指引模板
  if (activeSearchType === "all" || activeSearchType === "files" || activeSearchType === "guides") {
    (appData.projects || []).forEach(p => {
      (p.meetings || []).forEach(m => {
        (m.files || []).forEach(f => {
          if (f.name.toLowerCase().includes(query)) {
            fileMatches.push({
              type: "file",
              typeLabel: "會議簡報",
              tagClass: "tag-file",
              dept: p.dept,
              site: p.shortName,
              date: m.meetingName,
              title: f.name,
              desc: `所屬會議：${m.meetingName} (${(f.size/1024).toFixed(0)} KB)`,
              actionType: "viewFile",
              fileObj: f
            });
          }
        });
      });
    });

    const allGuides = (appData.guidelines || []).concat(appData.templates || []).concat(appData.others || []);
    allGuides.forEach(f => {
      if (f.name.toLowerCase().includes(query)) {
        fileMatches.push({
          type: "guide",
          typeLabel: "技術指引/模板",
          tagClass: "tag-guide",
          dept: "指引發布區",
          site: f.folder || "通用",
          date: f.lastModified,
          title: f.name,
          desc: `分類：${f.folder || '技術指引'} (${(f.size/1024).toFixed(0)} KB)`,
          actionType: "viewFile",
          fileObj: f
        });
      }
    });
  }

  const allHits = [...issueMatches, ...fileMatches];
  if (countEl) countEl.textContent = allHits.length;

  if (allHits.length === 0) {
    resultsList.innerHTML = `
      <div class="search-empty-prompt">
        <i class="fa-solid fa-magnifying-glass"></i>
        <p>查無符合關鍵字「<b class="text-cyan">${rawQuery}</b>」之相關技術議題或會議文件</p>
      </div>
    `;
    return;
  }

  // 2. 總結 (Smart Executive Summary) - 只呈現技術議題庫與文件簡報
  const uniqueSites = Array.from(new Set(allHits.map(h => h.site).filter(Boolean)));

  const summaryHtml = `
    <div class="search-summary-card">
      <div class="search-summary-header">
        <i class="fa-solid fa-sparkles text-cyan"></i>
        <span>全域技術議題與文件搜尋總結</span>
      </div>
      <div style="font-size: 14px; line-height: 1.7; color: var(--text-main);">
        針對關鍵字「<b class="text-cyan">${rawQuery}</b>」，系統已過濾非技術性資料，共於 <b>${uniqueSites.length}</b> 個工區檢索出 <b>${allHits.length}</b> 筆技術結晶與檔案：
      </div>
      <div class="search-summary-stats">
        <span class="search-summary-pill"><i class="fa-solid fa-lightbulb text-amber"></i> 技術議題庫：<b>${issueMatches.length}</b> 筆</span>
        <span class="search-summary-pill"><i class="fa-solid fa-file-powerpoint text-rose"></i> 專案會議簡報：<b>${fileMatches.filter(f => f.type === 'file').length}</b> 份</span>
        <span class="search-summary-pill"><i class="fa-solid fa-book text-cyan"></i> 技術指引與模板：<b>${fileMatches.filter(f => f.type === 'guide').length}</b> 份</span>
        <a href="https://ncaio.fengyu.com.tw/f/8988" target="_blank" rel="noopener noreferrer" class="search-summary-pill" style="background: rgba(0,242,254,0.12); border-color: var(--primary); color: #a5f3fc; text-decoration: none;">
          <i class="fa-solid fa-cloud text-cyan"></i> 豊譽雲端分享專區：<b>/f/8988 (點擊開啟)</b> <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 11px;"></i>
        </a>
      </div>
    </div>
  `;

  // 3. 歸納與直接連結檔案 (Direct File Link)
  const hitsHtml = allHits.slice(0, 80).map(item => {
    const safeFile = item.fileObj ? encodeURIComponent(JSON.stringify(item.fileObj)) : "";
    const safeIssue = item.issueObj ? encodeURIComponent(JSON.stringify(item.issueObj)) : "";

    return `
      <div class="search-result-item">
        <div class="res-type-badge ${item.tagClass}">${item.typeLabel}</div>
        <div class="res-content">
          <div class="res-header-info">
            <span class="res-dept">${item.dept}</span>
            <span class="res-site">${item.site}</span>
            <span class="res-date">${formatWesternDate(item.date)}</span>
          </div>
          <h4 class="res-title">${highlightKeyword(item.title, rawQuery)}</h4>
          <p class="res-desc">${highlightKeyword(item.desc, rawQuery)}</p>
        </div>
        <div class="res-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${item.actionType === "viewIssueFile" ? `
            <button type="button" class="btn-file-view" style="white-space: nowrap;" onclick="openTechnicalIssueModal('${safeIssue}', '${safeFile}')">
              <i class="fa-solid fa-file-powerpoint"></i> 檢視/開啟議題檔案
            </button>
          ` : (safeFile ? `
            <button type="button" class="btn-file-view" style="white-space: nowrap;" onclick="openMeetingFileModal('${safeFile}')">
              <i class="fa-solid fa-eye"></i> 查看檔案
            </button>
          ` : '')}
          <a href="https://ncaio.fengyu.com.tw/f/8988" target="_blank" rel="noopener noreferrer" class="btn-table-action" style="white-space: nowrap; padding: 6px 10px; font-size: 12px;" title="在豊譽企業雲端 (/f/8988) 中存取">
            <i class="fa-solid fa-cloud text-cyan"></i> 雲端專區 (/f/8988)
          </a>
        </div>
      </div>
    `;
  }).join("");

  resultsList.innerHTML = summaryHtml + hitsHtml;
}

// 點擊技術議題直接連結與開啟來源檔案
window.openTechnicalIssueModal = function(encodedIssue, encodedFile) {
  try {
    const issue = JSON.parse(decodeURIComponent(encodedIssue));
    const file = encodedFile ? JSON.parse(decodeURIComponent(encodedFile)) : null;

    const matchedProj = (appData.projects || []).find(p => normalizeSiteName(p.shortName) === normalizeSiteName(issue.site));
    const projId = matchedProj ? matchedProj.id : "";

    const fullPath = file ? file.fullPath : `\\192.168.1.221\s5\1003技術會議資料專區\1.各專案作業區\目錄-各工地歷次會議技術議題查詢.xlsx`;

    const bodyHtml = `
      <div style="padding: 6px 0; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="proj-dept-tag">${issue.dept}</span>
          <span class="cal-filter-tag"><i class="fa-solid fa-lightbulb text-amber"></i> 技術議題庫</span>
          <span style="font-size: 13px; color: var(--text-dim); margin-left: auto;">會議日期：${formatWesternDate(issue.meetDate)}</span>
        </div>

        <h3 style="font-size: 18px; color: #a5f3fc; line-height: 1.5;">${issue.title}</h3>

        <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; font-size: 13px; line-height: 1.8;">
          <div><i class="fa-solid fa-tag text-cyan"></i> <b>工項分類：</b>${issue.category}</div>
          <div><i class="fa-solid fa-comment-dots text-emerald"></i> <b>討論與備註說明：</b>${issue.notes || '無額外備註'}</div>
          <div><i class="fa-solid fa-folder-tree text-purple"></i> <b>來源檔案位置：</b><code>${fullPath}</code></div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap;">
          <button type="button" class="btn-file-view" style="padding: 10px 18px; font-size: 14px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')">
            <i class="fa-regular fa-copy"></i> 複製 NAS 實體路徑
          </button>
          <button type="button" class="btn-file-view" style="padding: 10px 18px; font-size: 14px; background: rgba(0,242,254,0.15); border-color: var(--primary);" onclick="openFileInExplorer('${encodeURIComponent(fullPath)}')">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> 在檔案總管中開啟
          </button>
          ${file ? `
            <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 10px 18px; font-size: 14px;">
              <i class="fa-solid fa-download"></i> 下載來源檔案
            </a>
          ` : ''}
          ${projId ? `
            <button type="button" class="btn-table-action" style="padding: 10px 18px; font-size: 14px; margin-left: auto;" onclick="openProjectDrawerTab('${projId}', 'meetings'); document.getElementById('file-viewer-modal').classList.add('hidden');">
              <i class="fa-solid fa-folder-open"></i> 進入專案作業區歷次會議
            </button>
          ` : ''}
        </div>
      </div>
    `;

    openCustomModal(`💡 技術議題與檔案連結`, bodyHtml);
  } catch (e) {
    console.error("Open technical issue modal error:", e);
  }
};

function highlightKeyword(text, keyword) {
  if (!text) return "";
  if (!keyword) return text;
  const regex = new RegExp(`(${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
  return String(text).replace(regex, `<mark class="search-highlight">$1</mark>`);
}

// ==============================================================================
// 9. 檔案與會議檢視彈窗及路徑操作
// ==============================================================================
function initViewerModal() {
  if (viewerCloseBtn) {
    viewerCloseBtn.addEventListener("click", () => {
      fileViewerModal.classList.add("hidden");
    });
  }
  if (fileViewerModal) {
    fileViewerModal.addEventListener("click", (e) => {
      if (e.target === fileViewerModal) {
        fileViewerModal.classList.add("hidden");
      }
    });
  }
}

window.openMeetingFileModal = function(encodedFile) {
  try {
    const f = JSON.parse(decodeURIComponent(encodedFile));
    const titleEl = document.getElementById("viewer-file-title");
    const bodyEl = document.getElementById("viewer-body");
    if (!titleEl || !bodyEl) return;

    titleEl.innerHTML = `<i class="fa-solid ${getFileIcon(f.ext)}"></i> ${f.name}`;
    const fullPath = f.fullPath || "";

    bodyEl.innerHTML = `
      <div class="viewer-meta-box">
        <div><b>檔案名稱：</b>${f.name}</div>
        <div><b>實體路徑：</b><code>${fullPath}</code></div>
        <div><b>檔案大小：</b>${(f.size / 1024).toFixed(1)} KB ‧ <b>更新日期：</b>${f.lastModified || '未知'}</div>
      </div>

      <div style="display: flex; gap: 10px; margin: 18px 0; flex-wrap: wrap;">
        <button type="button" class="btn-file-view" style="padding: 10px 18px; font-size: 14px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')">
          <i class="fa-regular fa-copy"></i> 複製 NAS 完整實體路徑
        </button>
        <button type="button" class="btn-file-view" style="padding: 10px 18px; font-size: 14px; background: rgba(0,242,254,0.15); border-color: var(--primary);" onclick="openFileInExplorer('${encodeURIComponent(fullPath)}')">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> 在檔案總管中開啟
        </button>
        <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 10px 18px; font-size: 14px;">
          <i class="fa-solid fa-download"></i> 串流下載此檔案
        </a>
        <a href="https://ncaio.fengyu.com.tw/f/8988" target="_blank" rel="noopener noreferrer" class="btn-table-action" style="padding: 10px 18px; font-size: 14px; background: rgba(0,242,254,0.12); border-color: var(--primary); color: #a5f3fc;">
          <i class="fa-solid fa-cloud"></i> 豊譽雲端專區 (/f/8988) 開啟
        </a>
      </div>
    `;

    fileViewerModal.classList.remove("hidden");
  } catch (e) {
    console.error("Open file modal error:", e);
  }
};

window.copyNasPath = function(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  navigator.clipboard.writeText(path).then(() => {
    alert(`📋 已成功複製 NAS 實體路徑至剪貼簿：\n\n${path}\n\n您可直接貼入檔案總管或執行開啟。`);
  }).catch(() => {
    prompt("請按 Ctrl+C 複製以下 NAS 路徑：", path);
  });
};

window.openFileInExplorer = function(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  fetch("/api/open-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: path })
  }).then(res => res.json()).then(data => {
    if (data.status === "success") {
      alert("✅ 已送出開啟指令，請留意 Windows 工作列已彈出之應用程式。");
    } else {
      alert("⚠️ 本機伺服器開啟檔案回報：" + data.message);
    }
  }).catch(err => {
    alert("⚠️ 連線本機伺服器失敗，請確認於 http://localhost:8090 存取");
  });
};

window.toggleMeetingCard = function(headerEl) {
  const card = headerEl.closest('.meeting-accordion-card');
  if (card) {
    card.classList.toggle('collapsed');
  }
};

window.toggleAllMeetingCards = function() {
  const cards = document.querySelectorAll('.meeting-accordion-card');
  const anyOpen = Array.from(cards).some(c => !c.classList.contains('collapsed'));
  cards.forEach(c => {
    if (anyOpen) {
      c.classList.add('collapsed');
    } else {
      c.classList.remove('collapsed');
    }
  });
};

function openCustomModal(title, html) {
  const titleEl = document.getElementById("viewer-file-title");
  const bodyEl = document.getElementById("viewer-body");
  if (!titleEl || !bodyEl) return;
  titleEl.innerHTML = title;
  bodyEl.innerHTML = html;
  fileViewerModal.classList.remove("hidden");
}

function getFileIcon(ext) {
  if (!ext) return "fa-file";
  const e = ext.toLowerCase();
  if (e.includes("ppt")) return "fa-file-powerpoint text-rose";
  if (e.includes("xls") || e.includes("csv")) return "fa-file-excel text-emerald";
  if (e.includes("doc")) return "fa-file-word text-cyan";
  if (e.includes("pdf")) return "fa-file-pdf text-rose";
  return "fa-file-lines text-muted";
}
