const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// ===================== SETTINGS =====================
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

// Carica settings o crea default
let settings = {};
try {
    if (fs.existsSync(SETTINGS_PATH)) {
        settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    }
} catch (e) {
    console.error("Errore leggendo settings.json:", e);
}

// Imposta default se manca
settings.downloadFolder = settings.downloadFolder || null;
settings.theme = settings.theme || "dark";

// Salva subito per creare il file
try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
    console.log("Settings inizializzato in:", SETTINGS_PATH);
} catch (e) {
    console.error("Errore salvando settings.json:", e);
}

// ===================== VARIABILI GLOBALI =====================
let mainWindow;
let activeDownloads = {};
let downloadFolder = settings.downloadFolder;
let theme = settings.theme;
nativeTheme.themeSource = theme;

// ===================== FUNZIONE SICURA INVIO RENDERER =====================
function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// ===================== FINESTRA PRINCIPALE =====================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: "#121212"
    });

    mainWindow.loadFile("index.html");

    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);

    mainWindow.webContents.on("before-input-event", (event, input) => {
        if ((input.control || input.meta) && ["r", "i"].includes(input.key.toLowerCase())) {
            event.preventDefault();
        }
    });
}

// ===================== BINARIES =====================
function getBinDir() {
    return app.isPackaged ? path.join(process.resourcesPath, "Bin") : path.join(__dirname, "Bin");
}

// ===================== SAVE SETTINGS =====================
function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
    } catch (e) {
        console.error("Errore salvando settings.json:", e);
    }
}

// ===================== IPC HANDLERS =====================
ipcMain.handle("open-folder", async () => {
    const folder = downloadFolder || app.getPath("downloads");
    const result = await shell.openPath(folder);
    if (result) console.error("Errore aprendo cartella:", result);
    return folder;
});

ipcMain.handle("set-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths.length > 0) {
        downloadFolder = result.filePaths[0];
        settings.downloadFolder = downloadFolder;
        saveSettings();
        return downloadFolder;
    }
    return null;
});

ipcMain.handle("get-bin-paths", () => {
    const binDir = getBinDir();
    return {
        ytDlp: path.join(binDir, "yt-dlp.exe"),
        ffmpeg: path.join(binDir, "ffmpeg.exe"),
        ffprobe: path.join(binDir, "ffprobe.exe")
    };
});
ipcMain.handle("get-settings", () => {
    return {
        downloadFolder: downloadFolder,
        theme: theme
    };
});
ipcMain.handle("start-download", (event, video) => startDownload(video));

ipcMain.on("stop-download", (event, url) => {
    const proc = activeDownloads[url];
    if (proc) {
        const pid = proc.pid;

        // Su Windows forza la chiusura del processo e dei figli
        spawn("taskkill", ["/PID", pid.toString(), "/T", "/F"]);

        delete activeDownloads[url];

        // Invia evento al renderer
        sendToRenderer("download-stopped", { url });
    }
});
ipcMain.handle("save-download-folder", (event, folder) => {
    settings.downloadFolder = folder;
    saveSettings();
    return settings.downloadFolder; // restituisce l'output salvato
});
ipcMain.on("set-theme", (event, newTheme) => {
    theme = newTheme;
    nativeTheme.themeSource = theme;
    settings.theme = newTheme;
    saveSettings();
});

// ===================== DOWNLOAD =====================
function startDownload(video) {
    const outputDir = video.outputDir || downloadFolder || app.getPath("downloads");
    const binDir = getBinDir();
    const ytDlpPath = path.join(binDir, "yt-dlp.exe");

    const args = ["-o", `${outputDir}/%(title)s.%(ext)s`];

// Solo audio
if (video.audioOnly) {
    args.push("-x", "--audio-format", "mp3");
} else if (video.format) {
    args.push("-f", video.format);
}

// Playlist
if (video.playlist) {
    args.push("--yes-playlist");
} else {
    args.push("--no-playlist");
}

    // Ricodifica in MKV se richiesto
    if (video.recode) {
        args.push("--recode-video", video.recode); // esempio: "mkv"
    }


    args.push(video.url);

    const proc = spawn(ytDlpPath, args);
    activeDownloads[video.url] = proc;

    proc.stdout.on("data", chunk => sendToRenderer("download-progress", { url: video.url, data: chunk.toString() }));
    proc.stderr.on("data", chunk => sendToRenderer("download-progress", { url: video.url, data: chunk.toString() }));

    proc.on("close", (code) => {
        delete activeDownloads[video.url];
        sendToRenderer("download-complete", { url: video.url, code });
    });
}


// ===================== APP READY =====================
app.whenReady().then(createWindow);

// ===================== CHIUSURA =====================
app.on("window-all-closed", () => {
    Object.values(activeDownloads).forEach(proc => {
        if (!proc.killed) proc.kill();
    });
    if (process.platform !== "darwin") app.quit();
});
