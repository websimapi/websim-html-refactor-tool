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

        if (executableScripts.length > 0) {
            this.log(`Found ${executableScripts.length} inline script blocks.`, 'info');
            executableScripts.forEach(s => mergedJsContent += s.textContent + '\n');

            if (aiSplit && mergedJsContent.trim()) {
                this.log('🤖 AI Analysis: Determining optimal JS split...', 'warning');
                const splitFiles = await this.performAiSplit(mergedJsContent, 'js');
                
                executableScripts.forEach(s => s.remove());
                
                splitFiles.forEach(f => {
                    files.push(f);
                    const script = doc.createElement('script');
                    script.src = f.name;
                    if (this.isEsModule(f.content)) script.type = 'module';
                    doc.body.appendChild(script);
                    this.log(`AI Created: ${f.name}`, 'success');
                });
                
            } else if (mergeJs) {
                const jsFileName = `${prefix}app.js`;
                files.push({ name: jsFileName, content: mergedJsContent });
                
                executableScripts.forEach(s => s.remove());
                const mainScript = doc.createElement('script');
                mainScript.src = jsFileName;
                doc.body.appendChild(mainScript);
                this.log(`Merged JS into ${jsFileName}`, 'success');
                
            } else {
                executableScripts.forEach((script) => {
                    const filename = `script-${jsCounter}.js`;
                    files.push({ name: filename, content: script.textContent });
                    const newScript = doc.createElement('script');
                    newScript.src = filename;
                    script.parentNode.replaceChild(newScript, script);
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

            const generatorContent = `
document.addEventListener('DOMContentLoaded', () => {
    const dynamicHTML = \`${escapedBody}\`;
    document.body.innerHTML = dynamicHTML;
    console.log("Extreme Mode: DOM Regenerated");
});`;

            files.push({ name: 'extreme-loader.js', content: generatorContent });
            doc.body.innerHTML = '';
            const loaderScript = doc.createElement('script');
            loaderScript.src = 'extreme-loader.js';
            doc.body.appendChild(loaderScript);

            if (mergeJs && mergedJsContent.trim()) {
                const appScript = doc.createElement('script');
                appScript.src = `${prefix}app.js`;
                doc.body.appendChild(appScript);
            }
        }

        const finalHtml = new XMLSerializer().serializeToString(doc);
        return { html: finalHtml, files: files };
    }

    /**
     * Uses AI to split code, then validates and repairs the splits.
     */
    async performAiSplit(code, type) {
        const lines = code.split('\n');
        const numberedCode = lines.map((line, idx) => `${idx + 1}| ${line}`).join('\n');
        // Safety truncation
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
        `;

        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Code:\n\n${safeCode}` }
                ],
                json: true
            });

            // Clean markdown wrapping if present
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

        // Sort by start line
        fileDefs.sort((a, b) => a.startLine - b.startLine);

        // 1. Fill Gaps & Normalize
        let currentLine = 1;
        const continuousDefs = [];

        for (const def of fileDefs) {
            // Fill gap
            if (def.startLine > currentLine) {
                const gapName = `fragment-${currentLine}.${type === 'css' ? 'css' : 'js'}`;
                this.log(`Gap detected at line ${currentLine}. Created ${gapName}`, 'warning');
                continuousDefs.push({
                    name: gapName,
                    startLine: currentLine,
                    endLine: def.startLine - 1
                });
            }
            // Fix overlap
            if (def.startLine < currentLine) def.startLine = currentLine;
            
            if (def.endLine >= def.startLine) {
                continuousDefs.push(def);
                currentLine = def.endLine + 1;
            }
        }
        // Fill end
        if (currentLine <= totalLines) {
            continuousDefs.push({
                name: `end-fragment.${type === 'css' ? 'css' : 'js'}`,
                startLine: currentLine,
                endLine: totalLines
            });
        }

        // 2. Syntax Balance Check (JS Only)
        // Merge chunks until braces are balanced using a robust tokenizer
        if (type === 'js') {
            let bufferDef = null;
            let bufferContent = '';
            let currentBalance = 0; 

            for (const def of continuousDefs) {
                const start = def.startLine - 1;
                const end = def.endLine;
                const content = allLines.slice(start, end).join('\n');
                
                // Use robust scanner
                const netChange = this.scanCodeBalance(content);

                if (bufferDef) {
                    // We are buffering (merging)
                    bufferContent += '\n' + content;
                    currentBalance += netChange;
                    bufferDef.endLine = def.endLine;

                    if (currentBalance === 0) {
                        // Balanced! Emit.
                        this.log(`Merged ${def.name} into ${bufferDef.name} to fix syntax (Balance restored).`, 'info');
                        outputFiles.push({ name: bufferDef.name, content: bufferContent });
                        bufferDef = null;
                        bufferContent = '';
                        currentBalance = 0;
                    } else {
                         // Still unbalanced
                         this.log(`Merged ${def.name} into ${bufferDef.name} (Balance: ${currentBalance})`, 'info');
                    }
                } else {
                    if (netChange !== 0) {
                        // Unbalanced start, begin buffering
                        this.log(`File ${def.name} ended with unbalanced braces (Balance: ${netChange}). Merging with next...`, 'warning');
                        bufferDef = def;
                        bufferContent = content;
                        currentBalance = netChange;
                    } else {
                        // Balanced immediately
                        outputFiles.push({ name: def.name, content });
                    }
                }
            }
            
            // Flush remaining buffer
            if (bufferDef) {
                this.log(`Merged remaining content into ${bufferDef.name}. Final balance: ${currentBalance} (Ideally 0).`, 'warning');
                outputFiles.push({ name: bufferDef.name, content: bufferContent });
            }
        } else {
            // CSS - simple slice
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
     * Robustly counts brace balance ignoring strings and comments
     * @returns {number} Net change in brace balance (positive = open, negative = closed)
     */
    scanCodeBalance(code) {
        let balance = 0;
        let inString = false;
        let stringChar = '';
        let inComment = false;
        let commentType = ''; // '//' or '/*'
        let escape = false;

        for (let i = 0; i < code.length; i++) {
            const char = code[i];
            const next = code[i+1] || '';

            if (inString) {
                if (escape) {
                    escape = false;
                } else if (char === '\\') {
                    escape = true;
                } else if (char === stringChar) {
                    inString = false;
                }
            } else if (inComment) {
                if (commentType === '//' && char === '\n') {
                    inComment = false;
                } else if (commentType === '/*' && char === '*' && next === '/') {
                    inComment = false;
                    i++; // skip /
                }
            } else {
                // Not in string or comment
                if (char === '"' || char === "'" || char === '`') {
                    inString = true;
                    stringChar = char;
                } else if (char === '/' && next === '/') {
                    inComment = true;
                    commentType = '//';
                    i++;
                } else if (char === '/' && next === '*') {
                    inComment = true;
                    commentType = '/*';
                    i++;
                } else if (char === '{') {
                    balance++;
                } else if (char === '}') {
                    balance--;
                }
            }
        }
        return balance;
    }

    isEsModule(content) {
        // Simple heuristic: check for export or import statements
        return /^\s*(import|export)\s+/m.test(content);
    }
}