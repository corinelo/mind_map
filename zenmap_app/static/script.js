let currentProjectId = null;
let currentProjectName = "Inbox";
let mapData = {};
let inboxData = [];
let selectedNodeId = null;

// --- プロジェクト管理 (修正版) ---

async function loadProjects(shouldSelectId = null) {
    try {
        const res = await fetch('/api/projects');
        const projects = await res.json();
        
        const listEl = document.getElementById('project-list');
        listEl.innerHTML = ''; // リストをクリア
        
        if (projects.length === 0) {
            document.getElementById('inbox-title').innerText = "Inbox";
            return;
        }

        projects.forEach(p => {
            const li = document.createElement('li');
            li.className = 'project-item';
            li.dataset.id = p.id; // IDをデータ属性として持たせる
            
            // 現在選択中ならactiveクラス
            if (p.id == currentProjectId) li.classList.add('active');

            // クリックイベント
            li.onclick = () => switchProject(p.id, p.name);
            
            li.innerHTML = `
                <span><i class="fa-solid fa-folder"></i> ${p.name}</span>
                <button class="project-delete-btn" onclick="deleteProject(event, ${p.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
            listEl.appendChild(li);
        });

        // 指定があればそれを選択、なければ既存維持、それもなければ先頭
        if (shouldSelectId) {
            const target = projects.find(p => p.id == shouldSelectId);
            if(target) switchProject(target.id, target.name);
        } else if (!currentProjectId && projects.length > 0) {
            switchProject(projects[0].id, projects[0].name);
        } else if (currentProjectId) {
            // 名前だけ更新（念の為）
            const current = projects.find(p => p.id == currentProjectId);
            if(current) {
                currentProjectName = current.name;
                document.getElementById('inbox-title').innerText = current.name;
            } else {
                // 削除されてた場合などは先頭へ
                switchProject(projects[0].id, projects[0].name);
            }
        }

    } catch(e) { console.error("Project Load Error:", e); }
}

// 切り替え処理（リスト再描画を行わない軽量版）
function switchProject(id, name) {
    currentProjectId = id;
    currentProjectName = name;
    
    // UI更新: タイトル
    document.getElementById('inbox-title').innerText = name || "Inbox";
    
    // UI更新: リストのActiveクラス付け替え
    const listEl = document.getElementById('project-list');
    Array.from(listEl.children).forEach(li => {
        if (li.dataset.id == id) li.classList.add('active');
        else li.classList.remove('active');
    });

    // データの読み込み
    loadData(id);
    
    // スマホ用: サイドバーを閉じる
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
        // 作成したら、そのIDを指定してリロード
        loadProjects(data.id);
    } catch(e) { console.error(e); }
}

async function deleteProject(event, id) {
    event.stopPropagation(); // 親のクリックを阻止
    if(!confirm("プロジェクトを完全に削除しますか？")) return;
    
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
    
    // 現在開いているプロジェクトを消した場合はnullにする
    if(currentProjectId == id) currentProjectId = null;
    
    loadProjects();
}


// --- マインドマップ描画 (Dynamic Size対応) ---

function renderMap(data) {
    const svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove();
    
    const container = document.getElementById('map-area');
    // コンテナが非表示なら描画しない（エラー防止）
    if(container.clientWidth === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");
    svg.call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)));

    const root = d3.hierarchy(data);
    
    // ツリーのサイズ設定
    // 横幅は固定せず、ノード間隔で調整するほうが自然ですが、
    // 今回は簡易的に画面サイズベースで広げます
    const treeLayout = d3.tree()
        .size([height - 100, width - 250])
        .separation((a, b) => (a.parent == b.parent ? 1.5 : 2)); // 兄弟間の距離を少し開ける
        
    treeLayout(root);

    // リンク（線）
    g.selectAll(".link")
        .data(root.links())
        .enter().append("path")
        .attr("class", "link")
        .attr("d", d3.linkHorizontal()
            .x(d => d.y + 0) // ノードのpadding分調整が必要だが一旦0
            .y(d => d.x + 0));

    // ノードグループ作成
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

    // 1. まずテキストを追加（サイズ計測のため）
    node.append("text")
        .attr("dy", 5)
        .attr("x", 10) // 左padding
        .style("text-anchor", "start")
        .text(d => d.data.topic)
        .each(function(d) {
            // テキストのサイズを測ってデータに保存
            d.bbox = this.getBBox();
        });

    // 2. Rectを追加（テキストの下に敷くため insert befor text）
    node.insert("rect", "text")
        .attr("x", 0)
        .attr("y", -15) // テキストの高さに合わせて調整
        .attr("width", d => d.bbox.width + 20) // 左右padding
        .attr("height", 30) // 高さは固定気味でOK、あるいは d.bbox.height + 10
        .attr("class", d => d.data.id === selectedNodeId ? "selected" : "");
        
    // リンクの接続位置修正（Rectのサイズが変わったので、線の開始位置はずらすのが理想だが
    // D3 Treeのデフォルトは中心間接続なので、ここではシンプルに「左端」につなぐ実装のままにします）
}


// --- その他ロジック（ショートカットなど） ---
// ※ここは前回のコードと同じですが、findParentなどのヘルパー関数が必要です。
// 　前回のコードから消えていない前提ですが、念の為重要な部分だけ再掲します。

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

// データ保存
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
    const newText = prompt("編集:", nodeData.topic);
    if(newText !== null && newText.trim() !== "") {
        nodeData.topic = newText;
        renderMap(mapData); // ここで再描画すればRectサイズも再計算される
        saveMapToServer();
    }
}

// キーボードイベント (前回と同じものを貼る)
document.addEventListener('keydown', (e) => {
    if(document.getElementById('map-area').style.display === 'none') return;
    if(e.target.tagName === 'INPUT') return; 
    if (!selectedNodeId) return;
    const selectedNode = findNode(mapData, selectedNodeId);
    if (!selectedNode) return;

    if (e.key === 'Tab') {
        e.preventDefault();
        const newNode = { id: generateId(), topic: "New", children: [] };
        if (!selectedNode.children) selectedNode.children = [];
        selectedNode.children.push(newNode);
        updateMapAndSelect(newNode.id);
    } else if (e.key === 'Enter') {
        e.preventDefault();
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

// Load Data
async function loadData(projectId) {
    if(!projectId) return;
    try {
        const res = await fetch(`/api/data/${projectId}`);
        const data = await res.json();
        mapData = data.map;
        if(!mapData.children) mapData.children = [];
        inboxData = data.inbox;
        renderInbox();
        
        // Mapが可視状態なら描画
        const mapArea = document.getElementById('map-area');
        // display: none でない、かつ親要素(main)が表示されているかチェック
        if(window.getComputedStyle(mapArea).display !== 'none') {
             renderMap(mapData);
        }
    } catch(e) { console.error(e); }
}

// 共通パーツ
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
            mapData = result.new_map;
            loadData(currentProjectId);
        } else { alert('エラー: ' + result.message); }
    } catch (e) { alert('通信エラー'); } 
    finally { btn.innerHTML = originalIcon; btn.disabled = false; }
}

// 初期化
const listEl = document.getElementById('idea-ul');
new Sortable(listEl, { animation: 150 });
const micBtn = document.getElementById('mic-btn');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    micBtn.addEventListener('click', () => {
        if (micBtn.classList.contains('mic-off')) recognition.start(); else recognition.stop();
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
window.onload = () => loadProjects();
window.onresize = () => loadData(currentProjectId);