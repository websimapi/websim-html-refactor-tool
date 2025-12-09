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
     * @param {string} htmlString 
     * @returns {string} Cleaned HTML
     */
    removeComments(htmlString) {
        this.log('Removing code comments...', 'info');
        // Remove HTML comments <!-- ... -->
        let cleaned = htmlString.replace(/<!--[\s\S]*?-->/g, '');
        // Remove CSS comments /* ... */
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
        // Remove JS comments (single line // and multi line /* */)
        // Be careful not to remove // inside strings or URLs in HTML attributes
        // This regex is a simplistic approximation for JS inside script tags mostly
        // A full parser is better, but regex works for 90% of cases in this scope
        
        // We will process script contents separately to be safer if we were parsing, 
        // but for a raw string global replace, we have to be careful.
        // Let's stick to safe HTML/CSS comment removal globally, and rely on extraction for JS.
        
        return cleaned;
    }

    /**
     * Main process method
     * @param {string} htmlString - The raw HTML content
     * @param {object} options - Configuration options
     * @returns {Promise<object>} { html, files: [{name, content}] }
     */
    async process(htmlString, options) {
        const { mergeCss, mergeJs, extremeMode, aiSplit, filenamePrefix } = options;
        const prefix = filenamePrefix ? `${filenamePrefix}.` : '';

        this.log('Initializing DOMParser...', 'info');
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        // Error Check: Does it have a body?
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
        
        // Preparation for AI: Gather all content first
        if (styleTags.length > 0) {
            this.log(`Found ${styleTags.length} style blocks.`, 'info');
            
            // First pass: extract all content
            styleTags.forEach((style, index) => {
                mergedCssContent += style.textContent + '\n';
            });
            
            if (aiSplit && mergedCssContent.trim()) {
                this.log('🤖 AI Analysis: Determining optimal CSS split...', 'warning');
                const splitFiles = await this.performAiSplit(mergedCssContent, 'css');
                
                // Remove all original style tags
                styleTags.forEach(s => s.remove());
                
                // Add new links
                splitFiles.forEach(f => {
                    files.push(f);
                    const link = doc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = f.name;
                    doc.head.appendChild(link); // Append to head for CSS
                    this.log(`AI Created: ${f.name}`, 'success');
                });
                
            } else if (mergeCss) {
                // ... Existing Merge Logic ...
                let processedContent = '';
                const cssFileName = `${prefix}style.css`;
                
                styleTags.forEach((style, index) => {
                    processedContent += `/* Extracted from <style> block #${index + 1} */\n${style.textContent}\n\n`;
                    if (index === 0) {
                        const link = doc.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = cssFileName;
                        style.parentNode.replaceChild(link, style);
                    } else {
                        style.remove();
                    }
                });
                files.push({ name: cssFileName, content: processedContent });
                this.log(`Merged all CSS into ${cssFileName}`, 'success');
                
            } else {
                // ... Existing Split Logic ...
                styleTags.forEach((style) => {
                    const filename = `style-${cssCounter}.css`;
                    files.push({ name: filename, content: style.textContent });
                    
                    const link = doc.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = filename;
                    Array.from(style.attributes).forEach(attr => link.setAttribute(attr.name, attr.value));
                    
                    style.parentNode.replaceChild(link, style);
                    this.log(`Extracted ${filename}`, 'success');
                    cssCounter++;
                });
            }
        } else {
            this.log('No <style> tags found.', 'info');
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
                
                // Remove all original scripts
                executableScripts.forEach(s => s.remove());
                
                // Add new scripts
                splitFiles.forEach(f => {
                    files.push(f);
                    const script = doc.createElement('script');
                    script.src = f.name;
                    // Assume module for safety if splitting complex apps, or regular if simple
                    // Best guess: use type="module" if the original code looks modular, but standard for generic
                    // For now, standard script appended to body
                    doc.body.appendChild(script);
                    this.log(`AI Created: ${f.name}`, 'success');
                });
                
            } else if (mergeJs) {
                let processedContent = '';
                const jsFileName = `${prefix}app.js`;

                executableScripts.forEach((script, index) => {
                    processedContent += `// Extracted from script block #${index + 1}\n${script.textContent}\n\n`;
                    script.remove();
                });
                files.push({ name: jsFileName, content: processedContent });
                const mainScript = doc.createElement('script');
                mainScript.src = jsFileName;
                doc.body.appendChild(mainScript);
                this.log(`Merged all JS into ${jsFileName}`, 'success');
                
            } else {
                executableScripts.forEach((script) => {
                    const filename = `script-${jsCounter}.js`;
                    files.push({ name: filename, content: script.textContent });

                    const newScript = doc.createElement('script');
                    newScript.src = filename;
                    Array.from(script.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));

                    script.parentNode.replaceChild(newScript, script);
                    this.log(`Extracted ${filename}`, 'success');
                    jsCounter++;
                });
            }
        } else {
            this.log('No inline <script> tags found.', 'info');
        }

        // --- EXTREME MODE (Dynamic HTML) ---
        if (extremeMode) {
            this.log('INITIATING EXTREME MODE...', 'warning');

            // 1. Get current Body HTML (after CSS/JS extraction modifications)
            let bodyContent = doc.body.innerHTML;

            // 2. Escape content for use in a template literal
            // We need to escape backticks ` and ${ to prevent JS interpolation errors in the generated file
            let escapedBody = bodyContent
                .replace(/\\/g, '\\\\') // Escape backslashes first
                .replace(/`/g, '\\`')   // Escape backticks
                .replace(/\$\{/g, '\\${'); // Escape template literal start

            // 3. Create the generator script
            const generatorContent = `
/** 
 * EXTREME MODE: Dynamic HTML Generator
 * This file constructs the DOM at runtime.
 */
document.addEventListener('DOMContentLoaded', () => {
    const dynamicHTML = \`${escapedBody}\`;
    document.body.innerHTML = dynamicHTML;
    console.log("Extreme Mode: DOM Regenerated");

    // Re-execute scripts that might have been inside the body string (browsers don't auto-run scripts injected via innerHTML)
    // Note: This is a basic implementation. Complex script tags inside the dynamic HTML might need manual handling.
});
            `;

            files.push({ name: 'extreme-loader.js', content: generatorContent });

            // 4. Wipe body and add loader
            doc.body.innerHTML = '';
            const loaderScript = doc.createElement('script');
            loaderScript.src = 'extreme-loader.js';
            doc.body.appendChild(loaderScript);

            // If we merged JS previously, we need to make sure that app.js is still loaded.
            // Since we wiped the body, if app.js was at the bottom, it's gone.
            // We need to re-append it AFTER the loader or strictly in head? 
            // Usually extreme mode implies the body content is dynamic, but utility scripts (app.js) usually sit outside.

            if (mergeJs && mergedJsContent.trim()) {
                const appScript = doc.createElement('script');
                appScript.src = 'app.js';
                doc.body.appendChild(appScript);
            }

            this.log('Extreme Mode: Body converted to JavaScript.', 'success');
        }

        // Serialize the final HTML
        const finalHtml = new XMLSerializer().serializeToString(doc);

        return {
            html: finalHtml,
            files: files
        };
    }

    /**
     * Uses AI to determine split points based on line numbers
     * @param {string} code 
     * @param {string} type 'css' or 'js'
     * @returns {Promise<Array>} Array of {name, content}
     */
    async performAiSplit(code, type) {
        // 1. Prepare code with line numbers for the AI
        const lines = code.split('\n');
        const numberedCode = lines.map((line, idx) => `${idx + 1}| ${line}`).join('\n');
        
        // Truncate if too huge (safety limit for demo)
        const safeCode = numberedCode.length > 50000 ? numberedCode.substring(0, 50000) + "\n... (truncated)" : numberedCode;

        const systemPrompt = `You are a code refactoring engine. 
        Your goal is to split a monolithic ${type.toUpperCase()} file into logical, modular component files.
        Return a JSON object containing a "files" array.
        Each item in "files" must have:
        - "name": filename (e.g., 'header.css', 'utils.js')
        - "startLine": integer (inclusive 1-based index)
        - "endLine": integer (inclusive 1-based index)
        
        Ensure every single line of code is covered by exactly one file range. No overlaps, no gaps.
        Sort by startLine.
        `;

        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Here is the code with line numbers:\n\n${safeCode}` }
                ],
                json: true
            });

            const result = JSON.parse(completion.content);
            
            if (!result.files || !Array.isArray(result.files)) {
                throw new Error("Invalid AI response structure");
            }

            const outputFiles = [];
            
            result.files.forEach(fileDef => {
                // Convert 1-based start/end to 0-based array slice indices
                // Slice is [start, end), so we need startLine-1 to endLine
                const start = fileDef.startLine - 1;
                const end = fileDef.endLine; // slice excludes end, so this covers up to the line we want
                
                // Safety bounds
                const safeStart = Math.max(0, start);
                const safeEnd = Math.min(lines.length, end);
                
                if (safeStart < safeEnd) {
                    const fileContent = lines.slice(safeStart, safeEnd).join('\n');
                    outputFiles.push({
                        name: fileDef.name,
                        content: fileContent
                    });
                }
            });

            return outputFiles;

        } catch (e) {
            this.log(`AI Split Failed: ${e.message}. Falling back to single file.`, 'error');
            return [{ 
                name: type === 'css' ? 'style.css' : 'app.js', 
                content: code 
            }];
        }
    }
}