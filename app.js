import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { RefactorEngine } from './refactor-engine.js';

// Robust export handling for file-saver (handles both default fn and named export via default obj)
const saveAs = FileSaver.saveAs || FileSaver;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const htmlInput = document.getElementById('htmlInput');
const fileNameDisplay = document.getElementById('fileName');
const refactorBtn = document.getElementById('refactorBtn');
const logContainer = document.getElementById('logContainer');
const fileList = document.getElementById('fileList');

// Inputs
const mergeCssCheck = document.getElementById('mergeCss');
const mergeJsCheck = document.getElementById('mergeJs');
const extremeModeCheck = document.getElementById('extremeMode');

// Tab Switching
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}Content`).classList.add('active');
    });
});

// UI Helper: Logger
function addLog(data) {
    const { message, type } = data;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString().split(' ')[0];
    entry.textContent = `[${time}] ${message}`;
    logContainer.appendChild(entry);
    // Auto scroll
    const panel = logContainer.parentElement;
    panel.scrollTop = panel.scrollHeight;
}

// UI Helper: File List
function updateFileList(files) {
    fileList.innerHTML = '';

    if (files.length === 0) {
        fileList.innerHTML = '<div class="empty-state">No files generated.</div>';
        return;
    }

    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';

        let icon = '';
        if (file.name.endsWith('.js')) icon = '';
        if (file.name.endsWith('.css')) icon = '';
        if (file.name.endsWith('.html')) icon = '';

        // Approximate size
        const size = new Blob([file.content]).size;
        const sizeStr = size > 1024 ? (size/1024).toFixed(1) + ' KB' : size + ' B';

        item.innerHTML = `
            <div class="file-info">
                <span class="file-type">${icon}</span>
                <span class="file-name">${file.name}</span>
            </div>
            <span class="file-size">${sizeStr}</span>
        `;
        fileList.appendChild(item);
    });
}

// File Upload Handling
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFile(e.target.files[0]);
    }
});

function handleFile(file) {
    if (file.type !== 'text/html' && !file.name.endsWith('.html')) {
        addLog({ message: 'Error: Please upload a valid HTML file.', type: 'error' });
        return;
    }

    fileNameDisplay.textContent = file.name;
    addLog({ message: `File loaded: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, type: 'info' });

    const reader = new FileReader();
    reader.onload = (e) => {
        htmlInput.value = e.target.result;
        addLog({ message: 'HTML content loaded into editor.', type: 'success' });
    };
    reader.readAsText(file);
}

// Main Refactor Logic
refactorBtn.addEventListener('click', async () => {
    const rawHtml = htmlInput.value;

    if (!rawHtml.trim()) {
        addLog({ message: 'Error: Input is empty. Paste HTML or upload a file.', type: 'error' });
        return;
    }

    // Reset Logs
    logContainer.innerHTML = '';
    addLog({ message: 'Starting Refactor Process...', type: 'info' });

    // Switch to log tab if not active
    document.querySelector('[data-tab="logs"]').click();

    try {
        const engine = new RefactorEngine(addLog);
        const options = {
            mergeCss: mergeCssCheck.checked,
            mergeJs: mergeJsCheck.checked,
            extremeMode: extremeModeCheck.checked
        };

        const result = engine.process(rawHtml, options);

        // Prepare ZIP
        addLog({ message: 'Packaging files into ZIP...', type: 'info' });
        const zip = new JSZip();

        // Add refactored HTML
        zip.file("index.html", result.html);

        // Add extracted files
        result.files.forEach(f => {
            zip.file(f.name, f.content);
        });

        // Update preview list (include index.html manually for display)
        const displayFiles = [{name: 'index.html', content: result.html}, ...result.files];
        updateFileList(displayFiles);

        // Generate and Download
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "refactored-project.zip");

        addLog({ message: 'Success! Download started.', type: 'success' });

    } catch (error) {
        console.error(error);
        addLog({ message: `Critical Error: ${error.message}`, type: 'error' });
    }
});