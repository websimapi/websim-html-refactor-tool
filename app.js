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
const aiSplitCheck = document.getElementById('aiSplit');
const removeCommentsBtn = document.getElementById('removeCommentsBtn');

// Preview Elements
const previewFrame = document.getElementById('previewFrame');
const previewPageSelect = document.getElementById('previewPageSelect');
const viewOriginalBtn = document.getElementById('viewOriginalBtn');
const viewRefactoredBtn = document.getElementById('viewRefactoredBtn');

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

// Remove Comments Handler
removeCommentsBtn.addEventListener('click', () => {
    const raw = htmlInput.value;
    if (!raw.trim()) return;
    
    addLog({ message: 'Cleaning code...', type: 'info' });
    
    // We can instantiate the engine just for this utility
    const engine = new RefactorEngine(addLog);
    const cleaned = engine.removeComments(raw);
    
    htmlInput.value = cleaned;
    addLog({ message: 'Comments removed from input editor.', type: 'success' });
});

// AI Toggle Handler (UX polish)
aiSplitCheck.addEventListener('change', (e) => {
    if (e.target.checked) {
        mergeCssCheck.disabled = true;
        mergeJsCheck.disabled = true;
        mergeCssCheck.parentElement.style.opacity = '0.5';
        mergeJsCheck.parentElement.style.opacity = '0.5';
        addLog({ message: 'AI Split enabled: Manual merge options disabled.', type: 'info' });
    } else {
        mergeCssCheck.disabled = false;
        mergeJsCheck.disabled = false;
        mergeCssCheck.parentElement.style.opacity = '1';
        mergeJsCheck.parentElement.style.opacity = '1';
    }
});

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

        let icon = '📄';
        if (file.name.endsWith('.js')) icon = '📜';
        if (file.name.endsWith('.css')) icon = '🎨';
        if (file.name.endsWith('.html')) icon = '🌐';
        if (file.isBinary) icon = '🖼️';

        // Approximate size
        let size = 0;
        if (file.content) {
            size = file.content.length; 
            if (file.isBinary && typeof file.content === 'string' && file.content.startsWith('data:')) {
                // Base64 size adjustment
                size = Math.round((file.content.length - file.content.indexOf(',') - 1) * 0.75);
            }
        }
        
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

// State
let currentProjectFiles = []; // Array of {name, content, type}
let refactoredProjectFiles = [];
let currentPreviewMode = 'original'; // 'original' or 'refactored'

// Preview Toggles
viewOriginalBtn.addEventListener('click', () => {
    viewOriginalBtn.classList.add('active');
    viewRefactoredBtn.classList.remove('active');
    currentPreviewMode = 'original';
    updatePreview();
});

viewRefactoredBtn.addEventListener('click', () => {
    if (refactoredProjectFiles.length === 0) {
        addLog({ message: 'Refactor the project first to see the result.', type: 'warning' });
        return;
    }
    viewRefactoredBtn.classList.add('active');
    viewOriginalBtn.classList.remove('active');
    currentPreviewMode = 'refactored';
    updatePreview();
});

previewPageSelect.addEventListener('change', updatePreview);

// Enhanced File Handler with ZIP Support
async function handleFile(fileOrFiles) {
    // Normalize input: support FileList, Array<File>, or single File
    const files = (fileOrFiles instanceof FileList || Array.isArray(fileOrFiles))
        ? Array.from(fileOrFiles)
        : [fileOrFiles];
    
    currentProjectFiles = [];
    refactoredProjectFiles = [];
    previewPageSelect.innerHTML = '';
    
    addLog({ message: `Processing input...`, type: 'info' });

    const processedFiles = [];

    // 1. Expand ZIPs and collect all files
    for (const file of files) {
        const fileType = file.type || '';
        
        // Check for ZIP (by extension or mime)
        if (file.name.endsWith('.zip') || fileType.includes('zip')) {
            try {
                addLog({ message: `Unzipping ${file.name}...`, type: 'info' });
                const zip = await JSZip.loadAsync(file);
                
                // Collect entries
                const entries = [];
                zip.forEach((relativePath, zipEntry) => {
                    if (!zipEntry.dir && !relativePath.startsWith('__MACOSX')) {
                        entries.push({ path: relativePath, entry: zipEntry });
                    }
                });

                // Extract blobs
                for (const { path, entry } of entries) {
                    const blob = await entry.async('blob');
                    processedFiles.push({
                        name: path,
                        blob: blob
                    });
                }
            } catch (e) {
                addLog({ message: `Failed to unzip ${file.name}: ${e.message}`, type: 'error' });
            }
        } else {
            // Regular file
            processedFiles.push({
                name: file.webkitRelativePath || file.name,
                blob: file
            });
        }
    }

    if (processedFiles.length === 0) {
        addLog({ message: 'No valid files found.', type: 'warning' });
        return;
    }

    addLog({ message: `Loading ${processedFiles.length} files...`, type: 'info' });
    
    // 2. Read content
    for (const pFile of processedFiles) {
        const name = pFile.name;
        const ext = name.split('.').pop().toLowerCase();
        // Robust binary check by extension (safer for unzipped blobs)
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'woff', 'woff2', 'ttf', 'eot'].includes(ext);
        
        let content;
        if (isImage) {
            content = await readFileAsDataURL(pFile.blob);
        } else {
            content = await readFileAsText(pFile.blob);
        }

        currentProjectFiles.push({
            name: name,
            content: content,
            fileObject: pFile.blob, // Keep blob for preview iframe
            isBinary: isImage
        });
    }

    // NORMALIZE PATHS: Detect root folder (if dragged folder)
    const htmlFile = currentProjectFiles.find(f => f.name && (f.name.toLowerCase().endsWith('index.html') || f.name.endsWith('.html')));
    
    if (htmlFile && htmlFile.name.includes('/')) {
        const rootDir = htmlFile.name.substring(0, htmlFile.name.lastIndexOf('/') + 1);
        
        // Strip rootDir from all files if they start with it
        currentProjectFiles.forEach(f => {
            if (f.name && f.name.startsWith(rootDir)) {
                f.name = f.name.substring(rootDir.length);
            }
        });
        
        // Remove empty filenames that might result from stripping rootDir (e.g. the dir entry itself)
        currentProjectFiles = currentProjectFiles.filter(f => f.name && f.name.trim().length > 0);

        addLog({ message: `Detected project root: ${rootDir}. Paths normalized.`, type: 'info' });
    }

    // Re-populate Dropdown for HTML (after normalization)
    previewPageSelect.innerHTML = '';
    let htmlFound = false;
    currentProjectFiles.forEach(f => {
        if (f.name.endsWith('.html')) {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.textContent = f.name;
            previewPageSelect.appendChild(opt);
            
            if (f.name.toLowerCase() === 'index.html' || !previewPageSelect.value) {
                previewPageSelect.value = f.name;
            }
            htmlFound = true;
        }
    });

    finalizeUpload();
}

function readFileAsText(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(blob);
    });
}

function readFileAsDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function finalizeUpload() {
    fileNameDisplay.textContent = `${currentProjectFiles.length} file(s) loaded`;
    addLog({ message: 'All files loaded. Ready to refactor.', type: 'success' });
    
    // Sort files so index.html is first
    currentProjectFiles.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        if (nameA === 'index.html') return -1;
        if (nameB === 'index.html') return 1;
        return nameA.localeCompare(nameB);
    });

    // Load the first HTML file content into the editor
    const mainHtml = currentProjectFiles.find(f => f.name.endsWith('.html'));
    if (mainHtml) {
        htmlInput.value = mainHtml.content;
        addLog({ message: `Loaded ${mainHtml.name} into editor.`, type: 'info' });
        // Trigger preview
        document.querySelector('[data-tab="preview"]').click();
        updatePreview();
    } else {
        addLog({ message: 'No HTML file found in upload.', type: 'warning' });
    }
}

// Preview Logic
async function updatePreview() {
    const mode = currentPreviewMode;
    const files = mode === 'original' ? currentProjectFiles : refactoredProjectFiles;
    const selectedPage = previewPageSelect.value || (files.find(f => f.name.endsWith('.html'))?.name);

    if (!files.length || !selectedPage) return;

    const blobMap = new Map();

    // 1. Create Blobs for all assets
    for (const file of files) {
        // Skip invalid files
        if (!file.name) continue;

        let blob;
        if (file.fileObject) {
            blob = file.fileObject;
        } else if (file.isBinary) {
             // Handle dataURL
             const fetchRes = await fetch(file.content);
             blob = await fetchRes.blob();
        } else {
            // Text content
            blob = new Blob([file.content], { type: getMimeType(file.name) });
        }
        blobMap.set(file.name, URL.createObjectURL(blob));
    }

    // 2. Process the HTML to inject these Blobs
    const targetFile = files.find(f => f.name === selectedPage);
    if (!targetFile) return;

    let htmlContent = targetFile.content; 
    
    // Sort keys by length desc to avoid partial matches
    // Filter out undefined/empty keys
    const paths = Array.from(blobMap.keys()).filter(k => !!k).sort((a, b) => b.length - a.length);
    
    paths.forEach(path => {
        if (path === selectedPage) return;

        // CRITICAL FIX: Skip files without extension to prevent accidental replacement 
        // of common words, variables, or protocols (e.g. 'http' matching 'https://')
        if (path.indexOf('.') === -1) return;

        const blobUrl = blobMap.get(path);
        
        // Escape path for Regex
        const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Robust Regex:
        // Group 1: Preceding delimiter (quote, paren, space, =, or start)
        // Group 2: Optional path prefix (./ or /) - WE DISCARD THIS
        // Path matches
        // Group 3: Following delimiter (quote, paren, space, ?, #, or end)
        const regex = new RegExp(`([\\s"\'\\(=]|^)(\\.?\\/)?` + escapedPath + `([\\s"\'\\)\\?#]|$)`, 'g');
        
        htmlContent = htmlContent.replace(regex, (match, p1, p2, p3) => {
            return `${p1}${blobUrl}${p3}`;
        });
    });

    const previewBlob = new Blob([htmlContent], { type: 'text/html' });
    previewFrame.src = URL.createObjectURL(previewBlob);
}

function getMimeType(filename) {
    if (filename.endsWith('.css')) return 'text/css';
    if (filename.endsWith('.js')) return 'text/javascript';
    if (filename.endsWith('.html')) return 'text/html';
    if (filename.endsWith('.json')) return 'application/json';
    return 'text/plain';
}

// File Upload Listeners
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
    if (e.dataTransfer.items) {
        const files = [];
        // Extract files from DataTransfer
        for(let i=0; i<e.dataTransfer.files.length; i++) {
            files.push(e.dataTransfer.files[i]);
        }
        handleFile(files);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFile(e.target.files);
    }
});

// Main Refactor Logic
refactorBtn.addEventListener('click', async () => {
    // If user edited text area, update the corresponding file in currentProjectFiles
    const mainHtmlName = previewPageSelect.value || currentProjectFiles.find(f => f.name.endsWith('.html'))?.name;
    if (mainHtmlName) {
        const fileIdx = currentProjectFiles.findIndex(f => f.name === mainHtmlName);
        if (fileIdx !== -1) {
            currentProjectFiles[fileIdx].content = htmlInput.value;
            currentProjectFiles[fileIdx].fileObject = null; // Invalidate binary
        }
    } else if (htmlInput.value.trim() && currentProjectFiles.length === 0) {
        // User pasted code without file
        currentProjectFiles.push({
            name: 'index.html',
            content: htmlInput.value,
            isBinary: false
        });
    }

    if (currentProjectFiles.length === 0) {
        addLog({ message: 'Error: Input is empty. Paste HTML or upload files.', type: 'error' });
        return;
    }

    // Reset Logs
    logContainer.innerHTML = '';
    addLog({ message: 'Starting Refactor Process...', type: 'info' });
    document.querySelector('[data-tab="logs"]').click();

    try {
        const engine = new RefactorEngine(addLog);
        const options = {
            mergeCss: mergeCssCheck.checked,
            mergeJs: mergeJsCheck.checked,
            extremeMode: extremeModeCheck.checked,
            aiSplit: aiSplitCheck.checked
        };

        // NEW: Process Project
        refactoredProjectFiles = [];
        
        const htmlFiles = currentProjectFiles.filter(f => f.name.endsWith('.html'));
        const assetFiles = currentProjectFiles.filter(f => !f.name.endsWith('.html'));
        
        // Pass assets through
        refactoredProjectFiles = [...assetFiles];

        for (const htmlFile of htmlFiles) {
            addLog({ message: `Processing ${htmlFile.name}...`, type: 'info' });
            
            // Avoid filename collision for extracted assets if multiple HTMLs
            if (htmlFiles.length > 1) {
                options.filenamePrefix = htmlFile.name.replace('.html', '');
            } else {
                options.filenamePrefix = '';
            }
            
            const result = await engine.process(htmlFile.content, options);
            
            // Add transformed HTML
            refactoredProjectFiles.push({
                name: htmlFile.name,
                content: result.html,
                isBinary: false
            });

            // Add extracted files
            result.files.forEach(f => {
                refactoredProjectFiles.push({
                    name: f.name,
                    content: f.content,
                    isBinary: false
                });
            });
        }

        addLog({ message: 'Project refactoring complete.', type: 'success' });

        // Update preview list
        updateFileList(refactoredProjectFiles);
        
        // Auto-switch to Refactored Preview
        viewRefactoredBtn.click();
        document.querySelector('[data-tab="preview"]').click();

        // Prepare ZIP
        addLog({ message: 'Packaging files into ZIP...', type: 'info' });
        const zip = new JSZip();

        refactoredProjectFiles.forEach(f => {
            if (f.isBinary && typeof f.content === 'string' && f.content.startsWith('data:')) {
                 // Convert data URL to blob/uint8array for zip
                 const data = f.content.split(',')[1];
                 zip.file(f.name, data, {base64: true});
            } else {
                 zip.file(f.name, f.content);
            }
        });

        // Generate and Download
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "refactored-project.zip");

        addLog({ message: 'Success! Download started.', type: 'success' });

    } catch (error) {
        console.error(error);
        addLog({ message: `Critical Error: ${error.message}`, type: 'error' });
    }
});