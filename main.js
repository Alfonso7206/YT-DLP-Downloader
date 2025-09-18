
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
};


function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
            const s = JSON.parse(raw);

            settings = {
                links: s.links || [],
                options: s.options || { audioOnly: false, convertMkv: false, playlist: false },
                downloadFolder: s.downloadFolder || null,
                theme: s.theme || "dark",
            };
        } else {

            saveSettings();
        }
    } catch (e) {
        console.error("Error loading settings:", e);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
    } catch (e) {
        console.error("Error saving settings:", e);
    }
}


loadSettings();
nativeTheme.themeSource = settings.theme;


function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}


function getBinDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "..", "bin")
    : path.join(__dirname, "Bin");
}


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


    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);

    mainWindow.webContents.on("before-input-event", (event, input) => {
        if ((input.control || input.meta) && ["r", "i"].includes(input.key.toLowerCase())) {
            event.preventDefault();
        }
    });
}

app.whenReady().then(createWindow);


ipcMain.handle("get-settings", () => {
    return {
        links: settings.links,
        options: settings.options,
        downloadFolder: settings.downloadFolder,
        theme: settings.theme,
    };
});


//
ipcMain.on("save-settings", (event, newSettings) => {
    if (typeof newSettings === "object") {
        if (Array.isArray(newSettings.links)) settings.links = newSettings.links;
        if (newSettings.options && typeof newSettings.options === "object") settings.options = newSettings.options;
        if (newSettings.downloadFolder !== undefined) settings.downloadFolder = newSettings.downloadFolder;
        if (newSettings.theme) {
            settings.theme = newSettings.theme;
            nativeTheme.themeSource = settings.theme;
        }
    }
    saveSettings();
});


ipcMain.handle("open-folder", async () => {
    const folder = settings.downloadFolder || app.getPath("downloads");
    const result = await shell.openPath(folder);
    if (result) console.error("Error opening folder:", result);
    return folder;
});


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


ipcMain.handle("get-bin-paths", () => {
    const binDir = getBinDir();
    return {
        ytDlp: path.join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
        ffmpeg: path.join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
        ffprobe: path.join(binDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    };
});


ipcMain.on("set-theme", (event, newTheme) => {
    settings.theme = newTheme;
    nativeTheme.themeSource = newTheme;
    saveSettings();
});

const ytDlpPath = path.join(getBinDir(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

ipcMain.handle("update-yt-dlp", async (event) => {
    return new Promise((resolve, reject) => {
        const ytDlpPath = path.join(getBinDir(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

        const proc = spawn(ytDlpPath, ["-U"]);
        let output = "";

        proc.stdout.on("data", data => {
            output += data.toString();
            event.sender.send("update-log", data.toString());
        });

        proc.stderr.on("data", data => {
            output += data.toString();
            event.sender.send("update-log", data.toString());
        });

        proc.on("close", code => {
            resolve({ code, output });
        });

        proc.on("error", err => {
            reject(err);
        });
    });
	});
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
const { exec } = require("child_process");



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


app.on("window-all-closed", () => {
    Object.values(activeDownloads).forEach(entry => {
        try {
            const p = entry.proc || entry;
            if (p && !p.killed) p.kill();
        } catch (e) { }
    });
    if (process.platform !== "darwin") app.quit();
});
