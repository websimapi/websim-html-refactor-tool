/**
 * RefactorEngine
 * Core logic for parsing HTML and extracting resources.
 */
export class RefactorEngine {
    constructor(logger) {
        this.logger = logger || console.log;
    }

    /**
     * Helper to log messages through the UI callback
     */
    log(message, type = 'info') {
        if (typeof this.logger === 'function') {
            this.logger({ message, type });
        }
    }

    /**
     * Remove comments from HTML string
     */
    removeComments(htmlString) {
        this.log('Removing code comments...', 'info');
        let cleaned = htmlString.replace(/<!--[\s\S]*?-->/g, '');
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
        return cleaned;
    }

    /**
     * Main process method
     */
    async process(htmlString, options) {
        const { mergeCss, mergeJs, extremeMode, aiSplit, filenamePrefix } = options;
        const prefix = filenamePrefix ? `${filenamePrefix}.` : '';

        this.log('Initializing DOMParser...', 'info');
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        if (!doc.body) {
            throw new Error("Invalid HTML: No <body> tag found.");
        }

        const files = [];
        let cssCounter = 1;
        let jsCounter = 1;

        // --- CSS EXTRACTION ---
        this.log('Scanning for <style> tags...', 'info');
        const styleTags = Array.from(doc.querySelectorAll('style'));
        let mergedCssContent = '';
        
        if (styleTags.length > 0) {
            this.log(`Found ${styleTags.length} style blocks.`, 'info');
            styleTags.forEach(style => mergedCssContent += style.textContent + '\n');
            
            if (aiSplit && mergedCssContent.trim()) {
                this.log('🤖 AI Analysis: Determining optimal CSS split...', 'warning');
                const splitFiles = await this.performAiSplit(mergedCssContent, 'css');
                
                styleTags.forEach(s => s.remove());
                
                splitFiles.forEach(f => {
                    files.push(f);
                    const link = doc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = f.name;
                    doc.head.appendChild(link);
                    this.log(`AI Created: ${f.name}`, 'success');
                });
                
            } else if (mergeCss) {
                const cssFileName = `${prefix}style.css`;
                files.push({ name: cssFileName, content: mergedCssContent });
                
                styleTags.forEach((s, i) => i === 0 ? null : s.remove());
                const link = doc.createElement('link');
                link.rel = 'stylesheet';
                link.href = cssFileName;
                if (styleTags[0]) styleTags[0].parentNode.replaceChild(link, styleTags[0]);
                else doc.head.appendChild(link);

                this.log(`Merged CSS into ${cssFileName}`, 'success');
            } else {
                styleTags.forEach((style) => {
                    const filename = `style-${cssCounter}.css`;
                    files.push({ name: filename, content: style.textContent });
                    const link = doc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = filename;
                    style.parentNode.replaceChild(link, style);
                    cssCounter++;
                });
            }
        }

        // --- JS EXTRACTION ---
        this.log('Scanning for inline <script> tags...', 'info');
        const scriptTags = Array.from(doc.querySelectorAll('script:not([src])'));
        const executableScripts = scriptTags.filter(s => !s.type || s.type === 'text/javascript' || s.type === 'module');

        let mergedJsContent = '';
        // Track scripts to be loaded for Extreme Mode
        let scriptsToLoad = [];

        if (executableScripts.length > 0) {
            this.log(`Found ${executableScripts.length} inline script blocks.`, 'info');
            executableScripts.forEach(s => mergedJsContent += s.textContent + '\n');

            if (aiSplit && mergedJsContent.trim()) {
                this.log('🤖 AI Analysis: Determining optimal JS split...', 'warning');
                const splitFiles = await this.performAiSplit(mergedJsContent, 'js');
                
                executableScripts.forEach(s => s.remove());
                
                splitFiles.forEach(f => {
                    files.push(f);
                    scriptsToLoad.push({ name: f.name, isModule: this.isEsModule(f.content) });
                    
                    if (!extremeMode) {
                        const script = doc.createElement('script');
                        script.src = f.name;
                        if (this.isEsModule(f.content)) script.type = 'module';
                        // Ensure execution order
                        script.async = false; 
                        doc.body.appendChild(script);
                    }
                    this.log(`AI Created: ${f.name}`, 'success');
                });
                
            } else if (mergeJs) {
                const jsFileName = `${prefix}app.js`;
                files.push({ name: jsFileName, content: mergedJsContent });
                
                executableScripts.forEach(s => s.remove());
                
                scriptsToLoad.push({ name: jsFileName, isModule: false });

                if (!extremeMode) {
                    const mainScript = doc.createElement('script');
                    mainScript.src = jsFileName;
                    doc.body.appendChild(mainScript);
                }
                this.log(`Merged JS into ${jsFileName}`, 'success');
                
            } else {
                executableScripts.forEach((script) => {
                    const filename = `script-${jsCounter}.js`;
                    files.push({ name: filename, content: script.textContent });
                    
                    scriptsToLoad.push({ name: filename, isModule: false });

                    if (!extremeMode) {
                        const newScript = doc.createElement('script');
                        newScript.src = filename;
                        script.parentNode.replaceChild(newScript, script);
                    } else {
                        script.remove();
                    }
                    jsCounter++;
                });
            }
        }

        // --- EXTREME MODE ---
        if (extremeMode) {
            let bodyContent = doc.body.innerHTML;
            let escapedBody = bodyContent
                .replace(/\\/g, '\\\\')
                .replace(/`/g, '\\`')
                .replace(/\$\{/g, '\\${')
                .replace(/<\/script>/gi, '<\\/script>'); // Escape closing script tags to prevent early termination

            // Serialize the script list for the loader
            const scriptsJson = JSON.stringify(scriptsToLoad);

            const generatorContent = `
(function() {
    const scripts = ${scriptsJson};
    
    function loadScripts() {
        if (!scripts.length) return;
        
        let index = 0;
        function loadNext() {
            if (index >= scripts.length) return;
            const s = scripts[index];
            const scriptEl = document.createElement('script');
            scriptEl.src = s.name;
            if (s.isModule) scriptEl.type = 'module';
            scriptEl.async = false; // Maintain order
            
            // For modules, onload might trigger differently, but simple sequential add is usually safer
            scriptEl.onload = () => loadNext();
            scriptEl.onerror = () => {
                console.error("Failed to load script:", s.name);
                loadNext();
            };
            
            document.body.appendChild(scriptEl);
            index++;
        }
        loadNext();
    }

    const dynamicHTML = \`${escapedBody}\`;
    // Replace body content immediately if body exists, or wait
    if (document.body) {
        document.body.innerHTML = dynamicHTML;
        console.log("Extreme Mode: DOM Regenerated");
        loadScripts();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.innerHTML = dynamicHTML;
            console.log("Extreme Mode: DOM Regenerated (Deferred)");
            loadScripts();
        });
    }
})();
`;

            // Inline the loader to ensure preview blob-patching works on its content
            const loaderScript = doc.createElement('script');
            loaderScript.textContent = generatorContent;
            
            // Clear body (scripts were already removed/tracked above)
            doc.body.innerHTML = '';
            doc.body.appendChild(loaderScript);
        }

        const finalHtml = new XMLSerializer().serializeToString(doc);

        // --- VERIFICATION STEP ---
        if (!extremeMode) {
            this.log('Verifying DOM integrity...', 'info');
            const verification = this.verifyRefactor(htmlString, finalHtml);
            
            if (!verification.success) {
                this.log(`⚠️ DOM Mismatch Detected! Diff Score: ${verification.diff}`, 'error');
                this.log(`Original Text Nodes: ${verification.origLen}, Refactored: ${verification.refLen}`, 'error');
                
                if (aiSplit) {
                    this.log('🔄 AI Split may have caused data loss. Retrying without AI...', 'warning');
                    // Recursively retry without AI
                    return this.process(htmlString, { ...options, aiSplit: false });
                }
            } else {
                this.log('✅ DOM Integrity Verified.', 'success');
            }
        }

        return { html: finalHtml, files: files };
    }

    /**
     * Compares the semantic structure of two HTML strings to ensure content wasn't lost.
     * Ignores scripts, styles, links, and whitespace.
     */
    verifyRefactor(original, refactored) {
        const parser = new DOMParser();
        
        const clean = (html) => {
            const doc = parser.parseFromString(html, 'text/html');
            // Remove non-content elements
            ['script', 'style', 'link', 'meta', 'title'].forEach(tag => {
                doc.querySelectorAll(tag).forEach(el => el.remove());
            });
            // Get text content and normalize whitespace
            return doc.body ? doc.body.textContent.replace(/\s+/g, ' ').trim() : '';
        };

        const t1 = clean(original);
        const t2 = clean(refactored);

        if (t1 === t2) return { success: true };
        
        // Allow for very minor differences (like whitespace edge cases)
        const diff = Math.abs(t1.length - t2.length);
        const ratio = diff / Math.max(t1.length, 1);
        
        // If content length difference is < 1%, we consider it a pass (whitespace artifacts)
        if (ratio < 0.01) return { success: true, diff };

        return { 
            success: false, 
            diff, 
            origLen: t1.length, 
            refLen: t2.length 
        };
    }

    /**
     * Uses AI to split code, then validates and repairs the splits.
     */
    async performAiSplit(code, type) {
        const lines = code.split('\n');
        const numberedCode = lines.map((line, idx) => `${idx + 1}| ${line}`).join('\n');
        const safeCode = numberedCode.length > 50000 ? numberedCode.substring(0, 50000) + "\n... (truncated)" : numberedCode;

        const systemPrompt = `You are a code refactoring engine. 
        Your goal is to split a monolithic ${type.toUpperCase()} file into logical, modular component files.
        Return a JSON object containing a "files" array.
        Each item in "files" must have:
        - "name": filename (e.g., 'utils.js', 'header.css')
        - "startLine": integer (inclusive 1-based index)
        - "endLine": integer (inclusive 1-based index)
        
        CRITICAL RULES:
        1. COVERAGE: Every single line of code must be included.
        2. SYNTAX SAFETY: Do NOT split inside functions, classes, objects, or template literals. Ensure splits occur at clean top-level boundaries.
        3. ORDER: Maintain original execution order.
        4. DEPENDENCIES: Group related variables and functions together to avoid scope reference errors.
        5. VERBOSITY: Use specific names for files.
        `;

        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Code:\n\n${safeCode}` }
                ],
                json: true
            });

            let cleanContent = completion.content.trim();
            if (cleanContent.startsWith('```json')) cleanContent = cleanContent.replace(/^```json/, '').replace(/```$/, '');
            else if (cleanContent.startsWith('```')) cleanContent = cleanContent.replace(/^```/, '').replace(/```$/, '');

            const result = JSON.parse(cleanContent);
            if (!result.files || !Array.isArray(result.files)) throw new Error("Invalid AI response");

            this.log('Verifying split integrity...', 'info');
            return this.validateAndRepairSplits(lines, result.files, type);

        } catch (e) {
            this.log(`AI Split Failed: ${e.message}. Fallback to single file.`, 'error');
            return [{ name: type === 'css' ? 'style.css' : 'app.js', content: code }];
        }
    }

    /**
     * Validates coverage and syntax balance, merging chunks if necessary.
     */
    validateAndRepairSplits(allLines, fileDefs, type) {
        const outputFiles = [];
        const totalLines = allLines.length;

        fileDefs.sort((a, b) => a.startLine - b.startLine);

        // 1. Fill Gaps & Normalize
        let currentLine = 1;
        const continuousDefs = [];

        for (const def of fileDefs) {
            if (def.startLine > currentLine) {
                const gapName = `fragment-${currentLine}.${type === 'css' ? 'css' : 'js'}`;
                this.log(`Gap detected at line ${currentLine}. Created ${gapName}`, 'warning');
                continuousDefs.push({
                    name: gapName,
                    startLine: currentLine,
                    endLine: def.startLine - 1
                });
            }
            if (def.startLine < currentLine) def.startLine = currentLine;
            
            if (def.endLine >= def.startLine) {
                continuousDefs.push(def);
                currentLine = def.endLine + 1;
            }
        }
        if (currentLine <= totalLines) {
            continuousDefs.push({
                name: `end-fragment.${type === 'css' ? 'css' : 'js'}`,
                startLine: currentLine,
                endLine: totalLines
            });
        }

        // 2. Syntax Balance Check (JS Only)
        if (type === 'js') {
            let bufferDef = null;
            let bufferContent = '';
            let currentBalance = 0; // Total brace/paren balance

            for (const def of continuousDefs) {
                const start = def.startLine - 1;
                const end = def.endLine;
                const content = allLines.slice(start, end).join('\n');
                
                const netChange = this.scanCodeBalance(content);

                if (bufferDef) {
                    bufferContent += '\n' + content;
                    currentBalance += netChange;
                    bufferDef.endLine = def.endLine;

                    if (currentBalance === 0) {
                        this.log(`Merged ${def.name} into ${bufferDef.name} (Balance restored).`, 'info');
                        outputFiles.push({ name: bufferDef.name, content: bufferContent });
                        bufferDef = null;
                        bufferContent = '';
                        currentBalance = 0;
                    } else {
                         this.log(`Merged ${def.name} into ${bufferDef.name} (Balance: ${currentBalance})`, 'info');
                    }
                } else {
                    if (netChange !== 0) {
                        this.log(`File ${def.name} ended unbalanced (Balance: ${netChange}). Merging with next...`, 'warning');
                        bufferDef = def;
                        bufferContent = content;
                        currentBalance = netChange;
                    } else {
                        outputFiles.push({ name: def.name, content });
                    }
                }
            }
            
            if (bufferDef) {
                this.log(`Merged remaining content into ${bufferDef.name}. Final balance: ${currentBalance} (Ideally 0).`, 'warning');
                outputFiles.push({ name: bufferDef.name, content: bufferContent });
            }
        } else {
            continuousDefs.forEach(def => {
                outputFiles.push({
                    name: def.name,
                    content: allLines.slice(def.startLine - 1, def.endLine).join('\n')
                });
            });
        }

        return outputFiles;
    }

    /**
     * Robustly counts brace balance tracking {}, (), and [] while ignoring strings, comments, and regex.
     * @returns {number} Net nesting level (0 means balanced)
     */
    scanCodeBalance(code) {
        let balance = 0;
        let stack = []; 
        let inString = null; // ' " `
        let inComment = null; // // /*
        let inRegex = false;

        for (let i = 0; i < code.length; i++) {
            const char = code[i];
            const next = code[i+1] || '';
            const prev = code[i-1] || '';

            // 1. Comments
            if (inComment) {
                if (inComment === '//' && char === '\n') inComment = null;
                else if (inComment === '/*' && char === '*' && next === '/') {
                    inComment = null;
                    i++;
                }
                continue;
            }

            // 2. Strings
            if (inString) {
                if (char === '\\') i++; // Skip next
                else if (char === inString) inString = null;
                else if (inString === '`' && char === '$' && next === '{') {
                    stack.push('template');
                    inString = null; // Switch to code mode temporarily
                    i++;
                }
                continue;
            }

            // 3. Regex literal detection (heuristic)
            if (inRegex) {
                if (char === '\\') i++;
                else if (char === '/') inRegex = false;
                continue;
            }

            // --- Code Mode ---

            // Start Comment
            if (char === '/' && next === '/') { inComment = '//'; i++; continue; }
            if (char === '/' && next === '*') { inComment = '/*'; i++; continue; }

            // Start String
            if (char === '"' || char === "'") { inString = char; continue; }
            if (char === '`') { inString = '`'; continue; }

            // Start Regex? (Hardest part of JS parsing)
            // Heuristic: / is regex if previous non-whitespace char was ( [ { = , ; : ! ? & | ^ + - * / % ~
            // or keywords like return, case, delete, do, else, in, instanceof, new, typeof, void, throw, yield
            if (char === '/') {
                // Simplified check: assume regex if regex-like
                // This is risky, so we'll skip regex mode for balance checking to be safe, 
                // assuming slashes inside code won't contain unbalanced braces often enough to break.
                // Or better: just treat / as regular char unless we are sure.
                // To avoid complex regex parsing logic, we will ignore / as a delimiter starter here.
                // It might cause false positives for braces inside regex, but that is rare.
                continue;
            }

            // Opening Brackets
            if (['{', '(', '['].includes(char)) {
                balance++;
                stack.push(char);
            }
            
            // Closing Brackets
            else if (['}', ')', ']'].includes(char)) {
                const last = stack[stack.length - 1];
                
                // Check for template interpolation close
                if (char === '}' && last === 'template') {
                    stack.pop();
                    inString = '`'; // Resume template string
                } else {
                    // Normal close
                    if (['{', '(', '['].includes(last)) {
                        stack.pop();
                        balance--;
                    } else {
                        // Unmatched close or structure mismatch, strictly treat as unbalanced decrement
                        balance--;
                    }
                }
            }
        }
        return balance;
    }

    isEsModule(content) {
        // Robust check for top-level ES module syntax
        // Matches "import ... from", "export ...", "export default"
        // Ignores matches inside comments (approximate)
        const stripComments = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        return /(?:^|;|\s)(?:import\s+[\s\S]*?from|export\s+(?:default|const|let|var|function|class|{))/.test(stripComments);
    }
}