// ==========================================
//  Global Variables
// ==========================================
let currentProjectId = null;
let currentProjectName = "Inbox";
let mapData = {};
let inboxData = [];
let selectedNodeId = null;

// Undo/Redo Stacks
let historyStack = [];
let redoStack = [];


// ==========================================
//  Undo / Redo Logic
// ==========================================
function pushHistory() {
    // 現在の状態をコピーして保存
    const state = JSON.parse(JSON.stringify(mapData));
    historyStack.push(state);
    redoStack = []; // 新しい操作をしたら未来は消える
    updateUndoRedoButtons();
}

async function undo() {
    if (historyStack.length === 0) return;

    // 現在をRedoへ
    const current = JSON.parse(JSON.stringify(mapData));
    redoStack.push(current);

    // Historyから復元
    const prev = historyStack.pop();
    mapData = prev;
    
    // 選択状態のケア（存在しなければ解除）
    if(selectedNodeId && !findNode(mapData, selectedNodeId)) {
        selectedNodeId = null;
    }

    renderMap(mapData);
    saveMapToServer();
    updateUndoRedoButtons();
}

async function redo() {
    if (redoStack.length === 0) return;

    // 現在をHistoryへ
    const current = JSON.parse(JSON.stringify(mapData));
    historyStack.push(current);

    // Redoから復元
    const next = redoStack.pop();
    mapData = next;

    renderMap(mapData);
    saveMapToServer();
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if(undoBtn) undoBtn.style.opacity = historyStack.length > 0 ? 1 : 0.3;
    if(redoBtn) redoBtn.style.opacity = redoStack.length > 0 ? 1 : 0.3;
}


// ==========================================
//  Project Management
// ==========================================
async function loadProjects(shouldSelectId = null) {
    try {
        const res = await fetch('/api/projects');
        const projects = await res.json();
        
        const listEl = document.getElementById('project-list');
        listEl.innerHTML = '';
        
        if (projects.length === 0) {
            document.getElementById('inbox-title').innerText = "Inbox";
            return;
        }

        projects.forEach(p => {
            const li = document.createElement('li');
            li.className = 'project-item';
            li.dataset.id = p.id;
            
            if (p.id == currentProjectId) li.classList.add('active');

            // クリックで切り替え
            li.onclick = () => switchProject(p.id, p.name);
            
            li.innerHTML = `
                <span><i class="fa-solid fa-folder"></i> ${p.name}</span>
                <div class="project-actions">
                    <button class="project-edit-btn" onclick="editProject(event, ${p.id}, '${p.name}')">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="project-delete-btn" onclick="deleteProject(event, ${p.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            listEl.appendChild(li);
        });

        // 選択ロジック
        if (shouldSelectId) {
            const target = projects.find(p => p.id == shouldSelectId);
            if(target) switchProject(target.id, target.name);
        } else if (!currentProjectId && projects.length > 0) {
            switchProject(projects[0].id, projects[0].name);
        } else if (currentProjectId) {
            const current = projects.find(p => p.id == currentProjectId);
            if(current) {
                currentProjectName = current.name;
                document.getElementById('inbox-title').innerText = current.name;
            } else {
                switchProject(projects[0].id, projects[0].name);
            }
        }

    } catch(e) { console.error("Project Load Error:", e); }
}

function switchProject(id, name) {
    currentProjectId = id;
    currentProjectName = name;
    
    document.getElementById('inbox-title').innerText = name || "Inbox";
    
    // 履歴クリア
    historyStack = [];
    redoStack = [];
    updateUndoRedoButtons();

    // UI更新
    const listEl = document.getElementById('project-list');
    Array.from(listEl.children).forEach(li => {
        if (li.dataset.id == id) li.classList.add('active');
        else li.classList.remove('active');
    });

    loadData(id);
    document.getElementById('project-sidebar').classList.remove('active');
}

async function createProject() {
    const name = prompt("新しいプロジェクト名:");
    if(!name) return;
    try {
        const res = await fetch('/api/projects', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();
        loadProjects(data.id);
    } catch(e) { console.error(e); }
}

async function editProject(event, id, oldName) {
    event.stopPropagation();
    const newName = prompt("プロジェクト名を変更:", oldName);
    if (!newName || newName === oldName) return;

    try {
        await fetch('/api/projects', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: id, name: newName })
        });
        loadProjects(currentProjectId);
    } catch(e) { console.error(e); }
}

async function deleteProject(event, id) {
    event.stopPropagation();
    if(!confirm("プロジェクトを完全に削除しますか？")) return;
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
    if(currentProjectId == id) currentProjectId = null;
    loadProjects();
}


// ==========================================
//  Mobile View Toggle
// ==========================================
function switchMobileView(mode) {
    const body = document.body;
    const tabList = document.getElementById('tab-list');
    const tabMap = document.getElementById('tab-map');

    if (mode === 'list') {
        body.classList.remove('mode-map');
        body.classList.add('mode-list');
        tabList.classList.add('active');
        tabMap.classList.remove('active');
    } else {
        body.classList.remove('mode-list');
        body.classList.add('mode-map');
        tabList.classList.remove('active');
        tabMap.classList.add('active');
        setTimeout(() => renderMap(mapData), 50);
    }
}


// ==========================================
//  Data Loading & Saving
// ==========================================
async function loadData(projectId) {
    if(!projectId) return;
    try {
        const res = await fetch(`/api/data/${projectId}`);
        const data = await res.json();
        mapData = data.map;
        if(!mapData.children) mapData.children = [];
        inboxData = data.inbox;
        
        renderInbox();
        
        // マップが表示可能なら描画
        const mapArea = document.getElementById('map-area');
        if(window.getComputedStyle(mapArea).display !== 'none') {
             renderMap(mapData);
        }
    } catch(e) { console.error(e); }
}

async function saveMapToServer() {
    if(!currentProjectId) return;
    await fetch('/api/save_map', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ project_id: currentProjectId, map_data: mapData })
    });
}


// ==========================================
//  Mind Map Logic (Manipulation)
// ==========================================
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

function findNode(node, id) {
    if (node.id === id) return node;
    if (node.children) {
        for (let child of node.children) {
            const found = findNode(child, id);
            if (found) return found;
        }
    }
    return null;
}

function findParent(root, id) {
    if (!root.children) return null;
    for (let child of root.children) {
        if (child.id === id) return root;
        const found = findParent(child, id);
        if (found) return found;
    }
    return null;
}

function updateMapAndSelect(newId) {
    selectedNodeId = newId;
    renderMap(mapData);
    saveMapToServer();
}

function editNodeText(nodeId) {
    const nodeData = findNode(mapData, nodeId);
    if(!nodeData) return;
    
    // 編集ダイアログ
    const newText = prompt("編集:", nodeData.topic);
    
    if(newText !== null && newText.trim() !== "") {
        pushHistory(); // 履歴保存
        nodeData.topic = newText;
        renderMap(mapData);
        saveMapToServer();
    }
}


// ==========================================
//  Keyboard Shortcuts
// ==========================================
document.addEventListener('keydown', (e) => {
    // Undo / Redo
    if (currentProjectId && document.getElementById('map-area').style.display !== 'none') {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault(); undo(); return;
        }
        if (((e.ctrlKey || e.metaKey) && e.key === 'y') || 
            ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey)) {
            e.preventDefault(); redo(); return;
        }
    }

    // Input中などは無視
    if(document.getElementById('map-area').style.display === 'none') return;
    if(e.target.tagName === 'INPUT') return; 
    if (!selectedNodeId) return;
    
    const selectedNode = findNode(mapData, selectedNodeId);
    if (!selectedNode) return;

    // Tab: Add Child
    if (e.key === 'Tab') {
        e.preventDefault();
        pushHistory();
        const newNode = { id: generateId(), topic: "New", children: [] };
        if (!selectedNode.children) selectedNode.children = [];
        selectedNode.children.push(newNode);
        updateMapAndSelect(newNode.id);
    } 
    // Enter: Add Sibling
    else if (e.key === 'Enter') {
        e.preventDefault();
        pushHistory();
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            const newNode = { id: generateId(), topic: "New", children: [] };
            parent.children.push(newNode);
            updateMapAndSelect(newNode.id);
        } else {
             const newNode = { id: generateId(), topic: "New", children: [] };
             if (!selectedNode.children) selectedNode.children = [];
             selectedNode.children.push(newNode);
             updateMapAndSelect(newNode.id);
        }
    } 
    // Delete: Remove Node
    else if (e.key === 'Backspace' || e.key === 'Delete') {
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            pushHistory();
            parent.children = parent.children.filter(n => n.id !== selectedNodeId);
            selectedNodeId = parent.id;
            updateMapAndSelect(selectedNodeId);
        }
    } 
    // Space: Edit Text
    else if (e.key === ' ') {
        e.preventDefault();
        editNodeText(selectedNodeId);
    } 
    // Arrows: Navigation
    else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const parent = findParent(mapData, selectedNodeId);
        if (e.key === 'ArrowLeft' && parent) {
            selectedNodeId = parent.id; renderMap(mapData);
        } else if (e.key === 'ArrowRight' && selectedNode.children?.length) {
            selectedNodeId = selectedNode.children[0].id; renderMap(mapData);
        } else if (e.key === 'ArrowUp' && parent) {
            const idx = parent.children.findIndex(c => c.id === selectedNodeId);
            if (idx > 0) { selectedNodeId = parent.children[idx - 1].id; renderMap(mapData); }
        } else if (e.key === 'ArrowDown' && parent) {
            const idx = parent.children.findIndex(c => c.id === selectedNodeId);
            if (idx < parent.children.length - 1) { selectedNodeId = parent.children[idx + 1].id; renderMap(mapData); }
        }
    }
});


// ==========================================
//  D3.js Rendering
// ==========================================
function renderMap(data) {
    const svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove();
    
    const container = document.getElementById('map-area');
    if(container.clientWidth === 0) return; // 非表示なら描画しない

    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");
    svg.call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)));

    const root = d3.hierarchy(data);
    const treeLayout = d3.tree()
        .size([height - 100, width - 250])
        .separation((a, b) => (a.parent == b.parent ? 1.5 : 2));
    treeLayout(root);

    // Links
    g.selectAll(".link")
        .data(root.links())
        .enter().append("path")
        .attr("class", "link")
        .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

    // Nodes
    const node = g.selectAll(".node")
        .data(root.descendants())
        .enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.y},${d.x})`)
        .on("click", (e, d) => {
            e.stopPropagation();
            selectedNodeId = d.data.id;
            renderMap(mapData);
        })
        .on("dblclick", (e, d) => {
            e.stopPropagation();
            editNodeText(d.data.id);
        });

    // Text & Rect (Auto Sizing)
    node.append("text")
        .attr("dy", 5)
        .attr("x", 10)
        .style("text-anchor", "start")
        .text(d => d.data.topic)
        .each(function(d) { d.bbox = this.getBBox(); });

    node.insert("rect", "text")
        .attr("x", 0)
        .attr("y", -15)
        .attr("width", d => d.bbox.width + 20)
        .attr("height", 30)
        .attr("class", d => d.data.id === selectedNodeId ? "selected" : "");
}


// ==========================================
//  AI & Inbox Logic
// ==========================================
async function organizeWithAI() {
    if(inboxData.length === 0) return alert("Inboxが空です");
    const btn = document.getElementById('ai-btn');
    const originalIcon = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; 
    btn.disabled = true;

    try {
        const res = await fetch('/api/ai_organize', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ map_data: mapData, project_id: currentProjectId })
        });
        const result = await res.json();
        if (result.status === 'success') {
            pushHistory(); // 履歴保存
            mapData = result.new_map;
            loadData(currentProjectId);
        } else { alert('エラー: ' + result.message); }
    } catch (e) { alert('通信エラー'); } 
    finally { btn.innerHTML = originalIcon; btn.disabled = false; }
}

async function saveToInbox(text) {
    if(!currentProjectId) return alert("プロジェクトを選択してください");
    await fetch('/api/inbox', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ text: text, project_id: currentProjectId })
    });
    loadData(currentProjectId);
    document.getElementById('manual-input').value = '';
}

async function deleteItem(id) {
    await fetch(`/api/inbox?id=${id}`, { method: 'DELETE' });
    loadData(currentProjectId);
}


// ==========================================
//  Initialization
// ==========================================
const listEl = document.getElementById('idea-ul');
new Sortable(listEl, { animation: 150 });

const micBtn = document.getElementById('mic-btn');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    micBtn.addEventListener('click', () => {
        if (micBtn.classList.contains('mic-off')) recognition.start(); 
        else recognition.stop();
    });
    recognition.onstart = () => micBtn.classList.replace('mic-off', 'mic-on');
    recognition.onend = () => micBtn.classList.replace('mic-on', 'mic-off');
    recognition.onresult = (e) => saveToInbox(e.results[0][0].transcript);
} else { micBtn.style.display = 'none'; }

function toggleInput() {
    const area = document.getElementById('input-area');
    area.style.display = area.style.display === 'none' ? 'flex' : 'none';
    if(area.style.display === 'flex') document.getElementById('manual-input').focus();
}
function addManualItem() { saveToInbox(document.getElementById('manual-input').value); }
function handleEnter(e) { if(e.key === 'Enter') addManualItem(); }

function toggleProjectSidebar() { document.getElementById('project-sidebar').classList.toggle('active'); }
function toggleInboxSidebar() {
    const inbox = document.getElementById('inbox-sidebar');
    const openBtn = document.getElementById('open-inbox-btn');
    if (inbox.style.display === 'none') { inbox.style.display = 'flex'; openBtn.style.display = 'none'; }
    else { inbox.style.display = 'none'; openBtn.style.display = 'block'; }
}

function renderInbox() {
    const ul = document.getElementById('idea-ul');
    ul.innerHTML = '';
    if(inboxData.length === 0) document.getElementById('empty-state').style.display = 'block';
    else {
        document.getElementById('empty-state').style.display = 'none';
        inboxData.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${item.text}</span><button class="delete-btn" onclick="deleteItem(${item.id})"><i class="fa-solid fa-trash"></i></button>`;
            ul.appendChild(li);
        });
    }
}

// 初期ロード
window.onload = () => {
    document.body.classList.add('mode-list'); // Mobile Default
    loadProjects();
};
window.onresize = () => loadData(currentProjectId);