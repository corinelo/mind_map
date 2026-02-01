let currentProjectId = null;
let currentProjectName = "Inbox";
let mapData = {};
let inboxData = [];
let selectedNodeId = null;

// --- Undo/Redo History Stacks ---
let historyStack = [];
let redoStack = [];

// 履歴を保存する（変更を加える直前に呼ぶ）
function pushHistory() {
    // 現在のmapDataをディープコピーして保存
    const state = JSON.parse(JSON.stringify(mapData));
    historyStack.push(state);
    // 新しい操作をしたら未来（Redo）は消える
    redoStack = [];
    updateUndoRedoButtons();
}

async function undo() {
    if (historyStack.length === 0) return;

    // 現在の状態を未来（Redo）に送る
    const current = JSON.parse(JSON.stringify(mapData));
    redoStack.push(current);

    // 過去（History）から取り出す
    const prev = historyStack.pop();
    mapData = prev;

    // 選択状態の復元（もし削除したノードならルートに戻すなどのケアが必要だが一旦ルートへ）
    // 簡易的にルートを選択（またはIDが存在すれば維持）
    if(selectedNodeId && !findNode(mapData, selectedNodeId)) {
        selectedNodeId = mapData.id;
    }

    renderMap(mapData);
    saveMapToServer(); // サーバーにも戻った状態を保存
    updateUndoRedoButtons();
}

async function redo() {
    if (redoStack.length === 0) return;

    // 現在の状態を過去（History）に送る
    const current = JSON.parse(JSON.stringify(mapData));
    historyStack.push(current);

    // 未来（Redo）から取り出す
    const next = redoStack.pop();
    mapData = next;

    renderMap(mapData);
    saveMapToServer();
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    // ボタンの見た目制御（あれば）
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if(undoBtn) undoBtn.style.opacity = historyStack.length > 0 ? 1 : 0.3;
    if(redoBtn) redoBtn.style.opacity = redoStack.length > 0 ? 1 : 0.3;
}


// --- プロジェクト管理 ---
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
            li.onclick = () => switchProject(p.id, p.name);
            li.innerHTML = `<span><i class="fa-solid fa-folder"></i> ${p.name}</span>
                            <button class="project-delete-btn" onclick="deleteProject(event, ${p.id})"><i class="fa-solid fa-trash"></i></button>`;
            listEl.appendChild(li);
        });

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
            } else { switchProject(projects[0].id, projects[0].name); }
        }
    } catch(e) { console.error("Project Load Error:", e); }
}

function switchProject(id, name) {
    currentProjectId = id;
    currentProjectName = name;
    document.getElementById('inbox-title').innerText = name || "Inbox";
    
    // 履歴をクリア（プロジェクトが変わったらUndoできないようにする）
    historyStack = [];
    redoStack = [];
    updateUndoRedoButtons();

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
        const res = await fetch('/api/projects', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: name }) });
        const data = await res.json();
        loadProjects(data.id);
    } catch(e) { console.error(e); }
}

async function deleteProject(event, id) {
    event.stopPropagation();
    if(!confirm("プロジェクトを完全に削除しますか？")) return;
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
    if(currentProjectId == id) currentProjectId = null;
    loadProjects();
}

// --- データ読み込み ---
async function loadData(projectId) {
    if(!projectId) return;
    try {
        const res = await fetch(`/api/data/${projectId}`);
        const data = await res.json();
        mapData = data.map;
        if(!mapData.children) mapData.children = []; // 安全策
        inboxData = data.inbox;
        renderInbox();
        
        const mapArea = document.getElementById('map-area');
        if(window.getComputedStyle(mapArea).display !== 'none') {
             renderMap(mapData);
        }
    } catch(e) { console.error(e); }
}

// --- マインドマップ操作 ---
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

async function saveMapToServer() {
    if(!currentProjectId) return;
    await fetch('/api/save_map', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ project_id: currentProjectId, map_data: mapData })
    });
}
function updateMapAndSelect(newId) {
    selectedNodeId = newId;
    renderMap(mapData);
    saveMapToServer();
}

function editNodeText(nodeId) {
    const nodeData = findNode(mapData, nodeId);
    if(!nodeData) return;
    
    // promptが開く前に現在のテキストを保持しておきたいが、
    // キャンセルされたら変更しないので、変更確定直前にpushHistoryする
    const newText = prompt("編集:", nodeData.topic);
    
    if(newText !== null && newText.trim() !== "") {
        pushHistory(); // 【履歴追加】
        nodeData.topic = newText;
        renderMap(mapData);
        saveMapToServer();
    }
}

// --- キーボードイベント (Undo/Redo追加) ---
document.addEventListener('keydown', (e) => {
    // 常に有効なショートカット (Undo/Redo)
    if (currentProjectId && document.getElementById('map-area').style.display !== 'none') {
        // Ctrl+Z (Undo)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
            return;
        }
        // Ctrl+Y or Ctrl+Shift+Z (Redo)
        if (((e.ctrlKey || e.metaKey) && e.key === 'y') || 
            ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            redo();
            return;
        }
    }

    if(document.getElementById('map-area').style.display === 'none') return;
    if(e.target.tagName === 'INPUT') return; 
    if (!selectedNodeId) return;
    const selectedNode = findNode(mapData, selectedNodeId);
    if (!selectedNode) return;

    if (e.key === 'Tab') {
        e.preventDefault();
        pushHistory(); // 【履歴追加】
        const newNode = { id: generateId(), topic: "New", children: [] };
        if (!selectedNode.children) selectedNode.children = [];
        selectedNode.children.push(newNode);
        updateMapAndSelect(newNode.id);

    } else if (e.key === 'Enter') {
        e.preventDefault();
        pushHistory(); // 【履歴追加】
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

    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            pushHistory(); // 【履歴追加】
            parent.children = parent.children.filter(n => n.id !== selectedNodeId);
            selectedNodeId = parent.id;
            updateMapAndSelect(selectedNodeId);
        }

    } else if (e.key === ' ') {
        e.preventDefault();
        editNodeText(selectedNodeId);

    } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const parent = findParent(mapData, selectedNodeId);
        // 移動は履歴に残さなくて良い（構造変化ではないため）
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

// --- マップ描画 (D3) ---
function renderMap(data) {
    const svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove();
    const container = document.getElementById('map-area');
    if(container.clientWidth === 0) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");
    svg.call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)));

    const root = d3.hierarchy(data);
    const treeLayout = d3.tree().size([height - 100, width - 250])
        .separation((a, b) => (a.parent == b.parent ? 1.5 : 2));
    treeLayout(root);

    g.selectAll(".link").data(root.links()).enter().append("path").attr("class", "link")
        .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

    const node = g.selectAll(".node").data(root.descendants()).enter().append("g")
        .attr("class", "node").attr("transform", d => `translate(${d.y},${d.x})`)
        .on("click", (e, d) => { e.stopPropagation(); selectedNodeId = d.data.id; renderMap(mapData); })
        .on("dblclick", (e, d) => { e.stopPropagation(); editNodeText(d.data.id); });

    node.append("text").attr("dy", 5).attr("x", 10).style("text-anchor", "start").text(d => d.data.topic)
        .each(function(d) { d.bbox = this.getBBox(); });
    node.insert("rect", "text").attr("x", 0).attr("y", -15).attr("width", d => d.bbox.width + 20).attr("height", 30)
        .attr("class", d => d.data.id === selectedNodeId ? "selected" : "");
}

// --- AI 処理 ---
async function organizeWithAI() {
    if(inboxData.length === 0) return alert("Inboxが空です");
    const btn = document.getElementById('ai-btn');
    const originalIcon = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true;

    try {
        const res = await fetch('/api/ai_organize', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ map_data: mapData, project_id: currentProjectId })
        });
        const result = await res.json();
        if (result.status === 'success') {
            pushHistory(); // 【履歴追加】AIが書き換える前に保存
            mapData = result.new_map;
            loadData(currentProjectId);
            // AI処理後は未来のスタックも消える（pushHistory内で処理済）
        } else { alert('エラー: ' + result.message); }
    } catch (e) { alert('通信エラー'); } 
    finally { btn.innerHTML = originalIcon; btn.disabled = false; }
}

// 共通パーツ
async function saveToInbox(text) {
    if(!currentProjectId) return alert("プロジェクトを選択してください");
    await fetch('/api/inbox', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: text, project_id: currentProjectId }) });
    loadData(currentProjectId);
    document.getElementById('manual-input').value = '';
}
async function deleteItem(id) {
    await fetch(`/api/inbox?id=${id}`, { method: 'DELETE' });
    loadData(currentProjectId);
}

// 初期化
const listEl = document.getElementById('idea-ul');
new Sortable(listEl, { animation: 150 });
const micBtn = document.getElementById('mic-btn');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    micBtn.addEventListener('click', () => { if (micBtn.classList.contains('mic-off')) recognition.start(); else recognition.stop(); });
    recognition.onstart = () => micBtn.classList.replace('mic-off', 'mic-on');
    recognition.onend = () => micBtn.classList.replace('mic-on', 'mic-off');
    recognition.onresult = (e) => saveToInbox(e.results[0][0].transcript);
} else { micBtn.style.display = 'none'; }
function toggleInput() { const area = document.getElementById('input-area'); area.style.display = area.style.display === 'none' ? 'flex' : 'none'; if(area.style.display === 'flex') document.getElementById('manual-input').focus(); }
function addManualItem() { saveToInbox(document.getElementById('manual-input').value); }
function handleEnter(e) { if(e.key === 'Enter') addManualItem(); }
function toggleProjectSidebar() { document.getElementById('project-sidebar').classList.toggle('active'); }
function toggleInboxSidebar() { const inbox = document.getElementById('inbox-sidebar'); const openBtn = document.getElementById('open-inbox-btn'); if (inbox.style.display === 'none') { inbox.style.display = 'flex'; openBtn.style.display = 'none'; } else { inbox.style.display = 'none'; openBtn.style.display = 'block'; } }
function renderInbox() {
    const ul = document.getElementById('idea-ul'); ul.innerHTML = '';
    if(inboxData.length === 0) document.getElementById('empty-state').style.display = 'block';
    else { document.getElementById('empty-state').style.display = 'none'; inboxData.forEach(item => { const li = document.createElement('li'); li.innerHTML = `<span>${item.text}</span><button class="delete-btn" onclick="deleteItem(${item.id})"><i class="fa-solid fa-trash"></i></button>`; ul.appendChild(li); }); }
}
window.onload = () => loadProjects();
window.onresize = () => loadData(currentProjectId);