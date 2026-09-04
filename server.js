/**
 * 技術會議雲端儀表板伺服器 (Technical Meeting Cloud Dashboard Server)
 * 輕量原生 Node.js 實現，具備：
 * 1. 靜態前端資源託管
 * 2. 豊譽企業網域 (@fengyu.com.tw) 驗證與 NAS 權限門禁 Session
 * 3. 支援統一初始帳號 (FU@fengyu.com.tw / Aa34561297+b) 與自訂個人帳密修改
 * 4. 即時多人在線心跳保活引擎 (不斷線 Presence System)
 * 5. NAS 實體檔案代理檢視與下載
 * 6. 熱更新重新掃描 API
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { exec } = require("child_process");

const PORT = process.env.PORT || 8090;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const NAS_DATA_FILE = path.join(DATA_DIR, "nas_data.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// 在線成員追蹤表 (In-memory live presence)
// key: sessionId/username -> { username, name, dept, currentView, lastPing, ip }
const activeUsers = new Map();

// 定時清理超時離線用戶 (超過 40 秒未發送心跳視為離線)
setInterval(() => {
  const now = Date.now();
  for (const [key, user] of activeUsers.entries()) {
    if (now - user.lastPing > 40000) {
      activeUsers.delete(key);
    }
  }
}, 10000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

function readUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Error reading users.json:", e);
  }
  return [];
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end();
    return;
  }

  // === API 路由 ===

  // 1. 取得 NAS 彙整數據
  if (pathname === "/api/nas-data" && req.method === "GET") {
    if (fs.existsSync(NAS_DATA_FILE)) {
      const data = fs.readFileSync(NAS_DATA_FILE, "utf-8");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(data);
    } else {
      sendJson(res, 404, { status: "error", message: "NAS 數據尚未掃描，請先執行掃描作業" });
    }
    return;
  }

  // 2. 豊譽企業網域專用登入與 NAS 權限驗證 (支援統一初始帳號 FU@fengyu.com.tw 與個人自訂帳密)
  if (pathname === "/api/login" && req.method === "POST") {
    const { username, password, email } = await parseBody(req);
    const inputAccount = (email || username || "").trim().toLowerCase();

    // A. 網域檢驗：若包含 @，必須為 @fengyu.com.tw
    if (inputAccount.includes("@")) {
      const domain = inputAccount.split("@")[1];
      if (domain !== "fengyu.com.tw") {
        sendJson(res, 403, {
          status: "error",
          message: "⛔ 存取拒絕：僅限豊譽企業網域 (@fengyu.com.tw) 員工帳號登入！"
        });
        return;
      }
    }

    const cleanUsername = inputAccount.includes("@") ? inputAccount.split("@")[0] : inputAccount;
    const users = readUsers();
    
    // 比對 users.json 中的 username 或 email
    const matched = users.find(u => 
      u.username.toLowerCase() === cleanUsername || 
      (u.email && u.email.toLowerCase() === inputAccount) ||
      (u.email && u.email.toLowerCase() === `${cleanUsername}@fengyu.com.tw`)
    );

    // 統一登入密碼 Aa34561297+b 或管理員密碼 admin888 或個人自訂密碼
    const isValidPassword = matched && (
      matched.passwordHash === password ||
      (matched.username.toLowerCase() === "fu" && password === "Aa34561297+b") ||
      (matched.username.toLowerCase() === "admin" && (password === "admin888" || password === "Aa34561297+b"))
    );

    if (matched && isValidPassword) {
      const token = "SESSION_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8);
      
      activeUsers.set(token, {
        token: token,
        username: matched.username,
        email: matched.email || `${matched.username}@fengyu.com.tw`,
        domain: "fengyu.com.tw",
        name: matched.name,
        dept: matched.dept || "技術暨品保處",
        role: matched.role,
        avatar: matched.avatar || "fa-helmet-safety",
        currentView: "儀表板總覽",
        loginTime: new Date().toLocaleTimeString("zh-TW", { hour12: false }),
        lastPing: Date.now(),
        ip: clientIp,
        isInitialUnified: matched.username.toLowerCase() === "fu"
      });

      sendJson(res, 200, {
        status: "success",
        token: token,
        user: {
          username: matched.username,
          email: matched.email || `${matched.username}@fengyu.com.tw`,
          domain: "fengyu.com.tw",
          name: matched.name,
          dept: matched.dept || "技術暨品保處",
          role: matched.role,
          avatar: matched.avatar || "fa-helmet-safety",
          permissions: matched.permissions || ["all"],
          isInitialUnified: matched.username.toLowerCase() === "fu"
        }
      });
    } else {
      sendJson(res, 401, {
        status: "error",
        message: "帳號或密碼錯誤。請以統一帳號 FU@fengyu.com.tw (密碼 Aa34561297+b) 或個人自訂帳密登入。"
      });
    }
    return;
  }

  // 2.1 修改為豐譽個人帳密 API
  if (pathname === "/api/update-profile" && req.method === "POST") {
    const { token, name, email, dept, newPassword } = await parseBody(req);
    if (!email || !email.toLowerCase().endsWith("@fengyu.com.tw")) {
      sendJson(res, 400, { status: "error", message: "個人信箱必須為 @fengyu.com.tw 網域" });
      return;
    }

    const cleanUsername = email.split("@")[0].trim();
    const users = readUsers();
    const existingIdx = users.findIndex(u => u.username.toLowerCase() === cleanUsername.toLowerCase() || (u.email && u.email.toLowerCase() === email.toLowerCase()));

    const updatedUser = {
      username: cleanUsername,
      email: email,
      domain: "fengyu.com.tw",
      passwordHash: newPassword || "Aa34561297+b",
      name: name || cleanUsername,
      dept: dept || "技術暨品保處",
      role: dept && dept.includes("處長") ? "director" : "engineer",
      avatar: "fa-user-gear",
      permissions: ["all"],
      isInitialUnified: false
    };

    if (existingIdx >= 0) {
      users[existingIdx] = updatedUser;
    } else {
      users.push(updatedUser);
    }

    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to write users.json:", e);
    }

    if (token && activeUsers.has(token)) {
      const active = activeUsers.get(token);
      active.username = cleanUsername;
      active.email = email;
      active.name = name || cleanUsername;
      active.dept = dept || "技術暨品保處";
      active.isInitialUnified = false;
    }

    sendJson(res, 200, {
      status: "success",
      message: "個人帳號與密碼更新成功！",
      user: updatedUser
    });
    return;
  }

  // 2.2 企業內網與 VPN 狀態檢測
  if (pathname === "/api/network-status" && req.method === "GET") {
    const isIntranet = clientIp.includes("192.168.1.") || clientIp.includes("192.168.") || clientIp.includes("10.") || clientIp === "127.0.0.1" || clientIp === "::1";
    sendJson(res, 200, {
      status: "success",
      clientIp: clientIp,
      isIntranet: isIntranet,
      domain: "fengyu.com.tw",
      nasTarget: "\\\\192.168.1.221\\s5\\1003技術會議資料專區"
    });
    return;
  }

  // 3. 即時心跳與在線狀態同步 (Heartbeat Loop)
  if (pathname === "/api/heartbeat" && req.method === "POST") {
    const { token, currentView } = await parseBody(req);
    const now = Date.now();

    if (token && activeUsers.has(token)) {
      const user = activeUsers.get(token);
      user.lastPing = now;
      if (currentView) user.currentView = currentView;
    } else if (token) {
      activeUsers.set(token, {
        token: token,
        username: "FU",
        email: "FU@fengyu.com.tw",
        domain: "fengyu.com.tw",
        name: "豐譽同仁",
        dept: "技術暨品保處",
        role: "engineer",
        avatar: "fa-helmet-safety",
        currentView: currentView || "儀表板總覽",
        loginTime: new Date().toLocaleTimeString("zh-TW", { hour12: false }),
        lastPing: now,
        ip: clientIp
      });
    }

    const onlineList = Array.from(activeUsers.values()).map(u => ({
      username: u.username,
      name: u.name,
      dept: u.dept,
      role: u.role,
      avatar: u.avatar,
      currentView: u.currentView,
      loginTime: u.loginTime,
      ip: u.ip
    }));

    sendJson(res, 200, {
      status: "success",
      onlineCount: onlineList.length,
      users: onlineList
    });
    return;
  }

  // 4. 登出
  if (pathname === "/api/logout" && req.method === "POST") {
    const { token } = await parseBody(req);
    if (token && activeUsers.has(token)) {
      activeUsers.delete(token);
    }
    sendJson(res, 200, { status: "success", message: "Logged out" });
    return;
  }

  // 5. 檔案下載代理
  if (pathname === "/api/download" && req.method === "GET") {
    const filePath = parsedUrl.query.path;
    if (!filePath) {
      sendJson(res, 400, { status: "error", message: "Missing file path" });
      return;
    }

    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      const filename = path.basename(filePath);

      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`
      });

      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
    } else {
      sendJson(res, 404, { status: "error", message: `NAS 檔案不存在: ${filePath}` });
    }
    return;
  }

  // 6. 熱更新重新掃描 NAS API
  if (pathname === "/api/rescan" && req.method === "POST") {
    const scriptPath = path.join(__dirname, "scan_nas.py");
    exec(`python "${scriptPath}"`, (err, stdout, stderr) => {
      if (err) {
        console.error("Rescan failed:", err);
        sendJson(res, 500, { status: "error", message: "掃描失敗", error: stderr });
      } else {
        console.log("Rescan completed:", stdout);
        sendJson(res, 200, { status: "success", message: "NAS 資料庫掃描並索引完成！" });
      }
    });
    return;
  }

  // === 靜態檔案託管 ===
  let reqPath = pathname === "/" ? "/index.html" : pathname;
  let safePath = path.normalize(path.join(PUBLIC_DIR, reqPath));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { status: "error", message: "Access Denied" });
    return;
  }

  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "text/plain";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(safePath).pipe(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>404 Not Found - 技術會議雲端儀表板</h1>");
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 技術會議雲端儀表板 (Technical Meeting Cloud Dashboard)`);
  console.log(`🌐 服務運行中: http://localhost:${PORT}`);
  console.log("📁 NAS 資料專區: \\\\192.168.1.221\\\\s5\\\\1003技術會議資料專區");
  console.log(`🛡️ 企業網域門禁: 支援 FU@fengyu.com.tw 統一登入與個人帳密修改`);
  console.log(`=======================================================`);
});
