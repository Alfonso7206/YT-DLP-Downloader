		const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require("electron");
		const { spawn, exec } = require("child_process");
		const path = require("path");
		const fs = require("fs");
		const axios = require("axios");
		const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
		const extract = require("extract-zip");
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

		// ---- LOG ERRORI ----
		function logError(message) {
			const logFile = path.join(app.getPath("userData"), "error.log");
			const timestamp = new Date().toISOString();
			fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, "utf8");
		}

		// ---- CONTROLLO yt-dlp ----
		function getBinDir() {
			return app.isPackaged
				? path.join(process.resourcesPath, "..", "bin")
				: path.join(__dirname, "Bin");
		}
		const ytDlpPath = path.join(getBinDir(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

		function ensureYtDlpExists() {
			if (!fs.existsSync(ytDlpPath)) {
				const msg = `yt-dlp non trovato in: ${ytDlpPath}`;
				logError(msg);
				throw new Error(msg);
			}
		}

		// ---- SETTINGS ----
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

		// ---- WINDOW ----
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

		// ---- IPC ----
		ipcMain.handle("get-settings", () => {
			return {
				links: settings.links,
				options: settings.options,
				downloadFolder: settings.downloadFolder,
				theme: settings.theme,
			};
		});

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

		// ---- yt-dlp HELP ----
		ipcMain.handle("yt-dlp-help", async () => {
			try {
				ensureYtDlpExists();
				return new Promise((resolve, reject) => {
					exec(`"${ytDlpPath}" -h`, (error, stdout, stderr) => {
						if (error) {
							logError(`Errore yt-dlp-help: ${error.message}`);
							return reject(error.message);
						}
						resolve(stdout || stderr);
					});
				});
			} catch (err) {
				return Promise.reject(err.message);
			}
		});

		// ---- CARTELLA DOWNLOAD ----
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

		// ---- PATH BIN ----
		ipcMain.handle("get-bin-paths", () => {
			const binDir = getBinDir();
			return {
				ytDlp: path.join(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
				ffmpeg: path.join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
				ffprobe: path.join(binDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
			};
		});

		// ---- TEMA ----
		ipcMain.on("set-theme", (event, newTheme) => {
			settings.theme = newTheme;
			nativeTheme.themeSource = newTheme;
			saveSettings();
		});

		// ---- UPDATE yt-dlp ----
		ipcMain.handle("update-yt-dlp", async (event) => {
			try {
				ensureYtDlpExists();
			} catch (err) {
				return Promise.reject(err.message);
			}

			return new Promise((resolve, reject) => {
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

				proc.on("close", code => resolve({ code, output }));

				proc.on("error", err => {
					logError(`Errore update-yt-dlp: ${err.message}`);
					reject(err);
				});
			});
		});
		// Scarica URL FFmpeg/FFprobe dall’API ffbinaries
		ipcMain.handle("download-binaries", async (event) => {
			const binFolder = getBinDir();
			if (!fs.existsSync(binFolder)) fs.mkdirSync(binFolder, { recursive: true });

			try {
				// Scarica URL FFmpeg/FFprobe dall’API ffbinaries
				const ffData = await axios.get("https://ffbinaries.com/api/v1/version/latest").then(r => r.data);
				const urls = ffData.bin["windows-64"]; // puoi aggiungere controllo per platform

		const files = [
			{ name: "ffmpeg", url: urls.ffmpeg, zip: path.join(binFolder, "ffmpeg.zip") },
			{ name: "ffprobe", url: urls.ffprobe, zip: path.join(binFolder, "ffprobe.zip") }, 
			// Scarica la versione notturna di yt-dlp
			{ name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe", zip: path.join(binFolder, "yt-dlp.exe") }
		];

		for (const file of files) {
			sendToRenderer("download-binaries-log", `Downloading ${file.name}...`);

			if (file.name === "yt-dlp") {
				await downloadFile(file.url, file.zip);
			} else {
				await downloadFile(file.url, file.zip);
				sendToRenderer("download-binaries-log", `Extraction ${file.name}...`);
				await extract(file.zip, { dir: binFolder });
				if (fs.existsSync(file.zip)) fs.unlinkSync(file.zip);
			}
		}


				sendToRenderer("download-binaries-log", "All binaries downloaded and ready!");
				return "Completed!";
			} catch (err) {
				logError(`Download-binaries error: ${err.message}`);
				throw err;
			}
		});
		// ---- DOWNLOAD ----
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

		function startDownload(video) {
			try {
				ensureYtDlpExists();
			} catch (err) {
				sendToRenderer("download-complete", { url: video.url, code: 1, error: err.message });
				return;
			}

			const outputDir = video.outputDir || settings.downloadFolder || app.getPath("downloads");
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
				logError(`Errore startDownload: ${e.message}`);
				sendToRenderer("download-complete", { url: video.url, code: 1 });
			}
		}
		async function downloadFile(url, dest) {
			const fs = require("fs");
			const axios = require("axios");
			const writer = fs.createWriteStream(dest);

			const response = await axios({ url, method: "GET", responseType: "stream" });
			const total = parseInt(response.headers["content-length"], 10);
			let downloaded = 0;

			response.data.on("data", chunk => {
				downloaded += chunk.length;
				const percent = total ? Math.round((downloaded / total) * 100) : 0;
				sendToRenderer("download-binaries-progress", { percent });
			});

			response.data.pipe(writer);

			return new Promise((resolve, reject) => {
				writer.on("finish", resolve);
				writer.on("error", reject);
			});
		}

		// ---- CLEANUP ----
		app.on("window-all-closed", () => {
			Object.values(activeDownloads).forEach(entry => {
				try {
					const p = entry.proc || entry;
					if (p && !p.killed) p.kill();
				} catch (e) { }
			});
			if (process.platform !== "darwin") app.quit();
		});
