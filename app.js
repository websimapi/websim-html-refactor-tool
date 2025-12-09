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
    // Prevent switching if no original project is loaded
    if (!currentProjectFiles.length) {
        addLog({ message: 'No original project in memory. Upload files or paste HTML first.', type: 'warning' });
        return;
    }

    // Explicitly handle state to ensure we can switch back
    if (viewOriginalBtn.classList.contains('active')) return;

    addLog({ message: 'Switching to Original View...', type: 'info' });
    console.log('[Diagnostics] Parent: Switching preview to ORIGINAL mode');

    viewOriginalBtn.classList.add('active');
    viewRefactoredBtn.classList.remove('active');
    
    currentPreviewMode = 'original';
    
    // Force refresh the selection logic
    refreshPageSelect();
    
    // Slight delay to allow UI to settle if needed, but synchronous update is usually better
    updatePreview();
});

viewRefactoredBtn.addEventListener('click', () => {
    if (refactoredProjectFiles.length === 0) {
        addLog({ message: 'Refactor the project first to see the result.', type: 'warning' });
        return;
    }
    
    if (viewRefactoredBtn.classList.contains('active')) return;

    addLog({ message: 'Switching to Refactored View...', type: 'info' });
    console.log('[Diagnostics] Parent: Switching preview to REFACTORED mode');

    viewRefactoredBtn.classList.add('active');
    viewOriginalBtn.classList.remove('active');
    currentPreviewMode = 'refactored';
    refreshPageSelect();
    updatePreview();
});

function refreshPageSelect() {
    const mode = currentPreviewMode;
    const files = mode === 'original' ? currentProjectFiles : refactoredProjectFiles;
    
    // Preserve current selection if possible
    const currentSelection = previewPageSelect.value;
    
    previewPageSelect.innerHTML = '';
    let foundHtml = false;
    let foundSelection = false;

    files.forEach(f => {
        if (f.name.endsWith('.html')) {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.textContent = f.name;
            previewPageSelect.appendChild(opt);
            foundHtml = true;
            if (f.name === currentSelection) foundSelection = true;
        }
    });

    if (foundSelection) {
        previewPageSelect.value = currentSelection;
    } else if (foundHtml) {
        // Default to first
        previewPageSelect.selectedIndex = 0;
    }
}

previewPageSelect.addEventListener('change', updatePreview);

// Enhanced File Handler with ZIP Support
async function handleFile(fileOrFiles) {
    // Normalize input
    const files = (fileOrFiles instanceof FileList || Array.isArray(fileOrFiles))
        ? Array.from(fileOrFiles)
        : [fileOrFiles];
    
    currentProjectFiles = [];
    refactoredProjectFiles = [];
    previewPageSelect.innerHTML = '';
    
    addLog({ message: `Processing ${files.length} items...`, type: 'info' });

    const processedFiles = [];

    // 1. Expand ZIPs and collect all files
    for (const file of files) {
        if (!file || !file.name) continue; // Skip invalid
        
        const fileName = file.name.toLowerCase();
        const fileType = (file.type || '').toLowerCase();
        
        // Check for ZIP
        if (fileName.endsWith('.zip') || fileType.includes('zip') || fileType.includes('compressed')) {
            try {
                addLog({ message: `Unzipping ${file.name}...`, type: 'info' });
                const zip = await JSZip.loadAsync(file);
                
                // Collect entries
                const entries = [];
                zip.forEach((relativePath, zipEntry) => {
                    // Filter junk
                    if (!zipEntry.dir && !relativePath.startsWith('__MACOSX') && !relativePath.includes('/.')) {
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
            // Check for custom filepath from drag-drop traversal
            let path = file.filepath || file.webkitRelativePath || file.name;
            
            // Clean path if it starts with /
            if (path && path.startsWith('/')) path = path.substring(1);
            
            processedFiles.push({
                name: path,
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
        const name = pFile.name || 'unknown-file';
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
        
        if (rootDir.length > 0) {
            // Strip rootDir from all files if they start with it
            currentProjectFiles.forEach(f => {
                if (f.name && typeof f.name === 'string' && f.name.startsWith(rootDir)) {
                    f.name = f.name.substring(rootDir.length);
                }
            });
            
            // Remove empty filenames
            currentProjectFiles = currentProjectFiles.filter(f => f.name && f.name.trim().length > 0);
            addLog({ message: `Detected project root: ${rootDir}. Paths normalized.`, type: 'info' });
        }
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

    console.log('[Diagnostics] Parent: updatePreview called', { mode, selectedPage, fileCount: files.length });

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
        const url = URL.createObjectURL(blob);
        blobMap.set(file.name, url);
        console.log('[Diagnostics] Parent: Blob created', { mode, name: file.name, url });
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
        const regex = new RegExp(`([\\s"'\\(=]|^)(\\.?\\/)?` + escapedPath + `([\\s"'\\)\\?#]|$)`, 'g');
        
        const before = htmlContent;
        htmlContent = htmlContent.replace(regex, (match, p1, p2, p3) => {
            return `${p1}${blobUrl}${p3}`;
        });
        if (before !== htmlContent) {
            console.log('[Diagnostics] Parent: Rewrote asset path', { mode, path, blobUrl });
        }
    });

    // Inject Diagnostics Script with mode-aware logging
    const diagnosticsScript = `
    <script>
    (function() {
        var MODE = "${mode}";
        console.log("[Diagnostics] Iframe: Preview mode =", MODE);

        // Capture Runtime Errors
        window.onerror = function(msg, url, line, col, error) {
            console.log("[Diagnostics] Iframe: window.onerror fired", msg, url, line, col);
            window.parent.postMessage({ 
                type: 'preview-error', 
                data: { message: msg, line: line, col: col, source: url, mode: MODE } 
            }, '*');
        };
        // Capture Promise Rejections
        window.addEventListener('unhandledrejection', function(event) {
            console.log("[Diagnostics] Iframe: unhandledrejection", event.reason);
            window.parent.postMessage({ 
                type: 'preview-error', 
                data: { message: 'Unhandled Promise Rejection: ' + event.reason, mode: MODE } 
            }, '*');
        });

        window.addEventListener('DOMContentLoaded', function() {
            var domLength = document.body ? document.body.innerHTML.length : 0;
            var textContent = document.body ? (document.body.textContent || "").replace(/\\s+/g, " ").trim() : "";
            var textLength = textContent.length;
            console.log("[Diagnostics] Iframe: DOM snapshot", { mode: MODE, domLength: domLength, textLength: textLength });
            window.parent.postMessage({
                type: 'preview-dom',
                data: {
                    mode: MODE,
                    domLength: domLength,
                    textLength: textLength
                }
            }, '*');
        });

        console.log("Diagnostics Active (" + MODE + ")");
    })();
    <\\/script>
    `;
    
    // Insert before closing head or body
    if (htmlContent.includes('</head>')) {
        htmlContent = htmlContent.replace('</head>', diagnosticsScript + '</head>');
    } else {
        htmlContent += diagnosticsScript;
    }

    const previewBlob = new Blob([htmlContent], { type: 'text/html' });
    const finalUrl = URL.createObjectURL(previewBlob);
    console.log('[Diagnostics] Parent: Setting iframe src', { mode, url: finalUrl });

    previewFrame.src = finalUrl;
}

// Diagnostics Listener
window.addEventListener('message', (event) => {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'preview-error') {
        const { message, line, source, mode } = event.data.data;
        addLog({ 
            message: `⚠️ Runtime Error${mode ? ' [' + mode + ']' : ''}: ${message} ${line ? `(Line ${line})` : ''}`, 
            type: 'error' 
        });
        console.log('[Diagnostics] Parent: preview-error', event.data.data);
    } else if (event.data.type === 'preview-dom') {
        const { mode, domLength, textLength } = event.data.data;
        addLog({ 
            message: `DOM Snapshot [${mode}] - innerHTML length: ${domLength}, text length: ${textLength}`, 
            type: 'info' 
        });
        console.log('[Diagnostics] Parent: preview-dom snapshot', event.data.data);
    }
});

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

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const items = e.dataTransfer.items;
    if (!items) return;

    addLog({ message: 'Scanning dropped files...', type: 'info' });

    // Robust Directory Traversal
    const traverseFileTree = (item, path = '') => {
        return new Promise((resolve) => {
            if (item.isFile) {
                item.file(file => {
                    // Attach full path for project structure preservation
                    // If path is empty, it's a root file.
                    file.filepath = path + file.name; 
                    resolve([file]);
                }, (err) => {
                    console.warn('Failed to read file entry:', err);
                    resolve([]);
                });
            } else if (item.isDirectory) {
                const dirReader = item.createReader();
                const entries = [];
                
                const readEntries = () => {
                    dirReader.readEntries(async (batch) => {
                        if (!batch.length) {
                            resolve(entries);
                        } else {
                            const promises = batch.map(entry => traverseFileTree(entry, path + item.name + '/'));
                            const results = await Promise.all(promises);
                            entries.push(...results.flat());
                            readEntries(); // Recursive read for next batch
                        }
                    }, (err) => {
                        console.warn('Failed to read directory:', err);
                        resolve(entries); // Return partial results
                    });
                };
                readEntries();
            } else {
                resolve([]);
            }
        });
    };

    const processingQueue = [];
    const directFiles = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item.getAsEntry ? item.getAsEntry() : null);

        if (entry) {
            processingQueue.push(traverseFileTree(entry));
        } else if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) directFiles.push(file);
        }
    }

    try {
        const results = await Promise.all(processingQueue);
        const allFiles = results.flat().concat(directFiles);
        
        if (allFiles.length > 0) {
            await handleFile(allFiles);
        } else {
            addLog({ message: 'No accessible files found in drop.', type: 'warning' });
        }
    } catch (err) {
        console.error(err);
        addLog({ message: 'Error processing files: ' + err.message, type: 'error' });
    }
});

// Global drag prevention to stop browser opening files if missed
window.addEventListener('dragover', (e) => e.preventDefault(), false);
window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dropZone.contains(e.target)) {
        addLog({ message: '⚠️ Ignored drop outside the upload area.', type: 'warning' });
    }
}, false);

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
            // Update content but preserve original blob reference if meaningful? 
            // Actually, if we edit text, the blob is stale.
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
        
        // Pass assets through safely (clone objects to prevent shared reference mutations)
        refactoredProjectFiles = assetFiles.map(f => ({ ...f }));

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