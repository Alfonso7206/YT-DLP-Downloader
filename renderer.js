const { ipcRenderer, clipboard } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let downloadFolder = null;
let binPaths = null;
let videos = [];

// --- Elementi DOM
const urlArea = document.getElementById("urlArea");
const videoList = document.getElementById("videoList");
const clearList = document.getElementById("clearList");
const audioOnlyChk = document.getElementById("audioOnlyChk");

//--- Bottone Dark/Light
// let themeToggle = document.createElement("button");
// themeToggle.id = "themeToggle";
// themeToggle.textContent = "🌙 Dark/Light";
// document.body.appendChild(themeToggle);

//--- Inizializza tema
// if (!localStorage.getItem("theme")) localStorage.setItem("theme", "dark");
// document.body.dataset.theme = localStorage.getItem("theme");


// --- Bottoni cartella
document.getElementById("openFolderBtn").addEventListener("click", () => ipcRenderer.invoke("open-folder"));
document.getElementById("setFolderBtn").addEventListener("click", async () => {
    const folder = await ipcRenderer.invoke("set-folder");
    if (folder) downloadFolder = folder;
});

// --- Ottieni path binari
(async () => { binPaths = await ipcRenderer.invoke("get-bin-paths"); })();

// --- CSS dinamico
const style = document.createElement("style");
style.innerHTML = `
#urlArea:empty::before { content:"Incolla URL qui"; color:#888; pointer-events:none; }
.download-details { font-family: monospace; white-space: pre; }
.thumbnail { width:120px; height:90px; cursor:pointer; }
.video-item { display:flex; margin-bottom:5px; border:1px solid #ccc; padding:5px; }
.video-info { margin-left:10px; flex:1; }
.progress-bar-container { width:100%; height:6px; background:#eee; margin:4px 0; }
.progress-bar { height:6px; background:#2196F3; width:0%; transition: width 0.2s; }
.stop-btn { margin-left:5px; }
#themeToggle { position:fixed; top:10px; right:10px; padding:6px 12px; border-radius:6px; cursor:pointer; z-index:1000; }
`;
document.head.appendChild(style);

// --- Aggiungi video
function addVideo(url) {
    if (!url || videos.find(v => v.url === url)) return;
    const placeholder = {
        url,
        title: "Caricamento...",
        thumbnail: "",
        duration: "",
        format: null,
        status: "",
        progress: 0,
        pid: Date.now()
    };
    videos.push(placeholder);
    renderVideos();
    fetchVideoDetails(placeholder);
}

// --- Render lista video
function renderVideos() {
    videoList.innerHTML = "";
    videos.forEach((video, index) => {
        const div = document.createElement("div");
        div.className = "video-item";
        div.dataset.pid = video.pid;

        const thumb = video.thumbnail ? `<img src="${video.thumbnail}" class="thumbnail">` : `<div class="spinner"></div>`;
        div.innerHTML = `
            ${thumb}
            <div class="video-info">
                <strong>${video.title}</strong>
                <div class="status">${video.status || ""}</div>
                <label>Qualità:
                    <select onchange="setFormat(${index}, this.value)">
                        <option value="">Migliore disponibile</option>
                        ${video.formats ? video.formats.map(f => `<option value="${f.format_id}">${f.format}</option>`).join('') : ''}
                    </select>
                </label>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width:${video.progress || 0}%"></div>
                </div>
                <div class="download-details">⬇️</div>
            </div>
            <button class="download-btn" onclick="downloadVideo(${index})">Download</button>
            <button class="remove-btn" onclick="removeVideo(${index})">Rimuovi</button>
        `;
        videoList.appendChild(div);
    });
}

// --- Set formato
window.setFormat = (index, formatId) => { if (videos[index]) videos[index].format = formatId; };

// --- Rimuovi video
window.removeVideo = (index) => {
    if (index < 0 || index >= videos.length) return;
    const video = videos[index];
    if (clipboard.readText().trim() === video.url) clipboard.writeText("");
    videos.splice(index, 1);
    renderVideos();
};

// --- Clipboard monitor (solo lista, nessun download automatico)
setInterval(() => {
    const text = clipboard.readText().trim();
    if (text.startsWith("http") && !videos.find(v => v.url === text)) addVideo(text);
}, 1000);

// --- Cancella lista
clearList.addEventListener("click", () => { videos = []; renderVideos(); });

// --- Fetch video details
function fetchVideoDetails(video) {
    if (!binPaths) return;
    const proc = spawn(binPaths.ytDlp, ["-j", "--no-playlist", video.url]);
    let dataStr = "";

    proc.stdout.on("data", chunk => dataStr += chunk.toString());
    proc.stderr.on("data", chunk => console.error("YT-DLP ERR:", chunk.toString()));

    proc.on("close", () => {
        try {
            const info = JSON.parse(dataStr);
            video.title = info.title || "Caricamento...";
            video.thumbnail = info.thumbnail || "";
            video.duration = info.duration_string || "";
            video.formats = info.formats || [];
        } catch (e) { console.error("Errore parsing video:", e); }
        renderVideos();
    });
}

// --- Download video
window.downloadVideo = (index) => {
    const video = videos[index];
    if (!video) return;

    ipcRenderer.invoke("start-download", {
        ...video,
        outputDir: downloadFolder || null,
        audioOnly: audioOnlyChk.checked
    });

    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");

    progressBar.style.width = "0%";
    progressBar.style.backgroundColor = "#2196F3";
    statusText.textContent = "⏳ In coda...";
    detailsText.textContent = "⬇️";

    let stopBtn = videoDiv.querySelector(".stop-btn");
    if (!stopBtn) {
        stopBtn = document.createElement("button");
        stopBtn.textContent = "Stop";
        stopBtn.className = "stop-btn";
        stopBtn.onclick = () => { ipcRenderer.send("stop-download", video.url); stopBtn.disabled = true; };
        videoDiv.appendChild(stopBtn);
    }
    stopBtn.disabled = false;
};

// --- Aggiornamento progress
ipcRenderer.on("download-progress", (event, { url, data }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;
    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".progress-bar");
    const detailsText = videoDiv.querySelector(".download-details");

    let percentMatch = data.match(/(\d+(\.\d+)?)%/);
    let percent = percentMatch ? parseFloat(percentMatch[1]) : 0;
    let etaMatch = data.match(/ETA\s*([\d:]+)/);
    let eta = etaMatch ? etaMatch[1] : "";
    let speedMatch = data.match(/([\d\.]+[KMG]i?B\/s)/i);
    let speedStr = speedMatch ? speedMatch[0] : "";

    video.progress = percent;
    detailsText.textContent = `⬇️   ${percent}%   ${speedStr}   ${eta}`;
    progressBar.style.width = percent + "%";
});

// --- Download completato
ipcRenderer.on("download-complete", (event, { url, code }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;

    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");
    const stopBtn = videoDiv.querySelector(".stop-btn");

    progressBar.style.width = "100%";
    progressBar.style.backgroundColor = code === 0 ? "#4CAF50" : "#F44336";
    statusText.textContent = code === 0 ? "✅ Completato" : "💀 Errore";
    detailsText.textContent = code === 0 ? "⬇️   Completato" : "⬇️   Errore";

    if (stopBtn) stopBtn.remove();
});

// --- Drag & Drop file .txt
urlArea.addEventListener("dragover", e => { e.preventDefault(); urlArea.style.border = "2px dashed #007ACC"; });
urlArea.addEventListener("dragleave", e => { e.preventDefault(); urlArea.style.border = ""; });
urlArea.addEventListener("drop", e => {
    e.preventDefault();
    urlArea.style.border = "";
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.type === "text/plain") {
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result.trim();
            const urls = content.split(/\r?\n/).map(u => u.trim()).filter(u => u);
            urls.forEach(url => addVideo(url));
        };
        reader.readAsText(file);
    } else alert("Trascina un file di testo (.txt)");
});

// --- DARK/LIGHT TOGGLE ---
document.addEventListener("DOMContentLoaded", () => {
    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle) return;

    // Imposta tema iniziale da localStorage o default dark
    let currentTheme = localStorage.getItem("theme") || "dark";
    document.body.setAttribute("data-theme", currentTheme);
    themeToggle.textContent = currentTheme === "dark" ? "🌙" : "☀️";

    // Toggle tema
    themeToggle.addEventListener("click", () => {
        currentTheme = currentTheme === "dark" ? "light" : "dark";
        document.body.setAttribute("data-theme", currentTheme);
        themeToggle.textContent = currentTheme === "dark" ? "🌙" : "☀️";
        localStorage.setItem("theme", currentTheme);
    });
});
