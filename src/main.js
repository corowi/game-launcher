const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = 3131;
let mainWindow = null;
let httpServer = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

function scanForExecutables(dirPath, maxDepth = 3, currentDepth = 0) {
  const results = [];
  if (currentDepth > maxDepth) return results;

  // On Linux/Mac we look for any executable file, on Windows .exe
  const isWindows = process.platform === "win32";

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanForExecutables(fullPath, maxDepth, currentDepth + 1));
    } else if (entry.isFile()) {
      let isExec = false;
      if (isWindows) {
        isExec = entry.name.toLowerCase().endsWith(".exe");
      } else {
        // On Linux/Mac: check for .AppImage, executable bit, or no extension
        try {
          const stat = fs.statSync(fullPath);
          const isExecutableBit = !!(stat.mode & 0o111);
          const isAppImage = entry.name.toLowerCase().endsWith(".appimage");
          const hasNoExtension = !path.extname(entry.name);
          isExec = isExecutableBit && (isAppImage || hasNoExtension);
        } catch {}
      }

      if (isExec) {
        try {
          const stats = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            path: fullPath,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            directory: dirPath,
          });
        } catch {}
      }
    }
  }
  return results;
}

function listDirectory(dirPath) {
  const isWindows = process.platform === "win32";

  if (!dirPath) {
    // Root level — show drives on Windows, / on Linux/Mac
    if (isWindows) {
      const drives = [];
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const d = letter + ":\\";
        if (fs.existsSync(d)) {
          drives.push({ name: d, path: d, isDirectory: true, isExec: false, size: 0, sizeFormatted: "" });
        }
      }
      return { items: drives, path: "Meu Computador" };
    } else {
      // Unix root
      return listDirectory("/");
    }
  }

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return { error: "Sem permissão ou pasta inválida: " + e.message };
  }

  const items = entries.map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    let size = 0;
    let isExec = false;

    try {
      if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        size = stat.size;
        if (isWindows) {
          isExec = entry.name.toLowerCase().endsWith(".exe");
        } else {
          isExec = !!(stat.mode & 0o111) && !entry.isDirectory();
        }
      }
    } catch {}

    return {
      name: entry.name,
      path: fullPath,
      isDirectory: entry.isDirectory(),
      isExec,
      size,
      sizeFormatted: formatBytes(size),
    };
  });

  items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return { items, path: dirPath };
}

function launchExecutable(exePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(exePath)) {
      resolve({ ok: false, error: "Arquivo não encontrado: " + exePath });
      return;
    }

    const workingDir = path.dirname(exePath);
    console.log("[LAUNCH]", exePath);

    const child = spawn(exePath, [], {
      cwd: workingDir,
      detached: true,
      stdio: "ignore",
      shell: process.platform !== "win32", // shell needed on Linux/Mac
    });

    child.unref();

    child.on("error", (err) => {
      console.error("[LAUNCH ERROR]", err.message);
    });

    resolve({ ok: true, message: `Iniciando: ${path.basename(exePath)}`, pid: child.pid });
  });
}

// ── Embedded HTTP server ────────────────────────────────────────────────────

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function startServer() {
  httpServer = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }

    // Serve the HTML UI
    if (pathname === "/" || pathname === "/index.html") {
      const htmlPath = path.join(__dirname, "index.html");
      fs.readFile(htmlPath, (err, data) => {
        if (err) { res.writeHead(500); res.end("UI not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      });
      return;
    }

    if (pathname === "/api/ping") {
      sendJSON(res, 200, { ok: true, platform: process.platform });
      return;
    }

    if (pathname === "/api/scan" && req.method === "GET") {
      const dirPath = parsed.query.path;
      if (!dirPath || !fs.existsSync(dirPath)) {
        sendJSON(res, 404, { error: "Diretório não encontrado: " + dirPath });
        return;
      }
      const exeFiles = scanForExecutables(dirPath);
      sendJSON(res, 200, { path: dirPath, exeFiles, count: exeFiles.length });
      return;
    }

    if (pathname === "/api/list" && req.method === "GET") {
      const dirPath = parsed.query.path || null;
      sendJSON(res, 200, listDirectory(dirPath));
      return;
    }

    if (pathname === "/api/launch" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { path: exePath } = JSON.parse(body);
          const result = await launchExecutable(exePath);
          sendJSON(res, result.ok ? 200 : 404, result);
        } catch {
          sendJSON(res, 400, { error: "JSON inválido" });
        }
      });
      return;
    }

    // Open folder dialog (Electron only)
    if (pathname === "/api/browse" && req.method === "GET") {
      dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Selecionar Pasta",
      }).then((result) => {
        if (result.canceled || !result.filePaths.length) {
          sendJSON(res, 200, { canceled: true });
        } else {
          sendJSON(res, 200, { path: result.filePaths[0] });
        }
      });
      return;
    }

    sendJSON(res, 404, { error: "Rota não encontrada" });
  });

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
  });
}

// ── Electron Window ─────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 550,
    title: "Game Launcher",
    backgroundColor: "#080c14",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    // Icon per platform
    icon: path.join(__dirname, "assets",
      process.platform === "win32" ? "icon.ico" :
      process.platform === "darwin" ? "icon.icns" : "icon.png"
    ),
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  // Small delay to ensure server is up before loading
  setTimeout(createWindow, 300);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (httpServer) httpServer.close();
  if (process.platform !== "darwin") app.quit();
});
