const { ipcRenderer, clipboard } = require("electron");
const { spawn } = require("child_process");

let downloadFolder = null;
let binPaths = null;
let videos = [];

// --- DOM elements
const urlArea = document.getElementById("urlArea");
const videoList = document.getElementById("videoList");
const clearList = document.getElementById("clearList");
const audioOnlyChk = document.getElementById("audioOnlyChk");
const convertMkvChk = document.getElementById("convertMkvChk");
const folderInput = document.getElementById("folderLabel");
const themeToggle = document.getElementById("themeToggle");
// Gestione disabilitazione incrociata
audioOnlyChk.addEventListener("change", () => {
    if (audioOnlyChk.checked) {
        convertMkvChk.checked = false;
        convertMkvChk.disabled = true;
    } else {
        convertMkvChk.disabled = false;
    }
});

convertMkvChk.addEventListener("change", () => {
    if (convertMkvChk.checked) {
        audioOnlyChk.checked = false;
        audioOnlyChk.disabled = true;
    } else {
        audioOnlyChk.disabled = false;
    }
});
// ===================== INIT =====================
document.addEventListener("DOMContentLoaded", async () => {
    const settings = await ipcRenderer.invoke("get-settings");
    downloadFolder = settings.downloadFolder;
    const theme = settings.theme || "dark";

    if (folderInput) folderInput.value = downloadFolder || "";
    document.body.dataset.theme = theme;
    themeToggle.textContent = theme === "dark" ? "🌙" : "☀️";

    binPaths = await ipcRenderer.invoke("get-bin-paths");
});

// ===================== THEME TOGGLE =====================
themeToggle.addEventListener("click", () => {
    const newTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = newTheme;
    themeToggle.textContent = newTheme === "dark" ? "🌙" : "☀️";
    ipcRenderer.send("set-theme", newTheme);
});

// ===================== FOLDER =====================
document.getElementById("openFolderBtn").addEventListener("click", () => ipcRenderer.invoke("open-folder"));

document.getElementById("setFolderBtn").addEventListener("click", async () => {
    const folder = await ipcRenderer.invoke("set-folder");
    if (folder) {
        ipcRenderer.invoke("save-download-folder", folder).then(savedFolder => {
            downloadFolder = savedFolder;
            if (folderInput) folderInput.value = savedFolder;
        });
    }
});

// ===================== LISTA VIDEO =====================
function addVideo(url) {
    if (!url || videos.find(v => v.url === url)) return;
    const video = {
        url,
        title: "Caricamento...",
        thumbnail: "",
        duration: "",
        formats: null,
        status: "",
        progress: 0,
        pid: Date.now(),
        format: null
    };
    videos.push(video);
    renderVideos();
    fetchVideoDetails(video);
}

function renderVideos() {
    videoList.innerHTML = "";
    videos.forEach((video, index) => {
        const div = document.createElement("div");
        div.className = "video-item";
        div.dataset.pid = video.pid;
        div.draggable = true;

        const thumb = video.thumbnail ? `<img src="${video.thumbnail}" class="thumbnail">` : `<div class="spinner"></div>`;

        const formatOptions = video.formats ? video.formats.map(f =>
            `<option value="${f.format_id}">${f.format_id} (${f.ext})${f.sizeStr ? ' - ' + f.sizeStr : ''}</option>`
        ).join('') : '';

        div.innerHTML = `
            ${thumb}
            <div class="video-info">
                <strong>${video.title}</strong>
                <div class="status">${video.status || ""}</div>
                <label>Qualità:
                    <select onchange="setFormat(${index}, this.value)">
                        <option value="">Migliore disponibile</option>
                        ${formatOptions}
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

    // Mostra o nascondi il pulsante clearList in base alla lista
    clearList.style.display = videos.length > 0 ? "inline-block" : "none";

    addDragAndDropHandlers();
}


window.setFormat = (index, formatId) => { if (videos[index]) videos[index].format = formatId; };

window.removeVideo = (index) => {
    const video = videos[index];
    if (clipboard.readText().trim() === video.url) clipboard.writeText("");
    videos.splice(index, 1);
    renderVideos();
};

clearList.addEventListener("click", () => { videos = []; renderVideos(); });

// ===================== CLIPBOARD MONITOR =====================
setInterval(() => {
    const text = clipboard.readText().trim();
    if (text.startsWith("http") && !videos.find(v => v.url === text)) addVideo(text);
}, 1000);

// ===================== DRAG & DROP FILE =====================
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

// ===================== FETCH VIDEO DETAILS =====================
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

            // Calcola dimensione leggibile
            video.formats = video.formats.map(f => {
                let sizeStr = '';
                if (f.filesize || f.filesize_approx) {
                    let bytes = f.filesize || f.filesize_approx;
                    if (bytes < 1024*1024) sizeStr = (bytes/1024).toFixed(1) + ' KB';
                    else if (bytes < 1024*1024*1024) sizeStr = (bytes/(1024*1024)).toFixed(1) + ' MB';
                    else sizeStr = (bytes/(1024*1024*1024)).toFixed(2) + ' GB';
                }
                return { ...f, sizeStr };
            });
        } catch (e) { console.error("Errore parsing video:", e); }
        renderVideos();
    });
}

// ===================== DOWNLOAD =====================
window.downloadVideo = (index) => {
    const video = videos[index];
    if (!video) return;

    const audioOnly = audioOnlyChk.checked;
    const convertMkv = convertMkvChk.checked;

    ipcRenderer.invoke("start-download", {
        ...video,
        outputDir: downloadFolder || null,
        audioOnly: audioOnly,
        recode: convertMkv ? "mkv" : null
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
        stopBtn.onclick = () => {
            ipcRenderer.send("stop-download", video.url);
            stopBtn.disabled = true;
        };
        videoDiv.appendChild(stopBtn);
    }
    stopBtn.disabled = false;
};

// ===================== DOWNLOAD PROGRESS =====================
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

// ===================== STOP DOWNLOAD =====================
ipcRenderer.on("download-stopped", (event, { url }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;

    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");
    const stopBtn = videoDiv.querySelector(".stop-btn");

    progressBar.style.backgroundColor = "#F44336";
    statusText.textContent = "⛔ Interrotto";
    detailsText.textContent = "⬇️   Interrotto";
    if (stopBtn) stopBtn.disabled = true;
});

// ===================== DRAG & DROP REORDER =====================
let dragSrcEl = null;
function handleDragStart(e) { dragSrcEl = this; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.outerHTML); this.classList.add('dragging'); }
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDragEnter() { this.classList.add('over'); }
function handleDragLeave() { this.classList.remove('over'); }
function handleDrop(e) {
    e.stopPropagation();
    if (dragSrcEl !== this) {
        const parent = this.parentNode;
        const mouseY = e.clientY;
        const targetRect = this.getBoundingClientRect();
        const insertAfter = mouseY > targetRect.top + targetRect.height / 2;
        parent.removeChild(dragSrcEl);
        if (insertAfter) this.insertAdjacentElement('afterend', dragSrcEl);
        else this.insertAdjacentElement('beforebegin', dragSrcEl);
        const newOrder = [];
        parent.querySelectorAll('.video-item').forEach(el => {
            const pid = parseInt(el.dataset.pid);
            const vid = videos.find(v => v.pid === pid);
            if (vid) newOrder.push(vid);
        });
        videos = newOrder;
        addDragAndDropHandlers();
    }
    this.classList.remove('over');
    return false;
}
function handleDragEnd() { this.classList.remove('dragging'); document.querySelectorAll('.video-item').forEach(item => item.classList.remove('over')); }
function addDragAndDropHandlers() {
    document.querySelectorAll('.video-item').forEach(item => {
        item.addEventListener('dragstart', handleDragStart, false);
        item.addEventListener('dragenter', handleDragEnter, false);
        item.addEventListener('dragover', handleDragOver, false);
        item.addEventListener('dragleave', handleDragLeave, false);
        item.addEventListener('drop', handleDrop, false);
        item.addEventListener('dragend', handleDragEnd, false);
    });
}
