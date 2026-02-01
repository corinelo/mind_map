let currentProjectId = null;
let currentProjectName = "Inbox"; // プロジェクト名を保持
let mapData = {};
let inboxData = [];
let selectedNodeId = null; // 現在選択中のノードID

// --- プロジェクト管理 ---
async function loadProjects() {
    try {
        const res = await fetch('/api/projects');
        const projects = await res.json();
        
        const listEl = document.getElementById('project-list');
        listEl.innerHTML = '';
        
        if (projects.length === 0) {
            // プロジェクトがない場合
            document.getElementById('inbox-title').innerText = "Inbox";
            return;
        }

        projects.forEach(p => {
            const li = document.createElement('li');
            li.className = `project-item ${p.id == currentProjectId ? 'active' : ''}`;
            li.onclick = () => switchProject(p.id, p.name);
            li.innerHTML = `
                <span><i class="fa-solid fa-folder"></i> ${p.name}</span>
                <button class="project-delete-btn" onclick="deleteProject(event, ${p.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
            listEl.appendChild(li);
        });

        // 初回またはリロード時の選択復帰
        if (!currentProjectId && projects.length > 0) {
            switchProject(projects[0].id, projects[0].name);
        } else if (currentProjectId) {
            // プロジェクト名を更新
            const current = projects.find(p => p.id == currentProjectId);
            if(current) switchProject(current.id, current.name);
        }

    } catch(e) { console.error("Project Load Error:", e); }
}

function switchProject(id, name) {
    currentProjectId = id;
    currentProjectName = name;
    
    // Inboxのタイトルを変更
    document.getElementById('inbox-title').innerText = name || "Inbox";
    
    loadData(id);
    
    // リストのハイライト更新
    const listEl = document.getElementById('project-list');
    Array.from(listEl.children).forEach(li => li.classList.remove('active'));
    // 簡易的な再描画待ち（本来はIDで検索してクラス付与がベスト）
    setTimeout(() => {
        // 再ロードせずにクラスだけ付け替えたいが、今回はloadProjectsで再描画されるのでお任せ
    }, 0);
    loadProjects(); 
    document.getElementById('project-sidebar').classList.remove('active');
}

// ... (createProject, deleteProject は変更なし。そのまま使えますが、loadProjectsを呼んでいるのでOK) ...
async function createProject() {
    const name = prompt("新しいプロジェクト名:");
    if(!name) return;
    await fetch('/api/projects', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name: name })
    });
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const newP = projects[projects.length-1];
    switchProject(newP.id, newP.name);
}
async function deleteProject(event, id) {
    event.stopPropagation();
    if(!confirm("削除しますか？")) return;
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
    if(currentProjectId == id) currentProjectId = null;
    loadProjects();
}

// --- データ読み込み & 保存 ---
async function loadData(projectId) {
    if(!projectId) return;
    try {
        const res = await fetch(`/api/data/${projectId}`);
        const data = await res.json();
        
        // データ構造の正規化（topicがない場合nameを使うなど）
        mapData = data.map;
        if(!mapData.children) mapData.children = [];
        
        inboxData = data.inbox;
        renderInbox();
        
        const mapSvg = document.getElementById('mindmap-svg');
        if(mapSvg.parentElement.style.display !== 'none') {
            renderMap(mapData);
        }
    } catch(e) { console.error(e); }
}

// マップの手動変更をサーバーに保存
async function saveMapToServer() {
    if(!currentProjectId) return;
    try {
        await fetch('/api/save_map', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ project_id: currentProjectId, map_data: mapData })
        });
        console.log("Map saved.");
    } catch(e) { console.error("Save failed", e); }
}

// --- マインドマップ操作ロジック (Core) ---

// 再帰的にノードを探す関数
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

// 親ノードを探す関数
function findParent(root, id) {
    if (!root.children) return null;
    for (let child of root.children) {
        if (child.id === id) return root;
        const found = findParent(child, id);
        if (found) return found;
    }
    return null;
}

// ユニークID生成
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

// キーボードショートカット
document.addEventListener('keydown', (e) => {
    // マップが表示されていない、または入力中は無視
    if(document.getElementById('map-area').style.display === 'none') return;
    if(e.target.tagName === 'INPUT') return; 

    if (!selectedNodeId) return;

    const selectedNode = findNode(mapData, selectedNodeId);
    if (!selectedNode) return;

    // Tab: 子ノード追加
    if (e.key === 'Tab') {
        e.preventDefault(); // フォーカス移動防止
        const newNode = { id: generateId(), topic: "New Idea", children: [] };
        if (!selectedNode.children) selectedNode.children = [];
        selectedNode.children.push(newNode);
        updateMapAndSelect(newNode.id);
    }
    
    // Enter: 兄弟ノード追加 (ルートの場合は子を追加)
    else if (e.key === 'Enter') {
        e.preventDefault();
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            const newNode = { id: generateId(), topic: "New Idea", children: [] };
            parent.children.push(newNode);
            updateMapAndSelect(newNode.id);
        } else {
            // ルートを選択中はTabと同じ挙動（子を追加）
            const newNode = { id: generateId(), topic: "New Idea", children: [] };
            if (!selectedNode.children) selectedNode.children = [];
            selectedNode.children.push(newNode);
            updateMapAndSelect(newNode.id);
        }
    }

    // Backspace / Delete: 削除
    else if (e.key === 'Backspace' || e.key === 'Delete') {
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            parent.children = parent.children.filter(n => n.id !== selectedNodeId);
            selectedNodeId = parent.id; // 親を選択状態に
            updateMapAndSelect(selectedNodeId);
        } else {
            alert("ルートノードは削除できません");
        }
    }

    // Space: 編集モード開始
    else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        editNodeText(selectedNodeId);
    }
});

function updateMapAndSelect(newId) {
    selectedNodeId = newId;
    renderMap(mapData);
    saveMapToServer(); // 変更を保存
}
// キーボードショートカット
document.addEventListener('keydown', (e) => {
    // マップが表示されていない、または入力中は無視
    if(document.getElementById('map-area').style.display === 'none') return;
    if(e.target.tagName === 'INPUT') return; 

    if (!selectedNodeId) return;

    const selectedNode = findNode(mapData, selectedNodeId);
    if (!selectedNode) return;

    // --- 構造編集 (Tab/Enter/Delete/Space) ---

    // Tab: 子ノード追加
    if (e.key === 'Tab') {
        e.preventDefault();
        const newNode = { id: generateId(), topic: "New Idea", children: [] };
        if (!selectedNode.children) selectedNode.children = [];
        selectedNode.children.push(newNode);
        updateMapAndSelect(newNode.id);
    }
    
    // Enter: 兄弟ノード追加
    else if (e.key === 'Enter') {
        e.preventDefault();
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            const newNode = { id: generateId(), topic: "New Idea", children: [] };
            parent.children.push(newNode);
            updateMapAndSelect(newNode.id);
        } else {
            // ルートの場合
            const newNode = { id: generateId(), topic: "New Idea", children: [] };
            if (!selectedNode.children) selectedNode.children = [];
            selectedNode.children.push(newNode);
            updateMapAndSelect(newNode.id);
        }
    }

    // Backspace / Delete: 削除
    else if (e.key === 'Backspace' || e.key === 'Delete') {
        const parent = findParent(mapData, selectedNodeId);
        if (parent) {
            parent.children = parent.children.filter(n => n.id !== selectedNodeId);
            selectedNodeId = parent.id;
            updateMapAndSelect(selectedNodeId);
        } else {
            alert("ルートノードは削除できません");
        }
    }

    // Space: 編集
    else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        editNodeText(selectedNodeId);
    }

    // --- 矢印キー移動 (New!) ---

    else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const parent = findParent(mapData, selectedNodeId);

        // ← (Left): 親へ移動
        if (e.key === 'ArrowLeft') {
            if (parent) {
                selectedNodeId = parent.id;
                renderMap(mapData);
            }
        }
        // → (Right): 最初の子へ移動
        else if (e.key === 'ArrowRight') {
            if (selectedNode.children && selectedNode.children.length > 0) {
                // 真ん中の子を選ぶと直感的だが、まずは最初の子へ
                selectedNodeId = selectedNode.children[0].id;
                renderMap(mapData);
            }
        }
        // ↑ (Up): 前の兄弟へ移動
        else if (e.key === 'ArrowUp') {
            if (parent) {
                const index = parent.children.findIndex(c => c.id === selectedNodeId);
                if (index > 0) {
                    selectedNodeId = parent.children[index - 1].id;
                    renderMap(mapData);
                }
            }
        }
        // ↓ (Down): 次の兄弟へ移動
        else if (e.key === 'ArrowDown') {
            if (parent) {
                const index = parent.children.findIndex(c => c.id === selectedNodeId);
                if (index < parent.children.length - 1) {
                    selectedNodeId = parent.children[index + 1].id;
                    renderMap(mapData);
                }
            }
        }
    }
});

// ノード名編集機能
function editNodeText(nodeId) {
    const nodeData = findNode(mapData, nodeId);
    if(!nodeData) return;

    // SVG上のノードの位置を探す
    const svgNode = d3.selectAll('.node').filter(d => d.data.id === nodeId).node();
    if(!svgNode) return;
    
    // 座標取得
    const transform = svgNode.getAttribute('transform');
    const translate = transform.match(/translate\(([^,]+),([^)]+)\)/);
    const x = parseFloat(translate[1]);
    const y = parseFloat(translate[2]);

    // 入力ボックスを生成して重ねる
    let input = document.getElementById('node-editor');
    if(!input) {
        input = document.createElement('input');
        input.id = 'node-editor';
        document.getElementById('map-area').appendChild(input);
    }

    // ズーム倍率などを考慮して位置合わせ（簡易実装）
    // ※D3のズーム状態を取得して計算するのは複雑なので、
    // 今回はシンプルに「画面中央付近のプロンプト」でも良いが、
    // 頑張ってCSS Overlayで実装します。
    
    // 一旦、シンプルに標準の prompt を使います（スマホでも安定するため）
    // 入力ボックスでのリッチな編集は、D3の座標変換が複雑なため次回以降の課題とします
    const newText = prompt("アイデアを編集:", nodeData.topic);
    if(newText !== null && newText.trim() !== "") {
        nodeData.topic = newText;
        updateMapAndSelect(nodeId);
    }
}


// --- 描画 (D3.js) ---
function renderMap(data) {
    const svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove(); // クリア
    
    const container = document.getElementById('map-area');
    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");
    
    // ズーム機能
    const zoom = d3.zoom().on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);

    // データ階層化
    const root = d3.hierarchy(data);
    const treeLayout = d3.tree().size([height - 100, width - 300]); // 少し幅に余裕を
    treeLayout(root);

    // リンク描画
    g.selectAll(".link")
        .data(root.links())
        .enter().append("path")
        .attr("class", "link")
        .attr("d", d3.linkHorizontal().x(d => d.y + 100).y(d => d.x + 50));

    // ノード描画
    const node = g.selectAll(".node")
        .data(root.descendants())
        .enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.y + 100},${d.x + 50})`)
        .on("click", (event, d) => {
            // クリックで選択
            event.stopPropagation(); // 背景クリックと区別
            selectedNodeId = d.data.id;
            renderMap(mapData); // 再描画してスタイル適用
        })
        .on("dblclick", (event, d) => {
            // ダブルクリックで編集
            event.stopPropagation();
            editNodeText(d.data.id);
        });

    // ノードの四角形
    node.append("rect")
        .attr("width", 140) // 少し広く
        .attr("height", 40)
        .attr("y", -20)
        .attr("x", 0)
        .attr("class", d => d.data.id === selectedNodeId ? "selected" : ""); // 選択クラス

    // テキスト
    node.append("text")
        .attr("dy", 5)
        .attr("x", 10)
        .text(d => d.data.topic)
        .style("pointer-events", "none"); // テキスト上のクリックもノードクリック扱いにする
}

// 背景クリックで選択解除
document.getElementById('map-area').addEventListener('click', () => {
    // selectedNodeId = null; 
    // renderMap(mapData);
    // 好みによりますが、解除しないほうが連続操作しやすいのでコメントアウト
});


// --- その他の機能（Inboxなど）は既存維持 ---
// (saveToInbox, deleteItem, organizeWithAI, sortable, speechなどは
//  前回のコードのまま使えますが、ここではスペースの都合上省略します。
//  `loadData`などは上で書き換えたものを使ってください)

// --- 必須の既存関数群 (コピペ用) ---
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

window.onload = loadProjects;
window.onresize = () => loadData(currentProjectId);