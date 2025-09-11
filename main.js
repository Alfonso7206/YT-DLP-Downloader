// main.js - completo aggiornato
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

let mainWindow;
let activeDownloads = {};
let settings = {
    links: [],
    options: {
        audioOnly: false,
        convertMkv: false,
        playlist: false
    },
    downloadFolder: null,
    theme: "dark",
    language: "it" // default language
};

// ---------- settings load/save ----------
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
            const s = JSON.parse(raw);
            // Merge defaults
            settings = {
                links: s.links || [],
                options: s.options || { audioOnly: false, convertMkv: false, playlist: false },
                downloadFolder: s.downloadFolder || null,
                theme: s.theme || "dark",
                language: s.language || "it"
            };
        } else {
            // write defaults immediately
            saveSettings();
        }
    } catch (e) {
        console.error("Errore caricando settings:", e);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
    } catch (e) {
        console.error("Errore salvando settings:", e);
    }
}

// initialize settings on startup
loadSettings();
nativeTheme.themeSource = settings.theme;

// ---------- helper: send to renderer ----------
function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// ---------- bin dir helpers ----------
function getBinDir() {
    return app.isPackaged ? path.join(process.resourcesPath, "Bin") : path.join(__dirname, "Bin");
}

// ---------- create window ----------
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: "#121212"
    });

    mainWindow.loadFile("index.html");

    // remove menu
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);

    mainWindow.webContents.on("before-input-event", (event, input) => {
        if ((input.control || input.meta) && ["r", "i"].includes(input.key.toLowerCase())) {
            event.preventDefault();
        }
    });
}

app.whenReady().then(createWindow);

// ---------- IPC handlers ----------

// Return settings to renderer
ipcMain.handle("get-settings", () => {
    return {
        links: settings.links,
        options: settings.options,
        downloadFolder: settings.downloadFolder,
        theme: settings.theme,
        language: settings.language
    };
});

// Save settings (full object)
ipcMain.on("save-settings", (event, newSettings) => {
    if (typeof newSettings === "object") {
        if (Array.isArray(newSettings.links)) settings.links = newSettings.links;
        if (newSettings.options && typeof newSettings.options === "object") settings.options = newSettings.options;
        if (newSettings.downloadFolder !== undefined) settings.downloadFolder = newSettings.downloadFolder;
        if (newSettings.theme) {
            settings.theme = newSettings.theme;
            nativeTheme.themeSource = settings.theme;
        }
        if (newSettings.language) {
            settings.language = newSettings.language;
        }
    }
    saveSettings();
});

// Open folder
ipcMain.handle("open-folder", async () => {
    const folder = settings.downloadFolder || app.getPath("downloads");
    const result = await shell.openPath(folder);
    if (result) console.error("Errore aprendo cartella:", result);
    return folder;
});

// Ask user to choose folder
ipcMain.handle("set-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths.length > 0) {
        settings.downloadFolder = result.filePaths[0];
        saveSettings();
        return settings.downloadFolder;
    }
    return null;
});

ipcMain.handle("save-download-folder", (event, folder) => {
    settings.downloadFolder = folder;
    saveSettings();
    return settings.downloadFolder;
});

// return bin paths (yt-dlp, ffmpeg, ffprobe)
ipcMain.handle("get-bin-paths", () => {
    const binDir = getBinDir();
    return {
        ytDlp: path.join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
        ffmpeg: path.join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
        ffprobe: path.join(binDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    };
});

// Theme setter
ipcMain.on("set-theme", (event, newTheme) => {
    settings.theme = newTheme;
    nativeTheme.themeSource = newTheme;
    saveSettings();
});

// ---------- Download management ----------
ipcMain.handle("start-download", (event, video) => {
    startDownload(video);
});

ipcMain.on("stop-download", (event, urlOrPid) => {
    const procEntry = activeDownloads[urlOrPid] || Object.values(activeDownloads).find(p => p.meta && (p.meta.url === urlOrPid || p.meta.pid == urlOrPid));
    const proc = procEntry && procEntry.proc ? procEntry.proc : procEntry;
    if (proc && proc.pid) {
        try {
            if (process.platform === "win32") {
                spawn("taskkill", ["/PID", proc.pid.toString(), "/T", "/F"]);
            } else {
                proc.kill("SIGTERM");
            }
        } catch (e) {
            console.error("Errore killing proc:", e);
        }
    }
});

// startDownload function
function startDownload(video) {
    const outputDir = video.outputDir || settings.downloadFolder || app.getPath("downloads");
    const binDir = getBinDir();
    const ytDlpPath = path.join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

    const args = ["-o", path.join(outputDir, "%(title)s.%(ext)s")];

    if (video.audioOnly) {
        args.push("-x", "--audio-format", "mp3");
    } else if (video.format) {
        args.push("-f", video.format);
    }

    if (video.recode) {
        args.push("--recode-video", video.recode);
    }

    if (video.playlist) args.push("--yes-playlist");
    else args.push("--no-playlist");

    args.push(video.url);

    try {
        const proc = spawn(ytDlpPath, args, { windowsHide: true });
        activeDownloads[video.url] = { proc, meta: { url: video.url, pid: video.pid || Date.now() } };

        proc.stdout.on("data", chunk => sendToRenderer("download-progress", { url: video.url, data: chunk.toString() }));
        proc.stderr.on("data", chunk => sendToRenderer("download-progress", { url: video.url, data: chunk.toString() }));

        proc.on("close", (code) => {
            delete activeDownloads[video.url];
            sendToRenderer("download-complete", { url: video.url, code });
        });
    } catch (e) {
        console.error("Errore startDownload:", e);
        sendToRenderer("download-complete", { url: video.url, code: 1 });
    }
}

// Ensure child procs are killed on app quit
app.on("window-all-closed", () => {
    Object.values(activeDownloads).forEach(entry => {
        try {
            const p = entry.proc || entry;
            if (p && !p.killed) p.kill();
        } catch (e) { }
    });
    if (process.platform !== "darwin") app.quit();
});
