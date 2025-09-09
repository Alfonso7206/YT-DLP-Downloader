const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let mainWindow;
let activeDownloads = {};
let downloadFolder = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 985,
        height: 700,
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

app.whenReady().then(() => {
    nativeTheme.themeSource = "dark";
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// --- Percorso cartella binari
function getBinDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "bin"); // build
    } else {
        return path.join(__dirname, "bin"); // sviluppo
    }
}

// --- Apri cartella download
ipcMain.handle("open-folder", async () => {
    const folder = downloadFolder || app.getPath("downloads");
    await shell.openPath(folder);
});

// --- Imposta cartella download
ipcMain.handle("set-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths.length > 0) {
        downloadFolder = result.filePaths[0];
        return downloadFolder;
    }
    return null;
});

// --- Avvia download
ipcMain.handle("start-download", (event, video) => {
    startDownload(video);
});

// --- Stop download
ipcMain.on("stop-download", (event, url) => {
    const proc = activeDownloads[url];
    if (proc) {
        proc.kill();
        delete activeDownloads[url];
        mainWindow.webContents.send("download-stopped", { url });
    }
});

// --- Fornisce path binari al renderer
ipcMain.handle("get-bin-paths", () => {
    const binDir = getBinDir();
    return {
        ytDlp: path.join(binDir, "yt-dlp.exe"),
        ffmpeg: path.join(binDir, "ffmpeg.exe"),
        ffprobe: path.join(binDir, "ffprobe.exe")
    };
});

// --- Funzione download
function startDownload(video) {
    const outputDir = video.outputDir || downloadFolder || app.getPath("downloads");
    const binDir = getBinDir();
    const ytDlpPath = path.join(binDir, "yt-dlp.exe");

    const args = ["-o", `${outputDir}/%(title)s.%(ext)s`];

    if (video.audioOnly) {
        args.push("-x", "--audio-format", "mp3");
    } else if (video.format) {
        args.push("-f", video.format);
    }

    args.push(video.url);

    const proc = spawn(ytDlpPath, args);
    activeDownloads[video.url] = proc;

    proc.stdout.on("data", chunk => {
        mainWindow.webContents.send("download-progress", { url: video.url, data: chunk.toString() });
    });

    proc.stderr.on("data", chunk => {
        mainWindow.webContents.send("download-progress", { url: video.url, data: chunk.toString() });
    });

    proc.on("close", (code) => {
        delete activeDownloads[video.url];
        mainWindow.webContents.send("download-complete", { url: video.url, code });
    });
}
