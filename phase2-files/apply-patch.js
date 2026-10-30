const fs = require('fs');

function extractBlock(sectionNum) {
    const prompt = fs.readFileSync('phase2-files/full-prompt.txt', 'utf8');
    const startMarker = '## ' + sectionNum + '.';
    const p1 = prompt.indexOf(startMarker);
    if (p1 === -1) throw new Error('Start marker not found for section ' + sectionNum);
    const pCodeStart = prompt.indexOf('```js\n', p1) + 6;
    const pCodeEnd = prompt.indexOf('\n```\n', pCodeStart);
    return prompt.substring(pCodeStart, pCodeEnd);
}

function indent(str, spaces) {
    const pad = ' '.repeat(spaces);
    return str.split('\n').map((line, idx) => idx === 0 ? line : (line ? pad + line : line)).join('\n');
}

let code = fs.readFileSync('main/terminal.js', 'utf8');

// 4. Replace manPages
const pMan = code.indexOf('const manPages = {');
const pManEnd = code.indexOf('};', pMan);
if (pMan === -1 || pManEnd === -1) throw new Error('manPages not found');
const newManPages = indent(extractBlock(4), 8);
code = code.substring(0, pMan) + newManPages + code.substring(pManEnd + 2);
console.log('Step 4 done');

// 5. Replace saveFileToStorage
const pSave = code.indexOf('function saveFileToStorage(name, content) {');
const pSaveEnd = code.indexOf('\n        function loadFileFromStorage(name)', pSave);
if (pSave === -1 || pSaveEnd === -1) throw new Error('saveFileToStorage not found');
const newSave = indent(extractBlock(5), 8);
code = code.substring(0, pSave) + newSave + code.substring(pSaveEnd);
console.log('Step 5 done');

// 6. Replace getCompletions
const pComp = code.indexOf('function getCompletions(input) {');
const pCompEnd = code.indexOf('\n        function applyCompletion(input, completion, isCommand)', pComp);
if (pComp === -1 || pCompEnd === -1) throw new Error('getCompletions not found');
const newComp = indent(extractBlock(6), 8);
code = code.substring(0, pComp) + newComp + code.substring(pCompEnd);
console.log('Step 6 done');

// 7. Replace runCommand
const pRun = code.indexOf('function runCommand(rawInput) {');
const pRunEnd = code.indexOf('\n        function openWebpage(url, title) {', pRun);
if (pRun === -1 || pRunEnd === -1) throw new Error('runCommand not found');
const newRun = indent(extractBlock(7), 8);
code = code.substring(0, pRun) + newRun + code.substring(pRunEnd);
console.log('Step 7 done');

// 8. Replace terminalInput event listener block
const pKey = code.indexOf('if (terminalInput) {\n            terminalInput.addEventListener(\'keydown\'');
const pKeyEnd = code.indexOf('\n        if (terminal && terminalInput) {', pKey);
if (pKey === -1 || pKeyEnd === -1) throw new Error('terminalInput listeners not found');
const newKey = indent(extractBlock(8), 8);
code = code.substring(0, pKey) + newKey + code.substring(pKeyEnd);
console.log('Step 8 done');

// 9. Patch openTextEditor: currentEditor = { overlay, textarea, filename, path: options.path || null };
const target9 = `currentEditor = {
                overlay,
                textarea,
                filename
            };`;
const repl9 = `currentEditor = {
                overlay,
                textarea,
                filename,
                path: options.path || null
            };`;
if (!code.includes(target9)) throw new Error('Step 9 target not found');
code = code.replace(target9, repl9);
console.log('Step 9 done');

// 10. Patch openWebpage: isLocalObjectUrl
const target10 = `function openWebpage(url, title) {
            if (!webpagePane || !webpageIframe) return;

            if (window.SiteIframes && !window.SiteIframes.canEmbed(url)) {`;
const repl10 = `function openWebpage(url, title) {
            if (!webpagePane || !webpageIframe) return;

            const isLocalObjectUrl = typeof url === 'string' && (
                url.startsWith('blob:') || url.startsWith('data:')
            );

            if (!isLocalObjectUrl && window.SiteIframes && !window.SiteIframes.canEmbed(url)) {`;
if (!code.includes(target10)) throw new Error('Step 10 target not found');
code = code.replace(target10, repl10);
console.log('Step 10 done');

fs.writeFileSync('main/terminal.js', code, 'utf8');
console.log('All steps 4-10 applied successfully!');
