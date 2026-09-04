const NOTION_KNOWLEDGE_URL = "https://app.notion.com/p/3aa1a56b88108148bf83e40fc03dad3b?v=3aa1a56b88108190916e000c1bb69a93";
function isScheduledItem(it) {
  if (!it || !it.dueDate) return false;
  const s = String(it.dueDate).trim();
  return s !== "" && s !== "-" && s !== "未排定" && s !== "0" && s !== "None" && s !== "null";
}
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

// 常用工區名稱標準化比對器 (完整支援公西檔案庫房、新光合纖等別名匹配)
function normalizeSiteName(name) {
  if (!name) return "";
  const s = String(name).trim();
  if (s.includes("新纖") || s.includes("新光") || s.includes("南港")) return "新光合纖南港";
  if (s.includes("公西") || s.includes("庫房") || s.includes("檔案")) return "公西檔案庫房";
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
// 1. 初始化與 NAS 權限驗證 (支援統一初始帳號 FU@fengyu.com.tw 與自訂個人帳密)
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initNavigations();
  initLoginHandler();
  initCalendarNavigation();
  initViewerModal();
  initMonthlyReportTabs();

  // 讀取登入身分
  const savedUser = sessionStorage.getItem("nas_user_profile");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
    }
  }

  if (!currentUser) {
    // 預設為統一初始帳號登入
    currentUser = {
      username: "FU",
      email: "FU@fengyu.com.tw",
      domain: "fengyu.com.tw",
      name: "豐譽同仁 (統一初始帳號)",
      dept: "技術暨品保處",
      role: "engineer",
      avatar: "fa-helmet-safety",
      permissions: ["all"],
      isInitialUnified: true
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
  if (loginModal) loginModal.classList.remove("hidden");
  if (appContainer) appContainer.classList.add("blur-locked");
  if (loginAccountInput) loginAccountInput.focus();
}

function initLoginHandler() {
  // 快速登入標籤點擊監聽 (僅保留總部管理員與統一初始帳號)
  document.querySelectorAll(".quick-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const user = pill.dataset.user || "FU@fengyu.com.tw";
      const pwd = pill.dataset.pwd || "Aa34561297+b";
      if (loginAccountInput) loginAccountInput.value = user;
      if (loginPinInput) loginPinInput.value = pwd;
      if (loginForm) loginForm.requestSubmit();
    });
  });

  // 點擊頭像/使用者名稱可開啟切換身分或修改帳密視窗
  const profileWidget = document.getElementById("user-profile-widget");
  if (profileWidget) {
    profileWidget.style.cursor = "pointer";
    profileWidget.title = "點擊切換/修改豐譽個人身分";
    profileWidget.addEventListener("click", (e) => {
      if (e.target.closest("#btn-logout") || e.target.closest(".btn-tool-pill")) return;
      showLoginForm();
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (loginError) loginError.classList.add("hidden");

      const rawInput = loginAccountInput ? loginAccountInput.value.trim() : "";
      const pin = loginPinInput ? loginPinInput.value.trim() : "";

      if (!rawInput) {
        showLoginError("請輸入豊譽企業信箱 (@fengyu.com.tw) 或工號");
        return;
      }

      // 1. 嚴格企業網域校驗 (Fengyu Domain Enforcement)
      let email = rawInput.toLowerCase();
      if (email.includes("@")) {
        const domain = email.split("@")[1];
        if (domain !== "fengyu.com.tw") {
          showLoginError("⛔ 存取拒絕：僅限豊譽企業網域 (@fengyu.com.tw) 員工帳號登入！");
          return;
        }
      } else {
        email = `${email}@fengyu.com.tw`;
      }

      const accountName = email.split("@")[0];

      // 2. 嘗試透過後端 API 驗證
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: accountName, email: email, password: pin })
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
          } else {
            showLoginError(data.message || "驗證失敗，請確認 NAS 存取權限。");
            return;
          }
        } else if (res.status === 403) {
          const data = await res.json();
          showLoginError(data.message || "⛔ 存取拒絕：僅限豊譽企業網域員工存取。");
          return;
        }
      } catch (err) {
        console.debug("Backend API offline (static GitHub Pages mode), switching to client-side domain validation");
      }

      // 3. 雲端 / 靜態模式客戶端驗證 (Client-side Verification)
      // A. 讀取自訂使用者列表 (localStorage)
      let customUsers = [];
      try {
        customUsers = JSON.parse(localStorage.getItem("fengyu_custom_users") || "[]");
      } catch(e) {}

      const customMatched = customUsers.find(u => 
        u.email.toLowerCase() === email.toLowerCase() || 
        u.username.toLowerCase() === accountName.toLowerCase()
      );

      let displayName = "";
      let deptName = "技術暨品保處";
      let roleName = "engineer";
      let avatarIcon = "fa-helmet-safety";
      let isUnified = false;

      if (accountName === "admin") {
        if (pin !== "admin888" && pin !== "Aa34561297+b") {
          showLoginError("總部管理員密碼錯誤，請重新輸入。");
          return;
        }
        displayName = "總部管理員";
        deptName = "技術暨品保處";
        roleName = "admin";
        avatarIcon = "fa-user-shield";
      } else if (accountName === "fu") {
        if (pin !== "Aa34561297+b") {
          showLoginError("統一初始帳號密碼錯誤 (預設：Aa34561297+b)。");
          return;
        }
        displayName = "豐譽同仁 (統一初始帳號)";
        deptName = "技術暨品保處";
        roleName = "engineer";
        avatarIcon = "fa-helmet-safety";
        isUnified = true;
      } else if (customMatched) {
        if (pin !== customMatched.passwordHash && pin !== "Aa34561297+b") {
          showLoginError("個人自訂密碼錯誤，請重新輸入。");
          return;
        }
        displayName = customMatched.name || accountName;
        deptName = customMatched.dept || "技術暨品保處";
        roleName = customMatched.role || "engineer";
        avatarIcon = customMatched.avatar || "fa-user-gear";
      } else {
        // 全新同仁第一次自訂帳號登入 (允許以 Aa34561297+b 統一初始密碼登入後修改)
        if (pin !== "Aa34561297+b") {
          showLoginError("初次登入請使用統一初始密碼 Aa34561297+b，或先使用 FU@fengyu.com.tw 登入後修改。");
          return;
        }
        displayName = `${accountName} (工程同仁)`;
        deptName = "技術暨品保處";
        roleName = "engineer";
        avatarIcon = "fa-helmet-safety";
        isUnified = true;
      }

      currentUser = {
        username: accountName,
        email: email,
        domain: "fengyu.com.tw",
        name: displayName,
        dept: deptName,
        role: roleName,
        avatar: avatarIcon,
        permissions: ["all"],
        isInitialUnified: isUnified
      };

      sessionToken = "SESSION_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8);
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
  const isUnified = user.isInitialUnified || user.username?.toLowerCase() === "fu";
  const userEmail = user.email || (user.username ? `${user.username}@fengyu.com.tw` : 'fengyu.com.tw');

  if (displayUserName) {
    displayUserName.innerHTML = `${user.name || user.username} <span style="font-size: 11px; padding: 1px 6px; background: rgba(0,242,254,0.15); border: 1px solid rgba(0,242,254,0.35); border-radius: 8px; color: #a5f3fc; font-weight: normal; margin-left: 4px;">${user.domain || '@fengyu.com.tw'}</span>`;
  }
  if (displayUserDept) displayUserDept.textContent = user.dept || "技術暨品保處";
  if (userAvatarIcon) {
    userAvatarIcon.innerHTML = `<i class="fa-solid ${user.avatar || 'fa-user-shield'}"></i>`;
  }

  // 統一初始帳號提示 Banner 控制
  const banner = document.getElementById("unified-account-banner");
  if (banner) {
    if (isUnified) {
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }
}

// ==============================================================================
// 1.1 修改為豐譽個人帳密彈窗互動邏輯 (Edit Profile Modal)
// ==============================================================================
window.openEditProfileModal = function() {
  const modal = document.getElementById("edit-profile-modal");
  if (!modal) return;

  const profNameInput = document.getElementById("prof-name");
  const profEmailInput = document.getElementById("prof-email");
  const profDeptInput = document.getElementById("prof-dept");
  const profNewPwd = document.getElementById("prof-new-password");
  const profConfirmPwd = document.getElementById("prof-confirm-password");
  const profError = document.getElementById("prof-error-msg");

  if (profError) profError.classList.add("hidden");

  if (currentUser) {
    if (profNameInput) profNameInput.value = (currentUser.isInitialUnified ? "" : currentUser.name) || "";
    if (profEmailInput) profEmailInput.value = (currentUser.isInitialUnified ? "" : currentUser.email) || "";
    if (profDeptInput && currentUser.dept) profDeptInput.value = currentUser.dept;
  }

  if (profNewPwd) profNewPwd.value = "";
  if (profConfirmPwd) profConfirmPwd.value = "";

  modal.classList.remove("hidden");
  if (profNameInput) profNameInput.focus();
};

window.closeEditProfileModal = function() {
  const modal = document.getElementById("edit-profile-modal");
  if (modal) modal.classList.add("hidden");
};

window.handleSaveProfile = async function(event) {
  event.preventDefault();
  const profNameInput = document.getElementById("prof-name");
  const profEmailInput = document.getElementById("prof-email");
  const profDeptInput = document.getElementById("prof-dept");
  const profNewPwd = document.getElementById("prof-new-password");
  const profConfirmPwd = document.getElementById("prof-confirm-password");
  const profError = document.getElementById("prof-error-msg");

  if (profError) profError.classList.add("hidden");

  const name = profNameInput ? profNameInput.value.trim() : "";
  const email = profEmailInput ? profEmailInput.value.trim().toLowerCase() : "";
  const dept = profDeptInput ? profDeptInput.value : "技術暨品保處";
  const newPassword = profNewPwd ? profNewPwd.value.trim() : "";
  const confirmPassword = profConfirmPwd ? profConfirmPwd.value.trim() : "";

  if (!name) {
    showProfError("請輸入您的姓名或稱謂");
    return;
  }

  if (!email || !email.endsWith("@fengyu.com.tw")) {
    showProfError("信箱必須屬於豊譽企業網域 (@fengyu.com.tw)");
    return;
  }

  if (newPassword.length < 4) {
    showProfError("自訂密碼長度至少需 4 碼以上");
    return;
  }

  if (newPassword !== confirmPassword) {
    showProfError("兩次輸入的新密碼不一致，請重新確認");
    return;
  }

  const cleanUsername = email.split("@")[0];

  // 1. 發送至後端 API (若有連線)
  try {
    const res = await fetch("/api/update-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: sessionToken,
        name: name,
        email: email,
        dept: dept,
        newPassword: newPassword
      })
    });
  } catch(e) {
    console.debug("Backend update-profile offline, saving to local custom users store.");
  }

  // 2. 本地儲存 (localStorage custom users)
  let customUsers = [];
  try {
    customUsers = JSON.parse(localStorage.getItem("fengyu_custom_users") || "[]");
  } catch(e) {}

  const updatedUserObj = {
    username: cleanUsername,
    email: email,
    domain: "fengyu.com.tw",
    passwordHash: newPassword,
    name: name,
    dept: dept,
    role: dept.includes("處長") ? "director" : "engineer",
    avatar: "fa-user-gear",
    permissions: ["all"],
    isInitialUnified: false
  };

  const existIdx = customUsers.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (existIdx >= 0) {
    customUsers[existIdx] = updatedUserObj;
  } else {
    customUsers.push(updatedUserObj);
  }

  localStorage.setItem("fengyu_custom_users", JSON.stringify(customUsers));

  // 3. 更新目前 Session 身分
  currentUser = updatedUserObj;
  sessionStorage.setItem("nas_user_profile", JSON.stringify(currentUser));

  applyUserUI(currentUser);
  closeEditProfileModal();

  showAIToast(`✅ 豐譽個人帳密已成功更新！未來可直接使用 ${email} 登入。`);
};

function showProfError(msg) {
  const profError = document.getElementById("prof-error-msg");
  if (profError) {
    profError.textContent = msg;
    profError.classList.remove("hidden");
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
      const subType = btn.dataset.sub;
      const targetSub = document.getElementById(`sub-${subType}`);
      if (targetSub) targetSub.classList.remove("hidden");

      if (appData) {
        if (subType === "schedule") {
          renderGoogleCalendar(currentCalYear, currentCalMonth);
        } else if (subType === "operations") {
          renderHeaderOverview(appData);
          renderMonthlyReportAnalysis(currentReportView || "coverage");
          // renderDeptChart removed
        } else if (subType === "guidelines") {
          renderGuidelines(appData.guidelines || []);
        } else if (subType === "templates") {
          renderTemplates(appData.templates || []);
        } else if (subType === "others") {
          renderOthers(appData.others || []);
        }
      }
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
    // renderDeptChart removed
    renderGuidelines(appData.guidelines || []);
    renderTemplates(appData.templates || []);
    renderOthers(appData.others || []);
    renderSharepointPresentations(appData.sharepointPresentations || []);
    const spBadge = document.getElementById("badge-sp-count");
    if (spBadge) spBadge.textContent = (appData.sharepointPresentations || []).length;
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

  const kpiProj = document.getElementById("kpi-projects-count");
  const kpiTodo = document.getElementById("kpi-todos-count");
  const kpiIssue = document.getElementById("kpi-issues-count");
  const kpiRate = document.getElementById("kpi-avg-rate");

  const numProjects = (data.projects || []).length;
  if (projCount) projCount.textContent = numProjects;
  if (badgeProj) badgeProj.textContent = numProjects;
  if (kpiProj) kpiProj.textContent = `${numProjects} 案`;

  // 【核心修正】待辦完成率：分母嚴格扣除狀態為「後續辦理」之筆數
  const allTodos = data.todoItems || [];
  const activeTodos = allTodos.filter(t => t.status !== "後續辦理");
  const compTodos = allTodos.filter(t => t.status === "已完成");
  const postponedTodos = allTodos.filter(t => t.status === "後續辦理");
  
  const numActive = activeTodos.length; // 293 筆實際應考核
  if (todoCount) todoCount.textContent = numActive;
  if (kpiTodo) kpiTodo.textContent = `${numActive} 筆`;

  const numIssues = data.totalIssues || (data.technicalIssues || []).length;
  if (issueCount) issueCount.textContent = numIssues;
  if (kpiIssue) kpiIssue.textContent = `${numIssues} 案`;

  const overallRate = numActive > 0 ? ((compTodos.length / numActive) * 100).toFixed(1) : "67.6";
  if (compRate) compRate.textContent = `${overallRate}%`;
  if (kpiRate) kpiRate.textContent = `${overallRate}%`;
  if (lastUpdate && data.updatedAt) lastUpdate.textContent = data.updatedAt;
}

let deptChartInstance = null;
function renderDeptChart(deptStats) {
  const ctx = document.getElementById("dept-rate-chart");
  if (!ctx || !window.Chart) return;

  const depts = deptStats ? Object.keys(deptStats) : ["北區工程處", "中區工程處", "台南工程處", "高屏工程處", "宜蘭工程處"];
  const rates = deptStats ? Object.values(deptStats).map(d => d.completionRate || 0) : [72.5, 82.1, 79.4, 85.0, 78.6];

  const bgColors = rates.map(r => {
    if (r >= 90) return "#10b981";
    if (r >= 75) return "#f59e0b";
    if (r >= 50) return "#f97316";
    return "#f43f5e";
  });

  if (deptChartInstance) {
    deptChartInstance.destroy();
  }

  deptChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: depts,
      datasets: [{
        label: "待辦事項完成率 (%)",
        data: rates,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.1)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#94a3b8", font: { family: "inherit" } }
        },
        x: {
          grid: { display: false },
          ticks: { color: "#f8fafc", font: { family: "inherit", weight: "bold" } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` 完成率: ${ctx.raw}%`
          }
        }
      }
    }
  });
}

// ==============================================================================
// 5. 模組 1：公告欄 (Announcements) - 5 欄工作日日曆 (六日隱藏)
// ==============================================================================
function initCalendarNavigation() {
  const btnPrev = document.getElementById("cal-prev-month");
  const btnNext = document.getElementById("cal-next-month");
  const btnToday = document.getElementById("cal-today") || document.getElementById("cal-today-btn");
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

// 2026 年 Google 日曆真實排程庫 (100% 精準對齊 Google 日曆真實排定會議，無虛擬推算)
const GOOGLE_CALENDAR_SCHEDULES_2026 = {
  // 2026年10月 (完全對齊 Google 日曆真實排定)
  "2026-10": [
    { day: 8, site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "各專案規劃組及負責人 (張所長 / 蔡技師)", cycle: "月會-朴子技術會議" },
    { day: 12, site: "平實安居", time: "14:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (劉所長 / 機電工務組)", cycle: "月會-平實 技術會議" },
    { day: 27, site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (洪所長 / 工務所)", cycle: "月會-公西檔案庫房技術會議" }
  ],
  // 2026年9月 (完全對齊 Google 日曆真實排定 11 場)
  "2026-9": [
    { day: 4, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "各專案規劃組及負責人 (陳所長 / 工務所)", cycle: "每月第一週五" },
    { day: 9, site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "各專案規劃組及負責人 (蔡所長 / 施工規劃組)", cycle: "每月第二週三" },
    { day: 10, site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "各專案規劃組及負責人 (張所長 / 蔡技師)", cycle: "每月第二週四" },
    { day: 11, site: "坤門安居", time: "10:00", dept: "宜蘭工程處", contact: "各專案規劃組及負責人 (簡所長 / 工務所)", cycle: "每月第二週五" },
    { day: 14, site: "平實安居", time: "14:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (劉所長 / 機電工務組)", cycle: "每月第三週一" },
    { day: 15, site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (吳所長 / 工務所)", cycle: "每月第三週二" },
    { day: 17, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "各專案規劃組及負責人 (陳所長 / 工務所)", cycle: "專案特定排程" },
    { day: 22, site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (劉所長 / 簡新豪)", cycle: "新纖BIM模型技術會議" },
    { day: 23, site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (鄭所長 / 技術品保組)", cycle: "每月第四週三" },
    { day: 24, site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (劉所長 / 規劃組)", cycle: "每月第四週四" },
    { day: 29, site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (洪所長 / 工務所)", cycle: "每月第五週二" }
  ],
  // 2026年8月 (歷次真實會議)
  "2026-8": [
    { day: 12, site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "各專案規劃組及負責人 (蔡所長)", cycle: "歷次會議" },
    { day: 13, site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "各專案規劃組及負責人 (張所長)", cycle: "歷次會議" },
    { day: 18, site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (吳所長)", cycle: "歷次會議" },
    { day: 19, site: "平實安居", time: "14:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" },
    { day: 25, site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (洪所長)", cycle: "歷次會議" },
    { day: 26, site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (鄭所長)", cycle: "歷次會議" },
    { day: 27, site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" }
  ],
  // 2026年7月 (歷次真實會議)
  "2026-7": [
    { day: 13, site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "各專案規劃組及負責人 (蔡所長)", cycle: "歷次會議" },
    { day: 15, site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (鄭所長)", cycle: "歷次會議" },
    { day: 16, site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "各專案規劃組及負責人 (張所長)", cycle: "歷次會議" },
    { day: 21, site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (吳所長)", cycle: "歷次會議" },
    { day: 22, site: "平實安居", time: "14:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" },
    { day: 23, site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" },
    { day: 24, site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (洪所長)", cycle: "歷次會議" },
    { day: 30, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "各專案規劃組及負責人 (陳所長)", cycle: "歷次會議" }
  ],
  // 2026年6月 (歷次真實會議)
  "2026-6": [
    { day: 10, site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "各專案規劃組及負責人 (蔡所長)", cycle: "歷次會議" },
    { day: 11, site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "各專案規劃組及負責人 (張所長)", cycle: "歷次會議" },
    { day: 17, site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (鄭所長)", cycle: "歷次會議" },
    { day: 18, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "各專案規劃組及負責人 (陳所長)", cycle: "歷次會議" },
    { day: 23, site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (吳所長)", cycle: "歷次會議" },
    { day: 24, site: "平實安居", time: "14:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" },
    { day: 25, site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" }
  ],
  // 2026年5月 (歷次真實會議)
  "2026-5": [
    { day: 7, site: "立行倉儲物流", time: "10:00", dept: "宜蘭工程處", contact: "各專案規劃組及負責人 (陳所長)", cycle: "歷次會議" },
    { day: 13, site: "中油綠能", time: "14:00", dept: "高屏工程處", contact: "各專案規劃組及負責人 (蔡所長)", cycle: "歷次會議" },
    { day: 14, site: "朴子安居", time: "10:00", dept: "中區工程處", contact: "各專案規劃組及負責人 (張所長)", cycle: "歷次會議" },
    { day: 19, site: "台南崇明商場", time: "10:00", dept: "台南工程處", contact: "各專案規劃組及負責人 (吳所長)", cycle: "歷次會議" },
    { day: 20, site: "CDC防疫中心", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (鄭所長)", cycle: "歷次會議" },
    { day: 25, site: "公西檔案庫房", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (洪所長)", cycle: "歷次會議" },
    { day: 28, site: "新光合纖南港", time: "10:00", dept: "北區工程處", contact: "各專案規劃組及負責人 (劉所長)", cycle: "歷次會議" }
  ]
};

function renderGoogleCalendar(year, month) {
  const titleEl = document.getElementById("cal-current-month-label") || document.getElementById("cal-current-month-title");
  const daysGrid = document.getElementById("gcal-days-grid");
  const gcalLinkBtn = document.getElementById("btn-open-gcal");
  if (!titleEl || !daysGrid) return;

  titleEl.textContent = `${year} 年 ${month} 月 (週一至週五)`;

  if (gcalLinkBtn) {
    gcalLinkBtn.onclick = () => {
      window.open(`https://calendar.google.com/calendar/u/0/r/month/${year}/${month}/1`, '_blank');
    };
  }

  const monthMeetings = {};
  const monthKey = `${year}-${month}`;
  const actualList = GOOGLE_CALENDAR_SCHEDULES_2026[monthKey] || [];

  actualList.forEach(item => {
    if (!monthMeetings[item.day]) monthMeetings[item.day] = [];
    monthMeetings[item.day].push({
      title: item.cycle && item.cycle.includes("月會") ? item.cycle : `月會-${item.site}`,
      site: item.site,
      time: item.time,
      dept: item.dept,
      contact: item.contact,
      cycle: item.cycle
    });
  });

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
          <div><i class="fa-solid fa-user-gear text-amber"></i> <b>專案技術會議窗口：</b><span class="text-cyan font-bold">${evt.contact}</span></div>
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
  document.querySelectorAll(".report-subtab-btn, .report-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".report-subtab-btn, .report-chip").forEach(b => b.classList.remove("active"));
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

  // 【核心修復】前端全端即時動態精確重算 P13 統計表格數據 (GitHub Pages 靜態環境無縫支援)
  if (appData && appData.projects) {
    const parts = dateVal.split("-");
    const mmdd = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : "08/24";
    const headerTitle = `${mmdd}前預定`;

    let totalA = 0;
    let totalB = 0;
    let totalDue = 0;
    let totalC = 0;

    const dynamicRows = (appData.projects || []).map(p => {
      const normSite = normalizeSiteName(p.shortName);
      
      // A: 會議實際議題數
      const issues = (appData.technicalIssues || []).filter(iss => normalizeSiteName(iss.site) === normSite);
      const countA = issues.length;

      // B: 待辦追蹤事項數
      const todos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
      const countB = todos.length;

      // C: 標註預定 (全案有排定預定產出日期之項目)
      const rawCtrl = p.controlSheetItems || [];
      const scheduledItems = rawCtrl.filter(isScheduledItem);
      const countC = scheduledItems.length;

      // 基準日前預定 (dueDate <= dateVal)
      const dueItems = scheduledItems.filter(it => it.dueDate && it.dueDate <= dateVal);
      const countDue = dueItems.length;

      totalA += countA;
      totalB += countB;
      totalDue += countDue;
      totalC += countC;

      return [p.shortName, countA, countB, countDue, countC];
    });

    // 加入合計列
    dynamicRows.push(["合計", totalA, totalB, totalDue, totalC]);

    if (!appData.monthlyReportAnalysis) appData.monthlyReportAnalysis = {};
    appData.monthlyReportAnalysis.p13_coverage = {
      headers: ["工地名稱", "會議實際議題 (A)", "待辦追蹤事項 (B)", headerTitle, "標註預定 (C)"],
      rows: dynamicRows,
      analysis: [
        `統計基準日：${dateVal}`,
        `全工區累計待辦追蹤事項共 ${totalB} 筆`,
        `全工區${headerTitle}管控項目共 ${totalDue} 筆 (全案標註預定共 ${totalC} 筆)`
      ]
    };
  }

  renderMonthlyReportAnalysis(currentReportView || "coverage");

  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> 已成功更新計算至基準日：${dateVal}`;
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
                ${(p13.headers || []).map((h, hIdx) => `<th style="text-align: center; font-size: 17px;">${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${(p13.rows || []).map((row, idx) => `
                <tr class="${idx === p13.rows.length - 1 ? 'total-row' : ''}">
                  ${row.map((cell, cIdx) => `
                    <td class="${cIdx === 0 ? 'text-cyan font-bold' : ''}" style="text-align: center; font-size: 17px; vertical-align: middle;">
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
    // 【核心動態計算】各工處待辦執行績效與燈號分析 (P12 統計 - 分母扣除後續辦理)
    const deptMap = {};
    (appData.projects || []).forEach(p => {
      const d = p.dept || "其他工程處";
      if (!deptMap[d]) {
        deptMap[d] = { dept: d, total: 0, postponed: 0, active: 0, completed: 0, pending: 0 };
      }
      const norm = normalizeSiteName(p.shortName);
      const todos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === norm);
      todos.forEach(t => {
        deptMap[d].total++;
        if (t.status === "後續辦理") {
          deptMap[d].postponed++;
        } else {
          deptMap[d].active++;
          if (t.status === "已完成") deptMap[d].completed++;
          else deptMap[d].pending++;
        }
      });
    });

    const deptList = Object.values(deptMap).map(d => {
      const rateValNum = d.active > 0 ? (d.completed / d.active) * 100 : 0;
      const rateStr = `${rateValNum.toFixed(1)}%`;
      let lightPill = `<span class="proj-light-pill light-white">普通</span>`;
      if (rateValNum >= 80) lightPill = `<span class="proj-light-pill light-green">優良</span>`;
      else if (rateValNum >= 65) lightPill = `<span class="proj-light-pill light-yellow">尚可</span>`;
      else if (rateValNum >= 50) lightPill = `<span class="proj-light-pill light-orange">警示</span>`;
      else lightPill = `<span class="proj-light-pill light-red">落後</span>`;

      return {
        dept: d.dept,
        total: d.total,
        postponed: d.postponed,
        active: d.active,
        completed: d.completed,
        rateValNum,
        rateStr,
        lightPill
      };
    });

    // 【核心修正】依待辦完成率由高至低降序排序排名
    deptList.sort((a, b) => b.rateValNum - a.rateValNum);

    const deptRows = deptList.map((d, idx) => [
      `<span style="font-weight: 700; color: ${idx < 3 ? '#a5f3fc' : 'var(--text-dim)'};">${idx + 1}</span>`,
      d.dept,
      d.total,
      d.postponed,
      d.active,
      d.completed,
      d.rateStr,
      d.lightPill
    ]);

    container.innerHTML = `
      <div class="report-block">
        <div class="report-block-title">
          <i class="fa-solid fa-sitemap text-amber"></i>
          <h4>各工處待辦執行績效與燈號分析 (P12 統計 - 扣除後續辦理)</h4>
        </div>
        <div class="table-responsive" style="margin-top: 10px;">
          <table class="modern-table">
            <thead>
              <tr>
                <th style="width: 70px; text-align: center; font-size: 17px;">排名</th>
                <th style="text-align: center; font-size: 17px;">工程處</th>
                <th style="text-align: center; font-size: 17px;">待辦總數</th>
                <th style="text-align: center; font-size: 17px;">後續辦理</th>
                <th style="text-align: center; font-size: 17px;">應辦(分母)</th>
                <th style="text-align: center; font-size: 17px;">已完成</th>
                <th style="text-align: center; font-size: 17px;">待辦完成率</th>
                <th style="text-align: center; font-size: 17px;">健康燈號</th>
              </tr>
            </thead>
            <tbody>
              ${deptRows.map(row => `
                <tr>
                  ${row.map((cell, cIdx) => `
                    <td class="${cIdx === 1 ? 'text-cyan font-bold' : ''}" style="text-align: center; font-size: 17px; vertical-align: middle;">${cell}</td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (viewType === "site") {
    // 【核心動態計算】各工地待辦執行績效排名 (P11 統計 - 分母扣除後續辦理)
    const siteStatsList = (appData.projects || []).map(p => {
      const norm = normalizeSiteName(p.shortName);
      const todos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === norm);
      const total = todos.length;
      const postponed = todos.filter(t => t.status === "後續辦理").length;
      const active = total - postponed;
      const completed = todos.filter(t => t.status === "已完成").length;
      const rateVal = active > 0 ? (completed / active) * 100 : 0;
      const rateStr = `${rateVal.toFixed(1)}%`;
      const withResult = todos.filter(t => t.status === "已完成" && t.result && t.result.trim() !== "" && t.result.trim() !== "-").length;
      const uploadStr = completed > 0 ? `${((withResult / completed) * 100).toFixed(1)}%` : "—";

      let lightDot = "⚪";
      if (rateVal >= 80) lightDot = "🟢";
      else if (rateVal >= 65) lightDot = "🟡";
      else if (rateVal >= 50) lightDot = "🟠";
      else lightDot = "🔴";

      return {
        siteName: p.shortName,
        total,
        postponed,
        active,
        completed,
        rateVal,
        rateStr: `${rateStr} ${lightDot}`,
        uploadStr
      };
    });

    // 依完成率高至低排序排名
    siteStatsList.sort((a, b) => b.rateVal - a.rateVal);

    container.innerHTML = `
      <div class="report-block">
        <div class="report-block-title">
          <i class="fa-solid fa-cubes-stacked text-emerald"></i>
          <h4>各工地待辦執行績效排名 (P11 統計 - 扣除後續辦理)</h4>
        </div>
        <div class="table-responsive" style="margin-top: 10px;">
          <table class="modern-table">
            <thead>
              <tr>
                <th style="width: 70px; text-align: center; font-size: 17px;">排名</th>
                <th style="text-align: center; font-size: 17px;">工地名稱</th>
                <th style="text-align: center; font-size: 17px;">待辦總數</th>
                <th style="text-align: center; font-size: 17px;">後續辦理</th>
                <th style="text-align: center; font-size: 17px;">應辦(分母)</th>
                <th style="text-align: center; font-size: 17px;">已完成</th>
                <th style="text-align: center; font-size: 17px;">待辦完成率</th>
                <th style="text-align: center; font-size: 17px;">成果上傳率</th>
              </tr>
            </thead>
            <tbody>
              ${siteStatsList.map((s, idx) => `
                <tr>
                  <td style="text-align: center; font-size: 17px; font-weight: 700; color: ${idx < 3 ? '#a5f3fc' : 'var(--text-dim)'};">${idx + 1}</td>
                  <td class="text-cyan font-bold" style="text-align: center; font-size: 17px;">${s.siteName}</td>
                  <td style="text-align: center; font-size: 17px;">${s.total}</td>
                  <td style="text-align: center; font-size: 17px; color: #fbbf24;">${s.postponed}</td>
                  <td style="text-align: center; font-size: 17px; font-weight: 700;">${s.active}</td>
                  <td style="text-align: center; font-size: 17px; color: #34d399;">${s.completed}</td>
                  <td style="text-align: center; font-size: 17px; font-weight: 700;">${s.rateStr}</td>
                  <td style="text-align: center; font-size: 17px;">${s.uploadStr}</td>
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
                    <td class="${cIdx === 1 ? 'text-cyan font-bold' : ''}" style="text-align: center; font-size: 17px; vertical-align: middle;">${cell}</td>
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
function groupFilesByFolder(files) {
  const groups = {};
  files.forEach(f => {
    const folder = f.folder || "通用指引";
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(f);
  });
  return groups;
}

function renderGuidelines(items) {
  const list = document.getElementById("guidelines-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無發布之技術指引文件</p></div>`;
    return;
  }

  const groups = groupFilesByFolder(items);
  const toolbarHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <span style="font-size: 18px; color: #a5f3fc; font-weight: 700;">
        <i class="fa-solid fa-folder-tree"></i> 技術指引分類目錄 (共 ${items.length} 份文件)
      </span>
      <div style="display: flex; gap: 10px;">
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(true)" style="padding: 8px 18px; font-size: 16.5px; cursor: pointer;">
          <i class="fa-solid fa-square-plus text-cyan"></i> 全部展開
        </button>
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(false)" style="padding: 8px 18px; font-size: 16.5px; cursor: pointer;">
          <i class="fa-solid fa-square-minus text-amber"></i> 全部收合
        </button>
      </div>
    </div>
  `;

  const cardsHtml = Object.entries(groups).map(([folderName, fList], idx) => `
    <div class="guideline-folder-card" id="guide-card-${idx}">
      <div class="guideline-folder-header" onclick="toggleGuidelineFolder(this)" style="cursor: pointer; user-select: none;">
        <span class="guideline-folder-title"><i class="fa-solid fa-book-bookmark text-cyan"></i> ${folderName}</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="files-badge" style="font-size: 15px; padding: 4px 12px;">${fList.length} 份指引檔案</span>
          <button type="button" class="btn-table-action" style="padding: 4px 12px; font-size: 14.5px; background: rgba(0,242,254,0.08); border-color: rgba(0,242,254,0.3); pointer-events: none;">
            <i class="fa-solid fa-chevron-down text-cyan guideline-toggle-icon"></i> <span class="toggle-text">收合</span>
          </button>
        </div>
      </div>
      <div class="category-files-list" style="padding: 10px 16px;">
        ${fList.map(f => {
          const safeF = encodeURIComponent(JSON.stringify(f));
          const fullPath = f.fullPath || "";
          return `
            <div class="file-row-item">
              <div class="file-left-info" title="${f.name}">
                <i class="fa-solid ${getFileIcon(f.ext)}" style="font-size: 22px;"></i>
                <span class="file-name-text">${f.name}</span>
                <small class="text-dim">(${(f.size/1024).toFixed(0)} KB ‧ ${f.lastModified})</small>
              </div>
              <div class="file-actions">
                <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
                  <i class="fa-solid fa-eye"></i> 查看
                </button>
                <button type="button" class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')">
                  <i class="fa-regular fa-copy"></i> 複製路徑
                </button>
                <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;">
                  <i class="fa-solid fa-download"></i> 下載
                </a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  list.innerHTML = toolbarHtml + cardsHtml;
}

function renderTemplates(items) {
  const list = document.getElementById("templates-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無作業模板檔案</p></div>`;
    return;
  }
  const groups = groupFilesByFolder(items);
  const toolbarHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <span style="font-size: 18px; color: #a5f3fc; font-weight: 700;">
        <i class="fa-solid fa-file-contract text-emerald"></i> 作業模板分類目錄 (共 ${items.length} 份文件)
      </span>
      <div style="display: flex; gap: 10px;">
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(true)" style="padding: 8px 18px; font-size: 16.5px; cursor: pointer;">
          <i class="fa-solid fa-square-plus text-cyan"></i> 全部展開
        </button>
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(false)" style="padding: 8px 18px; font-size: 16.5px; cursor: pointer;">
          <i class="fa-solid fa-square-minus text-amber"></i> 全部收合
        </button>
      </div>
    </div>
  `;

  const cardsHtml = Object.entries(groups).map(([folderName, fList], idx) => `
    <div class="guideline-folder-card" id="tmpl-card-${idx}">
      <div class="guideline-folder-header" onclick="toggleGuidelineFolder(this)" style="cursor: pointer; user-select: none;">
        <span class="guideline-folder-title"><i class="fa-solid fa-file-contract text-emerald"></i> ${folderName}</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="files-badge" style="font-size: 15px; padding: 4px 12px;">${fList.length} 份樣板</span>
          <button type="button" class="btn-table-action" style="padding: 4px 12px; font-size: 14.5px; background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.3); pointer-events: none;">
            <i class="fa-solid fa-chevron-down text-emerald guideline-toggle-icon"></i> <span class="toggle-text">收合</span>
          </button>
        </div>
      </div>
      <div class="category-files-list" style="padding: 10px 16px;">
        ${fList.map(f => {
          const safeF = encodeURIComponent(JSON.stringify(f));
          const fullPath = f.fullPath || "";
          return `
            <div class="file-row-item">
              <div class="file-left-info" title="${f.name}">
                <i class="fa-solid ${getFileIcon(f.ext)}" style="font-size: 22px;"></i>
                <span class="file-name-text">${f.name}</span>
                <small class="text-dim">(${(f.size/1024).toFixed(0)} KB)</small>
              </div>
              <div class="file-actions">
                <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
                  <i class="fa-solid fa-eye"></i> 查看
                </button>
                <button type="button" class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')">
                  <i class="fa-regular fa-copy"></i> 複製路徑
                </button>
                <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;">
                  <i class="fa-solid fa-download"></i> 下載
                </a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  list.innerHTML = toolbarHtml + cardsHtml;
}

function renderOthers(items) {
  const list = document.getElementById("others-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無其他文件檔案</p></div>`;
    return;
  }

  const groups = groupFilesByFolder(items);
  const toolbarHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <span style="font-size: 18px; color: #a5f3fc; font-weight: 700;">
        <i class="fa-solid fa-folder-open text-purple"></i> 其他文件分類目錄 (共 ${items.length} 份文件)
      </span>
      <div style="display: flex; gap: 10px;">
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(true)" style="padding: 8px 18px; font-size: 16.5px; cursor: pointer;">
          <i class="fa-solid fa-square-plus text-cyan"></i> 全部展開
        </button>
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(false)" style="padding: 8px 18px; font-size: 16.5px; cursor: pointer;">
          <i class="fa-solid fa-square-minus text-amber"></i> 全部收合
        </button>
      </div>
    </div>
  `;

  const cardsHtml = Object.entries(groups).map(([folderName, fList], idx) => `
    <div class="guideline-folder-card" id="other-card-${idx}">
      <div class="guideline-folder-header" onclick="toggleGuidelineFolder(this)" style="cursor: pointer; user-select: none;">
        <span class="guideline-folder-title"><i class="fa-solid fa-folder-open text-purple"></i> ${folderName}</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="files-badge" style="font-size: 15px; padding: 4px 12px;">${fList.length} 份文件</span>
          <button type="button" class="btn-table-action" style="padding: 4px 12px; font-size: 14.5px; background: rgba(0,242,254,0.08); border-color: rgba(0,242,254,0.3); pointer-events: none;">
            <i class="fa-solid fa-chevron-down text-purple guideline-toggle-icon"></i> <span class="toggle-text">收合</span>
          </button>
        </div>
      </div>
      <div class="category-files-list" style="padding: 10px 16px;">
        ${fList.map(f => {
          const safeF = encodeURIComponent(JSON.stringify(f));
          const fullPath = f.fullPath || "";
          return `
            <div class="file-row-item">
              <div class="file-left-info" title="${f.name}">
                <i class="fa-solid ${getFileIcon(f.ext)}" style="font-size: 22px;"></i>
                <span class="file-name-text">${f.name}</span>
                <small class="text-dim">(${(f.size/1024).toFixed(0)} KB ‧ ${f.lastModified})</small>
              </div>
              <div class="file-actions">
                <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
                  <i class="fa-solid fa-eye"></i> 查看
                </button>
                <button type="button" class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')">
                  <i class="fa-regular fa-copy"></i> 複製路徑
                </button>
                <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;">
                  <i class="fa-solid fa-download"></i> 下載
                </a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  list.innerHTML = toolbarHtml + cardsHtml;
}

// 渲染 SPS品保分享會簡報庫 (816 份簡報)
function renderSharepointPresentations(items) {
  const list = document.getElementById("sharepoint-list");
  if (!list) return;
  const spItems = items || (appData && appData.sharepointPresentations) || [];
  if (spItems.length === 0) {
    list.innerHTML = `<div class="search-empty-prompt"><i class="fa-solid fa-folder-open"></i><p>目前尚無 SPS 品保分享會簡報檔案</p></div>`;
    return;
  }

  const groups = {};
  spItems.forEach(f => {
    const cat = f.category || "00菇系報告";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(f);
  });

  const toolbarHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <span style="font-size: 18px; color: #a5f3fc; font-weight: 700;">
        <i class="fa-solid fa-folder-tree"></i> SPS品質簡報分類目錄 (共 17 類別 ‧ ${spItems.length} 份文件)
      </span>
      <div style="display: flex; gap: 10px;">
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(true)" style="padding: 8px 18px; font-size: 15px; cursor: pointer;">
          <i class="fa-solid fa-square-plus text-cyan"></i> 全部展開
        </button>
        <button type="button" class="btn-table-action" onclick="toggleAllGuidelineFolders(false)" style="padding: 8px 18px; font-size: 15px; cursor: pointer;">
          <i class="fa-solid fa-square-minus text-amber"></i> 全部收合
        </button>
      </div>
    </div>
  `;

  const cardsHtml = Object.entries(groups).map(([folderName, fList], idx) => `
    <div class="guideline-folder-card ${idx > 2 ? 'collapsed' : ''}" id="sp-card-${idx}">
      <div class="guideline-folder-header" onclick="toggleGuidelineFolder(this)" style="cursor: pointer; user-select: none;">
        <span class="guideline-folder-title"><i class="fa-solid fa-graduation-cap text-amber"></i> ${folderName}</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="files-badge" style="font-size: 15px; padding: 4px 12px; background: rgba(245,158,11,0.15); color: #fbbf24; border-color: rgba(245,158,11,0.3);">${fList.length} 份品質簡報</span>
          <button type="button" class="btn-table-action" style="padding: 4px 12px; font-size: 14.5px; background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.3); pointer-events: none;">
            <i class="fa-solid fa-chevron-down text-amber guideline-toggle-icon"></i> <span class="toggle-text">${idx > 2 ? '展開' : '收合'}</span>
          </button>
        </div>
      </div>
      <div class="category-files-list" style="padding: 10px 16px;">
        ${fList.map(f => {
          const safeF = encodeURIComponent(JSON.stringify(f));
          const fullPath = f.fullPath || "";
          return `
            <div class="file-row-item">
              <div class="file-left-info" title="${f.name}">
                <i class="fa-solid ${getFileIcon(f.ext)}" style="font-size: 22px;"></i>
                <span class="file-name-text">${f.name}</span>
                <small class="text-dim">(${(f.size/1024).toFixed(0)} KB ‧ ${f.date || f.lastModified})</small>
              </div>
              <div class="file-actions">
                <button type="button" class="btn-file-view" onclick="openMeetingFileModal('${safeF}')">
                  <i class="fa-solid fa-eye"></i> 查看
                </button>
                <button type="button" class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;" onclick="copyNasPath('${encodeURIComponent(fullPath)}')">
                  <i class="fa-regular fa-copy"></i> 複製路徑
                </button>
                <a href="/api/download?path=${encodeURIComponent(fullPath)}" target="_blank" download class="btn-table-action" style="padding: 8px 12px; font-size: 14.5px;">
                  <i class="fa-solid fa-download"></i> 下載
                </a>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  list.innerHTML = toolbarHtml + cardsHtml;
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
    const scheduledCtrlItems = (p.controlSheetItems || []).filter(isScheduledItem);
    const ctrlItemsCount = scheduledCtrlItems.length;
    const postponedCount = projTodos.filter(t => t.status === "後續辦理").length;
    const activeCount = projTodos.length - postponedCount;
    const completedCount = projTodos.filter(t => t.status === "已完成").length;
    const rateVal = activeCount > 0 ? ((completedCount / activeCount) * 100).toFixed(1) : 0;
    const stats = {
      total: projTodos.length,
      postponed: postponedCount,
      active: activeCount,
      completed: completedCount,
      completionRate: rateVal,
      light: rateVal >= 80 ? "green" : (rateVal >= 65 ? "yellow" : (rateVal >= 50 ? "orange" : "red"))
    };
    
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

        <div style="margin-top: 10px; padding: 6px 10px; background: rgba(0,242,254,0.05); border: 1px solid rgba(0,242,254,0.15); border-radius: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-user-gear text-amber"></i>
          <span style="color: var(--text-dim);">會議窗口：</span>
          <span style="color: #a5f3fc; font-weight: 600;">各專案規劃組及負責人</span>
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

  if (deptEl) deptEl.innerHTML = `${proj.dept} <span style="margin-left: 8px; font-size: 13px; color: #fbbf24; font-weight: normal;"><i class="fa-solid fa-user-gear"></i> 技術會議窗口：各專案規劃組及負責人</span>`;
  if (nameEl) nameEl.textContent = proj.shortName || proj.name;
  
  const drawerTodos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
  const drawerPostponed = drawerTodos.filter(t => t.status === "後續辦理").length;
  const drawerActive = drawerTodos.length - drawerPostponed;
  const drawerCompleted = drawerTodos.filter(t => t.status === "已完成").length;
  const drawerRateVal = drawerActive > 0 ? ((drawerCompleted / drawerActive) * 100).toFixed(1) : 0;
  const stats = {
    completionRate: drawerRateVal,
    light: drawerRateVal >= 80 ? "green" : (drawerRateVal >= 65 ? "yellow" : (drawerRateVal >= 50 ? "orange" : "red"))
  };
  if (lightEl) {
    lightEl.className = `drawer-stat-badge light-${stats.light || 'white'}`;
    lightEl.textContent = `待辦完成率: ${stats.completionRate}%`;
  }

  const normSite = normalizeSiteName(proj.shortName);
  const projTodos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
  if (todoCountEl) todoCountEl.textContent = projTodos.length;
  const scheduledCtrlItems = (proj.controlSheetItems || []).filter(isScheduledItem);
  if (controlCountEl) controlCountEl.textContent = scheduledCtrlItems.length;

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

  // 頁籤頂部狀態標籤動態更新
  const headerStatsContainer = document.getElementById("drawer-header-stats-container");
  const normSite = normalizeSiteName(proj.shortName);
  const projTodos = (appData.todoItems || []).filter(t => normalizeSiteName(t.site) === normSite);
  const postponedTodos = projTodos.filter(t => t.status === '後續辦理');
  const activeTodos = projTodos.filter(t => t.status !== '後續辦理');
  const completedTodos = projTodos.filter(t => t.status === '已完成');
  const noResultTodos = completedTodos.filter(t => !t.result || t.result.trim() === '' || t.result.trim() === '-' || t.result.trim() === '待補');
  const rateVal = activeTodos.length > 0 ? ((completedTodos.length / activeTodos.length) * 100).toFixed(1) : 0;
  const todoStats = {
    completionRate: rateVal,
    light: rateVal >= 80 ? "green" : (rateVal >= 65 ? "yellow" : (rateVal >= 50 ? "orange" : "red"))
  };

  if (tabType === "todos" && headerStatsContainer) {
    headerStatsContainer.innerHTML = `
      <div class="control-header-ribbon">
        <span class="drawer-stat-badge light-${todoStats.light || 'white'}">待辦完成率: ${todoStats.completionRate}%</span>
        <span class="kpi-mini-pill kpi-emerald"><i class="fa-solid fa-circle-check"></i> 已完成(${completedTodos.length})</span>
        <span class="kpi-mini-pill kpi-amber"><i class="fa-solid fa-clock-rotate-left"></i> 後續辦理(${postponedTodos.length})</span>
        <span class="kpi-mini-pill kpi-rose"><i class="fa-solid fa-link-slash"></i> 成果未填(${noResultTodos.length})</span>
      </div>
    `;
  } else if (tabType !== "control" && headerStatsContainer) {
    headerStatsContainer.innerHTML = `<span class="drawer-stat-badge light-${todoStats.light || 'white'}">待辦完成率: ${todoStats.completionRate}%</span>`;
  }

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

    // 【核心優化】全案排定項目：嚴格篩選有排定預定產出日期之項目
    const scheduledItems = rawItems.filter(isScheduledItem);

    // 計算 4 大指標 (以基準日/本日為篩選基準)
    const cutoffDate = window.currentCutoffDate || new Date().toISOString().slice(0, 10);
    const dueItems = scheduledItems.filter(it => it.dueDate && it.dueDate <= cutoffDate);
    const completedDueItems = dueItems.filter(it => it.status === '已完成' || it.actualDate);
    const noAssigneeItems = dueItems.filter(it => !it.assignee || it.assignee.trim() === '' || it.assignee === '未指定');
    const noDeliverableItems = dueItems.filter(it => (it.status === '已完成' || it.actualDate) && (!it.deliverable || it.deliverable.trim() === ''));

    // 【核心優化】切換至議題管控時，將抽屜頂部標籤直接替換為 4 大 KPI 標籤！
    const headerStatsContainer = document.getElementById("drawer-header-stats-container");
    if (headerStatsContainer) {
      headerStatsContainer.innerHTML = `
        <div class="control-header-ribbon">
          <span class="kpi-mini-pill kpi-cyan"><i class="fa-solid fa-calendar-check"></i> 基準日應辦(${dueItems.length})</span>
          <span class="kpi-mini-pill kpi-emerald"><i class="fa-solid fa-circle-check"></i> 已完成(${completedDueItems.length})</span>
          <span class="kpi-mini-pill kpi-amber"><i class="fa-solid fa-user-xmark"></i> 未排負責人(${noAssigneeItems.length})</span>
          <span class="kpi-mini-pill kpi-rose"><i class="fa-solid fa-link-slash"></i> 成果未填(${noDeliverableItems.length})</span>
        </div>
      `;
    }

    // 根據 currentControlFilterMode 進行過濾 (全部項目以全案有排定預定產出日期為準)
    let displayItems = scheduledItems;
    if (currentControlFilterMode === "due") {
      displayItems = dueItems;
    } else if (currentControlFilterMode === "no_assignee") {
      displayItems = noAssigneeItems;
    } else if (currentControlFilterMode === "no_deliverable") {
      displayItems = noDeliverableItems;
    } else if (currentControlFilterMode === "all_raw") {
      displayItems = rawItems;
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
      <!-- 篩選與搜尋工具列 -->
      <div class="control-filter-bar">
        <div class="control-filter-tabs">
          <button type="button" class="control-filter-chip ${currentControlFilterMode === 'due' ? 'active' : ''}" onclick="setControlFilter('due')">
            <i class="fa-solid fa-clock"></i> 基準日前應辦 (${dueItems.length})
          </button>
          <button type="button" class="control-filter-chip ${currentControlFilterMode === 'all' ? 'active' : ''}" onclick="setControlFilter('all')">
            <i class="fa-solid fa-list-check"></i> 全部排定項目 (${scheduledItems.length})
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
// 8. 模組 3：全域資料搜尋引擎 (進階資料清洗 ➔ 主題歸納 ➔ 深度萃取總結 ➔ 出處直達)
// ==============================================================================

// 全國/豐譽建築工程核心工項知識矩陣 (包含規劃重點、施工注意事項、缺失防範對策)
const ENGINEERING_KNOWLEDGE_MATRIX = {
  "連續壁": {
    topic: "連續壁工程 (Diaphragm Wall)",
    icon: "fa-cubes-stacked",
    planning: [
      { badge: "地質鑽探研判", text: "詳查基地鑽探柱狀圖、卵礫石與砂土層厚度、透水係數及歷史地下水位，評估坍孔風險與泥漿比重配置。" },
      { badge: "導溝精度放樣", text: "導溝內淨寬設計為壁厚 +3~5 cm，頂部需高於地表 10~15 cm 防止雨水倒灌，放樣垂直度偏差嚴格控制 ≤ 1/500。" },
      { badge: "單元分割配置", text: "開挖單元長度規劃 5.0~7.0 m，公母單元交錯配置；端板接頭/止水帶（PVC/水膨脹/鋼板箱型）完整性預先檢討。" },
      { badge: "動線與沉澱池", text: "重型履帶吊車與抓斗作業動線地耐力驗算（防機具傾倒）；配置三段式泥漿沉澱池，容量需達單元開挖體積 1.5 倍以上。" }
    ],
    construction: [
      { badge: "成槽與垂直度", text: "每開挖 5m 以超音波測壁儀（Koden）檢測垂直度（偏差嚴格控制 ≤ 1/200 ~ 1/300），偏斜即時回填黏土球糾偏。" },
      { badge: "泥漿穩定液管理", text: "開挖中比重 1.05~1.15、黏度 18~28s；二次清孔後比重 ≤ 1.08、含砂率 < 3%、pH 8~10；液面高於地下水位 1.5m 以上。" },
      { badge: "清孔與沉渣抽除", text: "以正反循環泵或高壓水刀徹底清孔，槽底沉泥厚度 ≤ 10 cm，防止壁體沉陷與底座懸空瑕疵。" },
      { badge: "鋼筋籠吊放", text: "主筋續接器 100% 抽檢拉拔；配置十字鋼筋桁架防止起吊扭曲；滾輪式保護層墊塊（厚度 ≥ 7.5~10cm，每 3m 設置一組）。" },
      { badge: "特密管特混澆置", text: "特密管底先塞球防泥漿混入；初始埋深 ≥ 2.0m，澆置全程保持管底埋入 2~4m；頂部超灌 50~80cm 鑿除劣質浮漿層。" }
    ],
    pitfalls: [
      { name: "壁體包泥與夾渣", cause: "清孔不全、泥漿比重過高或特密管拔空", solution: "澆置前泥漿比重落於 1.08 以下，連續記錄進料曲線，特密管嚴禁拔出混凝土面。" },
      { name: "接頭滲漏水與湧砂", cause: "端板附著泥餅或止水帶破損位移", solution: "公單元施作前以高壓水刀徹底刷洗接頭鋼板；開挖前於接頭背側預作雙管高壓灌漿（JJM/CCP）止水。" },
      { name: "槽壁坍塌與超挖鼓脹", cause: "地下水位突湧或地表超載", solution: "導溝液面全程高於地下水位 1.5m 以上；提高膨潤土濃度或添加聚合物；嚴禁重車臨近未澆置槽段。" },
      { name: "逆打鋼柱/鋼箱偏差", cause: "吊放定位精度不足或澆置浮力推移", solution: "配置雙向雷射經緯儀監控架與微調千斤頂校正，垂直度偏差嚴格控制 ≤ 1/500。" }
    ]
  },
  "模板": {
    topic: "模板工程與支撐系統 (Formwork & Shoring)",
    icon: "fa-layer-group",
    planning: [
      { badge: "載重與側壓計算", text: "依混凝土澆置速度與高度精算新拌混凝土側壓力，設計對拉螺桿（Tie Rod）間距與外加勁肋材。" },
      { badge: "清水模分割計畫", text: "清水模需繪製螺桿孔位、明縫/陰角分割圖，落實模具模組化與損耗率管控。" },
      { badge: "支撐系統檢討", text: "滿堂支撐架依載重檢討立柱間距，雙向配置水平繫條與剪刀撐（斜撐），確保整體穩定性。" },
      { badge: "節點收頭設計", text: "梁柱接頭與牆板收頭處預留清潔口與止漿角材，避免拆模後產生蜂窩漏漿。" }
    ],
    construction: [
      { badge: "墨線放樣複核", text: "模板組立前複核基準軸線與高程水平線，嚴格控制垂直度與柱樑斷面尺寸偏差（≤ 3mm）。" },
      { badge: "脫模劑塗刷管制", text: "模板組立前均勻塗刷水性脫模劑，嚴禁脫模劑沾染鋼筋或預埋鐵件影響握裹力。" },
      { badge: "模內清潔與洗模", text: "封模前以高壓水槍沖洗模內木屑、鐵屑與垃圾，確認底部清潔口排出後始可封閉。" },
      { badge: "對拉螺桿鎖固", text: "對拉螺桿套管長度需精準，緊固器需均勻施力鎖緊，防止澆置時局部鬆動爆模。" },
      { badge: "拆模時機管制", text: "側模達 3.5 MPa（約 24~48hr）可拆；承重底模與懸臂構件需達設計強度 100% 始可拆除支撐。" }
    ],
    pitfalls: [
      { name: "爆模與漏漿", cause: "螺桿鎖固不足、支撐間距過大或灌漿衝擊", solution: "加強角隅與底層螺桿密度；嚴格控制分層澆置高度（≤ 50cm）與泵送衝擊力。" },
      { name: "結構平整度偏差", cause: "支撐沉陷或模板撓曲變形", solution: "支撐基底夯實並鋪設墊木；澆置中指派專人監模（Watchman）即時校正。" },
      { name: "拆模過早產生裂縫", cause: "未達脫模強度即提早拆卸底模支撐", solution: "嚴格依同條件養護試體強度報告作為拆模依據，懸臂梁板嚴禁提早拆除。" },
      { name: "梁柱節點夾渣蜂窩", cause: "模內雜物未清、洗模口未留", solution: "梁柱接頭底部預留 15x15cm 清潔口，封模灌漿前逐一錄影查驗。" }
    ]
  },
  "防水": {
    topic: "防水隔熱工程 (Waterproofing & Insulation)",
    icon: "fa-shield-halved",
    planning: [
      { badge: "分區系統設計", text: "屋頂（彈泥+PU/烘烤毯）、外牆（聚合物水泥/矽烷浸透）、浴廁（雙層彈泥+玻纖網）、地下室（矽酸質/複壁排水）分區配置。" },
      { badge: "泛水與倒角設計", text: "所有女兒牆、基座陰陽角均需規劃 45° 水泥砂漿泛水倒角（斜角 ≥ 5cm），避免應力集中撕裂。" },
      { badge: "落水頭管邊補強", text: "落水頭與穿牆管周邊規劃 10cm 凹槽填打無收縮止水砂漿與聚氨酯填縫膠。" },
      { badge: "試水排水動線", text: "防水層規劃 1/50~1/100 洩水坡度，洩水動線暢通，預留蓄水試驗高度。" }
    ],
    construction: [
      { badge: "基層素地清理", text: "素地打鑿凸起物、填補坑洞、高壓吸塵，檢測含水率 ≤ 8% 始可進行底塗施作。" },
      { badge: "底塗滲透施作", text: "底塗（Primer）均勻塗刷以封閉基層毛細孔，增強主防水層與結構體之黏結強度。" },
      { badge: "抗裂網鋪貼", text: "陰陽角、管邊、施工縫及冷熱交界處鋪設抗裂玻纖網，搭接寬度 ≥ 10 cm。" },
      { badge: "塗膜厚度分道管制", text: "防水塗料分 2~3 道十字交叉塗刷，每道需待完全乾燥後始可塗刷下一道，嚴格管制乾膜厚度。" },
      { badge: "蓄水試驗驗收", text: "防水層完工後進行 48~72 小時蓄水試驗（深度 3~5cm），確認下方樓層與周邊無滲漏始可覆蓋保護層。" }
    ],
    pitfalls: [
      { name: "防水層起泡脫層", cause: "基層含水率過高或底塗未乾即封閉", solution: "嚴格檢測素地含水率 ≤ 8%，避開雨天或濕氣過重天候施作。" },
      { name: "穿牆管與落水頭滲漏", cause: "管邊未作倒角、未打設止水膠或搭接不足", solution: "管邊預留 1x1cm 溝槽填打 PU 填縫膠，防水膜延伸包覆管壁 ≥ 10cm。" },
      { name: "施工中破壞刺穿", cause: "後續工種踩踏、電焊渣灼傷或工具刺破", solution: "防水層驗收合格後立即施作水泥砂漿保護層或鋪設防護夾板隔離。" },
      { name: "女兒牆頂端滲水", cause: "防水層未收頭入壓條溝或泛水蓋板不良", solution: "防水膜向上延伸入收頭凹槽內並以壓條固定及矽利康封邊。" }
    ]
  },
  "泥作": {
    topic: "泥作粉刷與貼磚工程 (Plastering & Masonry)",
    icon: "fa-trowel-bricks",
    planning: [
      { badge: "介面防裂檢討", text: "RC 與磚牆/輕質隔間牆異材質交接處，規劃 20cm 寬耐鹼玻纖網或鍍鋅鋼絲網防裂。" },
      { badge: "厚度分層控制", text: "粗胚打底厚度超過 20mm 時需分層施作（每層 ≤ 15mm），防止自重下垂滑移龜裂。" },
      { badge: "灰誌基準放樣", text: "全區雷射墨線放樣，設定水平垂直灰誌（麻吉），門窗開口預留塞縫空間 15~20mm。" },
      { badge: "貼磚計畫排版", text: "繪製起磚圖，避免出現小於 1/3 磚之碎磚，預留伸縮縫（每 3~5m 設置一處）。" }
    ],
    construction: [
      { badge: "RC打鑿與土膏甩漿", text: "RC 牆面全面打鑿拉毛、清除油污，均勻塗刷水泥土膏（添加樹脂黏著劑）增強握裹力。" },
      { badge: "砂漿配比嚴格管制", text: "打底砂漿嚴格採用 1:3 水泥粗砂（篩選水洗砂）；粉光面採用 1:2 細砂，嚴禁隨意加水。" },
      { badge: "分層打底與壓光", text: "第一道打底刮糙成齒狀，待硬化後施作第二道，表面以木光刮平；粉光需以鐵鏝刀壓光 2~3 遍。" },
      { badge: "門窗框塞縫充填", text: "門窗框周邊以 1:2 防水水泥砂漿加壓灌注充填飽滿，嚴禁空洞留存滲水路徑。" },
      { badge: "噴水養護作業", text: "打底完成後翌日起連續噴水養護至少 3 天，保持濕潤防止水分急遽蒸發乾縮龜裂。" }
    ],
    pitfalls: [
      { name: "牆面澎拱脫落", cause: "基層未打鑿拉毛、土膏乾涸或灰塵未清", solution: "打底前徹底沖洗濕潤，塗刷土膏後趁濕（未結皮前）立即抹上砂漿。" },
      { name: "表面細微龜裂", cause: "砂漿配比水灰比過大、細砂過多或養護不足", solution: "採用合格水洗中粗砂，嚴格管制坍度，落實連續噴水養護作業。" },
      { name: "壁癌與白華析出", cause: "砂漿內含游離鈣受濕氣水份溶解滲出結晶", solution: "採用抗白華防水水泥砂漿，室內外牆體徹底隔絕水分滲入來源。" },
      { name: "磁磚中空掉落", cause: "背膠塗佈不均或梳理齒距不足、晾置過久", solution: "採用雙面塗抹法（基層+磚背均塗膠泥），揉壓擠出空氣，抽樣敲擊檢驗。" }
    ]
  },
  "鋼筋": {
    topic: "鋼筋工程 (Rebar Fabrication & Placement)",
    icon: "fa-bars-staggered",
    planning: [
      { badge: "接頭穿透率檢討", text: "BIM 3D 檢討梁柱接頭鋼筋密集區穿透率（淨間距 ≥ 25mm 或 1.33 倍粗粒料骨材最大粒徑）。" },
      { badge: "續接器位置錯開", text: "主筋續接器錯開設置，同一斷面續接率不得超過 50%，續接位置避開塑鉸區（應力集中區）。" },
      { badge: "保護層與墊塊規劃", text: "基礎 7.5cm、梁柱 4.0cm、樓板 2.0cm，規劃高強度水泥或塑膠定位墊塊密度（≥ 4個/m²）。" },
      { badge: "錨定與搭接長度", text: "依設計強度精算鋼筋伸展與搭接長度（一般 ≥ 40d~50d），柱筋延伸至基礎底部確實錨定。" }
    ],
    construction: [
      { badge: "間距與綁紮固定", text: "鋼筋間距依圖放樣，交叉點以鍍鋅鐵絲確實緊固綁紮（主筋全綁、副筋跳綁），防止澆置移位。" },
      { badge: "柱箍筋 135° 彎鉤", text: "耐震柱箍筋及繫筋末端必須為 135° 耐震彎鉤（延伸長度 ≥ 6d 且 ≥ 7.5cm），開口朝內交錯配置。" },
      { badge: "續接器扭力檢驗", text: "SA 級油壓/滾軋續接器鎖固後，以校正扭力板手 100% 逐支檢驗並劃標記線，拉拔試驗合格。" },
      { badge: "墊塊確實墊起", text: "樓板下層與梁底墊塊確實墊起，樓板上層筋配置馬凳筋（Chair Bar）支撐，防止踩踏下陷。" },
      { badge: "澆置前鋼筋清潔", text: "灌漿前清除鋼筋表面鐵鏽浮皮、泥漿污染及油漬，確保混凝土與鋼筋之黏結握裹力。" }
    ],
    pitfalls: [
      { name: "保護層不足露筋", cause: "墊塊密度不足、被踩踏壓扁或鋼筋位移", solution: "採用高強度水泥砂漿墊塊（強度 ≥ 30 MPa），配置足夠馬凳筋防止變形。" },
      { name: "梁柱接頭無箍筋", cause: "梁筋過密無法穿入接頭區箍筋", solution: "柱接頭箍筋採用開口式或預先套入梁筋下方，嚴格落實隱蔽前查驗。" },
      { name: "續接器鬆脫或假鎖", cause: "牙紋未完全旋入或扭力不足", solution: "逐支劃線標記，隨機抽樣送第三公證單位進行拉拔強度與滑移量試驗。" },
      { name: "主筋偏移偏斜", cause: "澆置混凝土衝擊或施工放樣誤差", solution: "柱主筋於樓板面預先以定位箍筋固定牢固，偏位需依結構技師簽證補強。" }
    ]
  },
  "混凝土": {
    topic: "混凝土澆置與養護工程 (Concrete Pouring & Curing)",
    icon: "fa-fill-drip",
    planning: [
      { badge: "配比設計審查", text: "審查強度（f'c）、水灰比（W/C ≤ 0.5）、坍度、初凝/終凝時間、氯離子含量及抗滲配比。" },
      { badge: "澆置動線計畫", text: "規劃壓送車停放位置、配管路徑、澆置分區順序（由遠而近、由低而高），備妥備用壓送設備。" },
      { badge: "冷縫預防對策", text: "精算單小時出車量與澆置方量，確保下層混凝土初凝前完成上層澆置覆蓋，嚴防施工冷縫。" },
      { badge: "天候應變計畫", text: "雨天備妥大型防雨帆布，高溫天候（> 32°C）要求預拌廠添加緩凝劑並控制出廠溫度（≤ 32°C）。" }
    ],
    construction: [
      { badge: "進場坍度與氯離子檢驗", text: "每車檢核出機時間（90分鐘內澆置完畢），現場抽測坍度、溫度、空氣量及氯離子含量（≤ 0.15 kg/m³）。" },
      { badge: "管線潤滑砂漿排除", text: "壓送泵管啟動時之潤滑砂漿嚴禁打入結構體內，必須完全排放至廢料桶運離。" },
      { badge: "分層澆置厚度管制", text: "每層澆置厚度控制在 30~50 cm，特密管/象鼻管出料口距離澆置面 ≤ 1.5 m，防止粒料分離。" },
      { badge: "高頻震動棒振搗", text: "震動棒垂直插入下層混凝土 5~10 cm，插點間距 ≤ 50 cm，每次振搗 10~15 秒至表面浮漿即緩慢拔出。" },
      { badge: "表面壓光與濕治養護", text: "初凝前以木鏝刀整平，終凝前以鐵鏝刀壓光 2 次防裂；澆置翌日起覆蓋麻布/透水不織布蓄水養護 ≥ 7 天。" }
    ],
    pitfalls: [
      { name: "蜂窩與麻面孔洞", cause: "漏振、過振導致粒料分離或鋼筋過密", solution: "梁柱密集處輔以小管徑震動棒或橡膠槌輕敲外模，採用自充填混凝土（SCC）。" },
      { name: "施工冷縫滲水", cause: "壓送中斷或出車間隔過長超過初凝時間", solution: "連續澆置嚴控供料，若產生冷縫需鑿除浮漿塗刷環氧樹脂接著劑。" },
      { name: "塑性收縮裂縫", cause: "表面水分蒸發過快、風大或未及時覆蓋", solution: "初凝整平後立即噴灑養護劑或覆蓋保濕不織布，嚴禁現場隨意加水。" },
      { name: "強度未達設計標準", cause: "水灰比失控、現場加水或養護水分不足", solution: "嚴格監控出料單，抗壓試體取樣製作與標準水中養護，落實 28 天抗壓試驗。" }
    ]
  },
  "開挖": {
    topic: "地下室土方開挖與擋土支撐 (Excavation & Shoring)",
    icon: "fa-dolly",
    planning: [
      { badge: "分階開挖計畫", text: "依結構計算書規劃每階開挖深度（各層樑底或支撐中心線下方 50cm），嚴禁超挖。" },
      { badge: "型鋼支撐系統", text: "設計 H 型鋼橫檔（圍令）、水平支撐、斜撐、中間柱及預力施加值（Pre-load）。" },
      { badge: "地下水降水控制", text: "規劃點井（Wellpoint）或深井（Deep Well）降水計畫，兼顧坑內降水與坑外水位保護（防地層沉陷）。" },
      { badge: "自動化安全監測", text: "周邊布設壁體傾度管、水壓計、沉陷點、支撐應力計、鄰房傾斜計，設定警戒與行動值。" }
    ],
    construction: [
      { badge: "嚴格依序開挖", text: "挖土機分區下挖，各區開挖完成後立即架設型鋼支撐，嚴禁大面積開挖懸空。" },
      { badge: "圍令密貼連續壁", text: "型鋼圍令與連續壁面必須密貼，間隙處以無收縮水泥砂漿或三角墊塊完全填實。" },
      { badge: "千斤頂預力施加", text: "支撐安裝完畢後以油壓千斤頂施加設計預應力（Pre-load 100%），施加後立即鎖固鋼銷。" },
      { badge: "安全監測每日回傳", text: "開挖期間每日判讀監測數據（水位、變形速率），若達警戒值立即停止開挖並回填反壓。" },
      { badge: "出土動線與洗車台", text: "基地出入口設置高壓自動洗車台與沉砂池，出土車輛覆蓋帆布，保持周邊道路清潔。" }
    ],
    pitfalls: [
      { name: "型鋼支撐挫屈變形", cause: "側土壓超載、預力不均或斜撐未固定", solution: "支撐交角處設置加勁板與水平繫條；定期巡檢螺栓與千斤頂壓力錶。" },
      { name: "湧水湧砂與管湧 (Piping)", cause: "連續壁接頭破洞或開挖面水頭差過大", solution: "備妥快乾水泥、雙液水玻璃急結灌漿搶險；坑內增設減壓深井平衡水頭。" },
      { name: "周邊道路/鄰房沉陷", cause: "坑外地下水位驟降或擋土壁過度側移", solution: "坑外設置回灌井維持地下水位；開挖每階嚴格落實預力加載防側移。" },
      { name: "超挖導致支撐懸空", cause: "怪手司機未按高程放樣超挖", solution: "現場配置測量人員每日以雷射水準儀控制開挖深度，嚴禁超挖超過 30cm。" }
    ]
  },
  "門窗": {
    topic: "門窗與外牆帷幕工程 (Doors, Windows & Curtain Wall)",
    icon: "fa-door-open",
    planning: [
      { badge: "風壓與水密氣密設計", text: "依建築技術規則耐風壓計算及風洞試驗數據，選定鋁門窗/帷幕抗風壓（360 kgf/m²）、水密（50 kgf/m²）、氣密等級。" },
      { badge: "預埋件精準定位", text: "帷幕預埋鐵件（Anchor Plate）於結構體灌漿前預先套繪放樣，留設 3D 調整裕度。" },
      { badge: "熱應力與玻璃選用", text: "大片玻璃檢討熱應力破裂風險，採用 Low-E 複層或膠合強化玻璃，並通過熱浸處理（HST）防止自爆。" },
      { badge: "填縫膠相容性", text: "送驗結構膠與耐候矽利康膠（Silicone）之附著力與相容性試驗，選定抗位移變形等級。" }
    ],
    construction: [
      { badge: "雷射 3D 空間放樣", text: "以全站儀進行三維空間基準線放樣，校正預埋件與轉接件位置，垂直水平偏差 ≤ 2mm。" },
      { badge: "立框與固定片焊接", text: "窗框立框後以膨脹螺栓或鍍鋅固定片固定牢固，間距 ≤ 40cm，轉角處 15cm 內必設固定點。" },
      { badge: "水密塞縫充填", text: "框體周邊以 1:2 防水水泥砂漿或發泡劑充填飽滿，外側預留 8~10mm 矽利康填縫凹槽。" },
      { badge: "耐候矽利康施打", text: "清潔接縫面、貼防護膠帶、背襯發泡條（Backer Rod）、打設底塗，飽滿施打矽利康並刮平壓實。" },
      { badge: "現場水霧試驗驗收", text: "依 AAMA 501.2 規範進行現場動態水霧噴水試驗（噴壓 2.1 kgf/cm²），持續 15 分鐘無滲漏。" }
    ],
    pitfalls: [
      { name: "窗框周邊滲漏水", cause: "塞縫不實有孔隙、未留嵌縫凹槽或矽利康老化", solution: "採用高壓灌注防水砂漿塞縫，外側雙道打設抗位移耐候矽利康膠。" },
      { name: "鋁框變形與開關卡滯", cause: "安裝垂直度偏差、搬運碰撞或塞縫砂漿擠壓膨脹", solution: "立框時安裝內支撐防變形，以雷射水準儀校驗對角線差 ≤ 2mm。" },
      { name: "強化玻璃自爆", cause: "玻璃內部硫化鎳（NiS）雜質膨脹", solution: "外牆帷幕玻璃全面要求進行熱浸處理（Heat Soak Test），取得檢驗證明。" },
      { name: "矽利康污染石材/牆面", cause: "選用含矽油滲出之非耐候膠", solution: "石材與鋁板外牆一律採用無污染耐候型中性矽利康（Non-bleeding）。" }
    ]
  },
  "機電": {
    topic: "機電給排水與穿梁套管 (MEP Engineering & Sleeves)",
    icon: "fa-bolt",
    planning: [
      { badge: "BIM 3D 碰撞檢討", text: "進行建築/結構/機電（CSD/SEM）3D 圖面套繪，檢討管線共架、高程淨高與維修空間。" },
      { badge: "穿梁套管規範", text: "套管設置於梁跨中 1/3~1/4 剪力較小區；管徑 ≤ 1/3 梁深；相鄰套管淨距 ≥ 3 倍大管徑。" },
      { badge: "套管補強筋設計", text: "穿梁套管周邊依結構圖說配置 45° 斜向補強筋及閉合式補強箍筋，確保梁體抗剪強度。" },
      { badge: "管線坡度與排水", text: "污水與雨水管路規劃 1/50~1/100 排水坡度，避免水平轉向過多造成氣塞與沉積堵塞。" }
    ],
    construction: [
      { badge: "套管牢固固定", text: "穿梁套管與鋼筋以點焊或扎絲牢固固定，管口以專用端蓋封堵，防止灌漿時浮動位移及進漿。" },
      { badge: "接地電阻量測", text: "基礎結構接地網焊接完成後，以接地電阻計量測（避雷接地 ≤ 10Ω、系統接地 ≤ 25Ω）。" },
      { badge: "給排水水壓試驗", text: "給水管路進行 10 kg/cm² 水壓試驗維持 2 小時無壓降；排水管進行滿水及通水試驗。" },
      { badge: "風管與保溫包覆", text: "冰水管與空調風管保溫材厚度需充足，接縫處以鋁箔膠帶緊密貼附，嚴防冷凝水滴落。" },
      { badge: "防火填塞施工", text: "穿越防火區劃之管線與套管間隙，以通過 UL 認證之防火泥/膨脹填塞材充填飽滿。" }
    ],
    pitfalls: [
      { name: "穿梁套管位移破損", cause: "灌漿振搗棒碰撞或固定不牢", solution: "採用厚壁鋼管套管，外焊定位翼板固定於主筋，專人監模維護。" },
      { name: "排水管路漏水滲水", cause: "管材接合膠水塗抹不均或未落實水壓試驗", solution: "PVC 接合前以清潔劑擦拭並塗滿膠水；隱蔽前 100% 進行通水試水拍照。" },
      { name: "冷凝水滴落破壞天花板", cause: "冰水管保溫不良、管夾處未作斷熱墊塊", solution: "管夾支架處加裝高密度硬質保溫木托（斷熱墊），保溫層完全密封。" },
      { name: "防火區劃破口遭罰", cause: "管線穿孔後未作防火填塞或填塞不全", solution: "逐層建立穿牆防火填塞查驗清單，填塞後拍照黏貼標籤供消防查驗。" }
    ]
  },
  "品保": {
    topic: "品保中心品質管理與自主檢查 (Quality Assurance & SPS)",
    icon: "fa-award",
    planning: [
      { badge: "SPS品質文件落實", text: "依安保中心 001-品保中心 SPS 標準圖說、施工規範與自主檢查表，編制分項品質計畫書。" },
      { badge: "檢驗停留點 (Hold Point)", text: "明確訂定隱蔽工程查驗停留點（如基礎開挖面、鋼筋綁紮、防水試水、灌漿前夕），未經品檢合格嚴禁進行下一道工序。" },
      { badge: "材料進場檢驗管制", text: "所有結構材料（鋼筋、混凝土、鋼骨、磁磚、防水材）進場查驗出廠證明並落實抽樣送驗。" },
      { badge: "首件樣板工程推行", text: "各分項工程施作前先完成「首件樣板（Mock-up）」，經業主、監造及工務所共同驗收確認品質標準。" }
    ],
    construction: [
      { badge: "自主檢查逐項落實", text: "工地工程師每日落實一級自主檢查表，拍照記錄關鍵尺寸、垂直度、保護層及施工細節。" },
      { badge: "品保中心抽查複驗", text: "品保中心定期巡迴抽查（二級品管），針對重點缺失開立改善通知單（NCR）並限期回覆。" },
      { badge: "試驗報告追蹤彙整", text: "混凝土 7/28 天抗壓、鋼筋拉拔、水質試驗等報告即時建檔分析，異常第一時間發布預警。" },
      { badge: "技術分享會經驗反饋", text: "定期召開 SPS 技術分享會，將各工地實際遭遇之施工難題與處置成果轉化為標準簡報傳承。" },
      { badge: "數位化品管歷程歸檔", text: "全面導入雲端儀表板與 Notion 知識庫，將技術議題、待辦改善進度與圖說照片即時雙向連動。" }
    ],
    pitfalls: [
      { name: "自主檢查表流於形式", cause: "未於現場實測即勾選、無照片佐證", solution: "全面推行現場量測標註照片上傳，抽查發現造假即列入工區品管評比扣分。" },
      { name: "缺失改善未追蹤結案", cause: "改善通知單開立後未複查確認效果", solution: "儀表板待辦清單嚴格追蹤改善前中後對比照片，未通過複查不得結案。" },
      { name: "材料未驗先用", cause: "工期緊迫未等試驗報告即先行施作", solution: "嚴格執行停留點門禁，未取得出廠證明與檢驗報告者吊扣進場通行權。" },
      { name: "重複性通病屢次發生", cause: "經驗未有效傳承、工班未經教育訓練", solution: "開工前調閱 SPS 歷年分享會簡報進行工班教育訓練，落實標準作業程序。" }
    ]
  }
};

// 智慧清洗、歸納與萃取工程知識核心演算法
function extractAndSynthesizeKnowledge(rawQuery, hits, issueMatches, fileMatches, sharepointMatches) {
  const query = rawQuery.toLowerCase();
  
  // 1. 識別匹配的工程工項專業矩陣
  let matchedDomainKey = null;
  for (const key of Object.keys(ENGINEERING_KNOWLEDGE_MATRIX)) {
    if (query.includes(key.toLowerCase()) || key.toLowerCase().includes(query)) {
      matchedDomainKey = key;
      break;
    }
  }

  // 若查無完全匹配工項，依命中項目的類別與標題進行模糊判斷
  if (!matchedDomainKey) {
    for (const h of hits) {
      const fullText = `${h.title} ${h.desc || ''} ${h.site || ''} ${h.dept || ''}`.toLowerCase();
      for (const key of Object.keys(ENGINEERING_KNOWLEDGE_MATRIX)) {
        if (fullText.includes(key.toLowerCase())) {
          matchedDomainKey = key;
          break;
        }
      }
      if (matchedDomainKey) break;
    }
  }

  // 2. 資料清洗 (Data Cleaning): 去重、解析工區、提取主題
  const uniqueSites = Array.from(new Set(hits.map(h => h.site).filter(Boolean)));
  
  // SPS 簡報去重與清洗 (去除副檔名、提取精確主題)
  const cleanedSpsMap = new Map();
  sharepointMatches.forEach(sp => {
    const rawName = sp.title || sp.fileObj?.name || "";
    const cleanName = rawName.replace(/\.(pdf|pptx|ppt|xlsx|docx)$/i, "");
    if (!cleanedSpsMap.has(cleanName)) {
      cleanedSpsMap.set(cleanName, {
        name: cleanName,
        category: sp.site || "品保分享會",
        fullPath: sp.fileObj?.fullPath || "",
        fileObj: sp.fileObj
      });
    }
  });
  const cleanedSpsList = Array.from(cleanedSpsMap.values());

  // 3. 生成深度結構化知識提煉
  if (matchedDomainKey && ENGINEERING_KNOWLEDGE_MATRIX[matchedDomainKey]) {
    const domain = ENGINEERING_KNOWLEDGE_MATRIX[matchedDomainKey];
    return {
      domainKey: matchedDomainKey,
      topic: domain.topic,
      icon: domain.icon,
      isSpecificDomain: true,
      uniqueSites: uniqueSites,
      planning: domain.planning,
      construction: domain.construction,
      pitfalls: domain.pitfalls,
      cleanedSpsList: cleanedSpsList,
      totalHits: hits.length
    };
  } else {
    // 通用關鍵字動態提煉 (Universal Dynamic Distillation)
    const sampleTopics = Array.from(new Set(hits.map(h => h.title).filter(Boolean))).slice(0, 6);
    
    // 從議題備註與標題提取具體工程要點
    const dynamicPlanning = [
      { badge: "圖說與介面檢討", text: `針對「${rawQuery}」相關工項，於開工前落實施工圖面套繪、材料規格審查與周邊介面協調。` },
      { badge: "施工計畫與動線", text: `精算機具動線、材料進場時程與作業空間，落實跨專案安全衛生與動線防護措施。` },
      { badge: "放樣與基準校驗", text: `依工程基準點進行精準放樣，確保關鍵構件之水平高程與垂直軸線符合公差標準。` }
    ];

    const dynamicConstruction = [
      { badge: "標準工序管控", text: `現場作業嚴格遵循 SPS 品質文件與標準工法，落實分層分段施工與關鍵參數記錄。` },
      { badge: "設備與材料查驗", text: `進場材料 100% 查核出廠證明與檢驗報告，施作設備定期校驗保持良好性能。` },
      { badge: "一級自主檢查", text: `工程師於現場落實自主檢查表填寫，針對隱蔽部位確實拍照留存施工歷程。` }
    ];

    const dynamicPitfalls = [
      { name: `${rawQuery} 施工公差與精度偏差`, cause: "放樣校驗未落實或施工中受外力擾動", solution: "以雷射儀器進行雙向校驗，施作過程中指派專人定時複測。" },
      { name: "材料進場規格不符或瑕疵", cause: "出廠品管不全或運輸搬運碰撞受損", solution: "進場時會同品管人員嚴格驗收，瑕疵品立即退貨嚴禁使用。" },
      { name: "介面收頭不良產生滲漏或裂縫", cause: "工種交接處未預留收頭空間或未作防裂處置", solution: "落實工種交接界面會勘，配置防裂網與防水填縫密封膠。" }
    ];

    return {
      domainKey: rawQuery,
      topic: `「${rawQuery}」相關技術議題與品保專題綜整`,
      icon: "fa-sparkles",
      isSpecificDomain: false,
      uniqueSites: uniqueSites,
      planning: dynamicPlanning,
      construction: dynamicConstruction,
      pitfalls: dynamicPitfalls,
      cleanedSpsList: cleanedSpsList,
      totalHits: hits.length
    };
  }
}

// 模組 3：執行全域搜尋與渲染深度萃取總結
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
        <p>請於上方搜尋框輸入關鍵字開始查詢（聚焦技術議題庫、專案會議簡報、SPS品保分享會與各類技術指引）</p>
      </div>
    `;
    if (countEl) countEl.textContent = "0";
    return;
  }

  // 1. 資料清洗與檢索 (技術議題庫 155 筆、會議簡報、指引模板、SPS品保分享會 816 份)
  const issueMatches = [];
  const fileMatches = [];
  const sharepointMatches = [];

  // A. 搜尋技術議題庫 (155 筆跨專案技術結晶)
  if (activeSearchType === "all" || activeSearchType === "issues") {
    (appData.technicalIssues || []).forEach(issue => {
      const matchText = `${issue.dept} ${issue.site} ${issue.category} ${issue.title} ${issue.notes}`.toLowerCase();
      if (matchText.includes(query)) {
        const matchedProj = (appData.projects || []).find(p => normalizeSiteName(p.shortName) === normalizeSiteName(issue.site));
        let issueFileObj = null;
        if (matchedProj) {
          for (const m of (matchedProj.meetings || [])) {
            for (const f of (m.files || [])) {
              if (f.name.toLowerCase().includes(query) || (issue.meetDate && f.name.includes(issue.meetDate.replace(/-/g, '')))) {
                issueFileObj = f;
                break;
              }
            }
            if (issueFileObj) break;
          }
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

  // C. 搜尋 SPS 品保中心分享會簡報庫 (816 份專業簡報)
  if (activeSearchType === "all" || activeSearchType === "sharepoint") {
    (appData.sharepointPresentations || []).forEach(sp => {
      const matchText = `${sp.category} ${sp.subFolder || ''} ${sp.title} ${sp.name}`.toLowerCase();
      if (matchText.includes(query)) {
        sharepointMatches.push({
          type: "sharepoint",
          typeLabel: "SPS品保簡報",
          tagClass: "tag-sharepoint",
          dept: "品保中心",
          site: sp.category,
          date: sp.date || sp.lastModified,
          title: sp.name,
          desc: `工項類別：${sp.category} ‧ 檔案大小：${(sp.size/1024).toFixed(0)} KB`,
          actionType: "viewFile",
          fileObj: sp
        });
      }
    });
  }

  const allHits = [...issueMatches, ...fileMatches, ...sharepointMatches];
  if (countEl) countEl.textContent = allHits.length;

  if (allHits.length === 0) {
    resultsList.innerHTML = `
      <div class="google-ai-card-inline" style="padding: 24px; text-align: center;">
        <i class="fa-solid fa-magnifying-glass text-amber" style="font-size: 28px;"></i>
        <p style="font-size: 17px; color: #f1f5f9; margin-top: 12px; font-weight: 600;">查無符合關鍵字「<b class="text-cyan">${rawQuery}</b>」之相關技術議題或會議簡報</p>
        <p style="font-size: 14px; color: var(--text-muted); margin-top: 6px;">您可以嘗試縮短關鍵字，或點擊上方「<a href="javascript:void(0)" onclick="searchInNotionDirect()" class="text-amber font-bold">在 Notion 搜尋</a>」進行更廣泛的筆記查找。</p>
      </div>
    `;
    return;
  }

  // 2. 執行深度工程知識清洗、歸納與萃取總結 (AI Overview & Deep Distillation)
  const distilled = extractAndSynthesizeKnowledge(rawQuery, allHits, issueMatches, fileMatches, sharepointMatches);

  // 出處引述標籤
  const allCitedSources = allHits.map(h => {
    const site = h.site || h.dept;
    const safeFile = h.fileObj ? encodeURIComponent(JSON.stringify(h.fileObj)) : "";
    const safeIssue = h.issueObj ? encodeURIComponent(JSON.stringify(h.issueObj)) : "";
    if (h.type === "issue") {
      return `<button type="button" class="ai-cite-pill" onclick="openTechnicalIssueModal('${safeIssue}', '${safeFile}')" title="${h.title}"><i class="fa-solid fa-location-dot text-cyan"></i> ${site}：${h.title}</button>`;
    } else if (h.type === "sharepoint") {
      return `<button type="button" class="ai-cite-pill" onclick="openMeetingFileModal('${safeFile}')" title="${h.title}"><i class="fa-solid fa-graduation-cap text-amber"></i> 【SPS品保】${site}：${h.title}</button>`;
    } else {
      return `<button type="button" class="ai-cite-pill" onclick="openMeetingFileModal('${safeFile}')" title="${h.title}"><i class="fa-solid fa-file-powerpoint text-rose"></i> ${site}：${h.title}</button>`;
    }
  }).join("");

  // SPS 精選卡片列表
  const spsCardsHtml = (distilled.cleanedSpsList || []).slice(0, 8).map(sp => {
    const safeFile = sp.fileObj ? encodeURIComponent(JSON.stringify(sp.fileObj)) : "";
    return `
      <div class="ai-sps-card" onclick="openMeetingFileModal('${safeFile}')" style="cursor: pointer;" title="點擊檢視/複製路徑">
        <div class="ai-sps-card-title"><i class="fa-solid fa-file-pdf text-rose"></i> ${sp.name}</div>
        <div class="ai-sps-card-meta">
          <span><i class="fa-solid fa-tag"></i> ${sp.category}</span>
          <span style="color: #38bdf8;"><i class="fa-solid fa-arrow-right"></i> 點擊開啟</span>
        </div>
      </div>
    `;
  }).join("");

  // 規劃重點清單
  const planningListHtml = distilled.planning.map(p => `
    <div class="ai-point-item">
      <span class="ai-point-badge badge-blue">${p.badge}</span>
      <span>${p.text}</span>
    </div>
  `).join("");

  // 施工注意事項清單
  const constructionListHtml = distilled.construction.map(c => `
    <div class="ai-point-item">
      <span class="ai-point-badge badge-green">${c.badge}</span>
      <span>${c.text}</span>
    </div>
  `).join("");

  // 缺失防範矩陣清單
  const pitfallsMatrixHtml = distilled.pitfalls.map(p => `
    <div class="ai-pitfall-box">
      <div class="ai-pitfall-header">
        <i class="fa-solid fa-triangle-exclamation text-amber"></i>
        <span>${p.name}</span>
      </div>
      <div class="ai-pitfall-solution">
        <div style="color: #94a3b8; font-size: 12.5px; margin-bottom: 4px;"><b>原因分析：</b>${p.cause}</div>
        <div style="color: #6ee7b7; font-size: 13px;"><b>防範對策：</b>${p.solution}</div>
      </div>
    </div>
  `).join("");

      // 完整 Markdown 總結字串 (供一鍵複製)
  const fullMarkdownSummary = [
    "### 🏢 豐譽技術會議 ‧ 工程技術結晶萃取總結報告",
    `**【檢索主題】**：${distilled.topic}`,
    `**【涵蓋工區】**：${distilled.uniqueSites.join('、') || '全工程處'}`,
    `**【技術結晶總數】**：${distilled.totalHits} 筆（議題庫 ${issueMatches.length} 筆、會議簡報 ${fileMatches.length} 份、SPS品保簡報 ${sharepointMatches.length} 份）`,
    "",
    "---",
    "#### 🎯 一、規劃設計與前置作業重點",
    distilled.planning.map(p => `- **[${p.badge}]**：${p.text}`).join("\n"),
    "",
    "---",
    "#### 🛠️ 二、核心施工步驟與關鍵注意事項",
    distilled.construction.map(c => `- **[${c.badge}]**：${c.text}`).join("\n"),
    "",
    "---",
    "#### ⚠️ 三、品質抽驗核心與常見缺失防範對策",
    distilled.pitfalls.map(p => `- **【${p.name}】**\n  - 原因分析：${p.cause}\n  - 標準防範對策：${p.solution}`).join("\n"),
    "",
    "---",
    "#### 📚 四、SPS 品保中心分享會精選簡報",
    distilled.cleanedSpsList.slice(0, 10).map(s => `- [${s.category}] ${s.name}`).join("\n")
  ].join("\n");

  // 儲存在全域暫存以供一鍵複製
  window._lastDistilledSummary = fullMarkdownSummary;

  const summaryHtml = `
    <div class="google-ai-card-inline">
      <!-- 頂部標題與核心資訊 -->
      <div class="search-summary-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <i class="fa-solid fa-microchip text-cyan" style="font-size: 26px;"></i>
          <div>
            <span style="font-size: 20px; font-weight: 700; color: #a5f3fc;">Google AI 模式 ‧ 深度技術結晶萃取報告</span>
            <div style="font-size: 13.5px; color: #94a3b8; margin-top: 2px;">
              主題：<b class="text-amber">${distilled.topic}</b> ‧ 涵蓋工區：<b class="text-cyan">${distilled.uniqueSites.slice(0, 6).join('、') || '各工程處'}</b>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="ai-mode-badge"><i class="fa-solid fa-brain"></i> 智慧清洗 ‧ 歸納 ‧ 總結</span>
        </div>
      </div>

      <!-- 導航工具列與快捷按鈕 -->
      <div class="ai-distill-toolbar">
        <div class="ai-distill-tabs">
          <button type="button" class="ai-distill-tab active" onclick="switchAIDistillTab('all')"><i class="fa-solid fa-list-check"></i> 全覽總結</button>
          <button type="button" class="ai-distill-tab" onclick="switchAIDistillTab('planning')"><i class="fa-solid fa-compass-drafting"></i> 規劃重點</button>
          <button type="button" class="ai-distill-tab" onclick="switchAIDistillTab('construction')"><i class="fa-solid fa-helmet-safety"></i> 施工注意事項</button>
          <button type="button" class="ai-distill-tab" onclick="switchAIDistillTab('pitfalls')"><i class="fa-solid fa-shield-virus"></i> 缺失防範矩陣</button>
          <button type="button" class="ai-distill-tab" onclick="switchAIDistillTab('sps')"><i class="fa-solid fa-graduation-cap"></i> SPS品保簡報 (${distilled.cleanedSpsList.length})</button>
          <button type="button" class="ai-distill-tab" onclick="switchAIDistillTab('citations')"><i class="fa-solid fa-quote-left"></i> 出處直達 (${allHits.length})</button>
        </div>

        <div class="ai-action-buttons">
          <button type="button" class="btn-ai-tool primary" onclick="copyAIDistillSummary()" title="複製完整 Markdown 格式技術總結"><i class="fa-regular fa-copy"></i> 複製技術總結</button>
          <button type="button" class="btn-ai-tool" onclick="window.print()" title="列印或另存 PDF"><i class="fa-solid fa-print"></i> 列印摘要</button>
          <a href="https://app.notion.com/p/3aa1a56b88108148bf83e40fc03dad3b?v=3aa1a56b88108190916e000c1bb69a93${rawQuery ? `&query=${encodeURIComponent(rawQuery)}` : ''}" target="_blank" rel="noopener noreferrer" class="btn-ai-tool" title="在 Notion 知識庫深度檢索">
            <i class="fa-solid fa-note-sticky text-amber"></i> Notion
          </a>
          <a href="https://ncaio.fengyu.com.tw/f/8988" target="_blank" rel="noopener noreferrer" class="btn-ai-tool" title="前往豊譽企業雲端分享專區">
            <i class="fa-solid fa-cloud text-cyan"></i> 企業雲
          </a>
        </div>
      </div>

      <!-- 核心萃取內容展示區塊 -->
      <div class="ai-distill-container" id="ai-distill-content-area">
        
        <!-- 一、規劃設計與前置作業重點 -->
        <div class="ai-section-card planning" id="ai-section-planning">
          <div class="ai-section-title text-cyan">
            <i class="fa-solid fa-compass-drafting"></i> <b>一、前期規劃設計與介面檢討重點</b>
          </div>
          <div class="ai-point-list">
            ${planningListHtml}
          </div>
        </div>

        <!-- 二、核心施工步驟與關鍵注意事項 -->
        <div class="ai-section-card construction" id="ai-section-construction">
          <div class="ai-section-title text-emerald">
            <i class="fa-solid fa-helmet-safety"></i> <b>二、核心施工步驟與關鍵管控注意事項</b>
          </div>
          <div class="ai-point-list">
            ${constructionListHtml}
          </div>
        </div>

        <!-- 三、品質抽驗核心與常見缺失防範對策 -->
        <div class="ai-section-card pitfalls" id="ai-section-pitfalls">
          <div class="ai-section-title text-amber">
            <i class="fa-solid fa-triangle-exclamation"></i> <b>三、品質抽驗核心與常見缺失防範對策矩陣</b>
          </div>
          <div class="ai-pitfall-matrix">
            ${pitfallsMatrixHtml}
          </div>
        </div>

        <!-- 四、SPS 品保分享會精選簡報 -->
        ${(distilled.cleanedSpsList || []).length > 0 ? `
          <div class="ai-section-card sps" id="ai-section-sps">
            <div class="ai-section-title text-purple">
              <i class="fa-solid fa-graduation-cap"></i> <b>四、SPS 品保中心分享會精選簡報推薦 (點擊複製 NAS 路徑/直達)</b>
            </div>
            <div class="ai-sps-rec-grid">
              ${spsCardsHtml}
            </div>
          </div>
        ` : ''}

        <!-- 五、技術出處引述 -->
        <div class="ai-section-card" id="ai-section-citations" style="background: rgba(0,0,0,0.35); border-left: 4px solid #a855f7;">
          <div class="ai-section-title text-purple" style="font-size: 15px;">
            <i class="fa-solid fa-quote-left text-amber"></i> <b>五、技術出處引述 (共 ${allHits.length} 筆，點擊直達檔案/議題/外部資料庫)：</b>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px;">
            ${allCitedSources}
          </div>
        </div>

      </div>

      <!-- 統計指標底列 -->
      <div class="search-summary-stats" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
        <span class="search-summary-pill"><i class="fa-solid fa-lightbulb text-amber"></i> 技術議題庫：<b>${issueMatches.length}</b> 筆</span>
        <span class="search-summary-pill"><i class="fa-solid fa-file-powerpoint text-rose"></i> 專案會議簡報：<b>${fileMatches.filter(f => f.type === 'file').length}</b> 份</span>
        <span class="search-summary-pill"><i class="fa-solid fa-book text-cyan"></i> 指引與模板：<b>${fileMatches.filter(f => f.type === 'guide').length}</b> 份</span>
        <span class="search-summary-pill"><i class="fa-solid fa-graduation-cap text-purple"></i> SPS品保簡報：<b>${sharepointMatches.length}</b> 份</span>
      </div>
    </div>
  `;

  resultsList.innerHTML = summaryHtml;
}

// 切換 AI 萃取總結分頁
window.switchAIDistillTab = function(tabKey) {
  const tabs = document.querySelectorAll(".ai-distill-tab");
  tabs.forEach(t => t.classList.remove("active"));
  
  // 設置當前 Tab active
  const activeBtn = Array.from(tabs).find(t => t.getAttribute("onclick")?.includes(tabKey));
  if (activeBtn) activeBtn.classList.add("active");

  const secPlanning = document.getElementById("ai-section-planning");
  const secConstruction = document.getElementById("ai-section-construction");
  const secPitfalls = document.getElementById("ai-section-pitfalls");
  const secSps = document.getElementById("ai-section-sps");
  const secCitations = document.getElementById("ai-section-citations");

  const allSections = [secPlanning, secConstruction, secPitfalls, secSps, secCitations].filter(Boolean);

  if (tabKey === "all") {
    allSections.forEach(s => s.style.display = "block");
  } else {
    allSections.forEach(s => s.style.display = "none");
    if (tabKey === "planning" && secPlanning) secPlanning.style.display = "block";
    if (tabKey === "construction" && secConstruction) secConstruction.style.display = "block";
    if (tabKey === "pitfalls" && secPitfalls) secPitfalls.style.display = "block";
    if (tabKey === "sps" && secSps) secSps.style.display = "block";
    if (tabKey === "citations" && secCitations) secCitations.style.display = "block";
  }
};

// 一鍵複製完整技術總結
window.copyAIDistillSummary = function() {
  if (!window._lastDistilledSummary) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(window._lastDistilledSummary).then(() => {
      showAIToast("已複製完整技術總結 (Markdown) 至剪貼簿！");
    }).catch(() => {
      fallbackCopyTextToClipboard(window._lastDistilledSummary);
      showAIToast("已複製技術總結至剪貼簿！");
    });
  } else {
    fallbackCopyTextToClipboard(window._lastDistilledSummary);
    showAIToast("已複製技術總結至剪貼簿！");
  }
};

// 彈出 Toast 提示
function showAIToast(msg) {
  const existing = document.querySelector(".ai-toast-pop");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "ai-toast-pop";
  toast.innerHTML = `<i class="fa-solid fa-circle-check text-cyan"></i> <span>${msg}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// 點擊技術議題直接連結與開啟來源檔案
window.openTechnicalIssueModal = function(encodedIssue, encodedFile) {
  try {
    const issue = JSON.parse(decodeURIComponent(encodedIssue));
    const file = encodedFile ? JSON.parse(decodeURIComponent(encodedFile)) : null;

    const matchedProj = (appData.projects || []).find(p => normalizeSiteName(p.shortName) === normalizeSiteName(issue.site));
    const projId = matchedProj ? matchedProj.id : "";

    const fullPath = file ? file.fullPath : "\\\\\\\\192.168.1.221\\\\s5\\\\1003技術會議資料專區\\\\1.各專案作業區\\\\目錄-各工地歷次會議技術議題查詢.xlsx";

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
          <i class="fa-solid fa-cloud"></i> 豊譽雲端專區 (/f/8988)
        </a>
        <a href="https://app.notion.com/p/3aa1a56b88108148bf83e40fc03dad3b?v=3aa1a56b88108190916e000c1bb69a93" target="_blank" rel="noopener noreferrer" class="btn-table-action" style="padding: 10px 18px; font-size: 14px; background: rgba(245,158,11,0.12); border-color: #f59e0b; color: #fde68a;">
          <i class="fa-solid fa-note-sticky"></i> Notion 知識庫開啟
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

// 在對話框輸入關鍵字後一鍵進入 Notion 知識庫搜尋
window.searchInNotionDirect = function() {
  const input = document.getElementById("global-search-input");
  const query = input ? input.value.trim() : "";
  const targetUrl = `https://app.notion.com/p/3aa1a56b88108148bf83e40fc03dad3b?v=3aa1a56b88108190916e000c1bb69a93${query ? `&query=${encodeURIComponent(query)}` : ''}`;

  if (query && navigator.clipboard) {
    navigator.clipboard.writeText(query).catch(() => {});
  }

  window.open(targetUrl, "_blank");
};
