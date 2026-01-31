let currentProjectId = null;
let mapData = {};
let inboxData = [];

// --- プロジェクト管理 ---
async function loadProjects() {
    try {
        const res = await fetch('/api/projects');
        const projects = await res.json();
        
        const listEl = document.getElementById('project-list');
        listEl.innerHTML = '';
        
        // リスト描画
        projects.forEach(p => {
            const li = document.createElement('li');
            li.className = `project-item ${p.id == currentProjectId ? 'active' : ''}`;
            li.onclick = () => switchProject(p.id);
            li.innerHTML = `
                <span><i class="fa-solid fa-folder"></i> ${p.name}</span>
                <button class="project-delete-btn" onclick="deleteProject(event, ${p.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
            listEl.appendChild(li);
        });

        // 【修正】: まだプロジェクトが選ばれていない場合、強制的に先頭を選ぶ
        if (projects.length > 0) {
            if (!currentProjectId) {
                console.log("Auto-selecting first project:", projects[0].id);
                switchProject(projects[0].id);
            }
        } else {
            // 万が一プロジェクトが0個なら、作成を促すか自動作成する
            console.warn("No projects found.");
        }

    } catch(e) { console.error("Project Load Error:", e); }
}

async function createProject() {
    const name = prompt("新しいプロジェクト名:");
    if(!name) return;
    
    await fetch('/api/projects', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name: name })
    });
    // 最新のを取得して切り替え
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const newId = projects[projects.length-1].id;
    switchProject(newId);
    
    document.getElementById('project-sidebar').classList.remove('active');
}

async function deleteProject(event, id) {
    event.stopPropagation();
    if(!confirm("削除しますか？")) return;
    
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
    if(currentProjectId == id) currentProjectId = null;
    loadProjects();
}

function switchProject(id) {
    currentProjectId = id;
    console.log("Switched to project:", id);
    loadData(id);
    // UI更新（再描画せずクラス付替だけで軽量化）
    const listEl = document.getElementById('project-list');
    Array.from(listEl.children).forEach((li, index) => {
       // インデックスとIDのマッチングは簡易的なため、loadProjectsを再呼出するのが確実
    });
    loadProjects(); 
    document.getElementById('project-sidebar').classList.remove('active');
}

// --- データ保存 ---
async function saveToInbox(text) {
    // 【修正】プロジェクトIDがない場合のガード
    if(!currentProjectId) {
        alert("プロジェクトが読み込まれていません。リロードしてください。");
        return;
    }
    if(!text) return;

    try {
        await fetch('/api/inbox', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: text, project_id: currentProjectId })
        });
        loadData(currentProjectId);
        document.getElementById('manual-input').value = '';
    } catch(e) {
        console.error("Save Error:", e);
        alert("保存に失敗しました");
    }
}

// --- 以下、既存ロジック ---

// サイドバー開閉
function toggleProjectSidebar() { document.getElementById('project-sidebar').classList.toggle('active'); }
function toggleInboxSidebar() {
    const inbox = document.getElementById('inbox-sidebar');
    const openBtn = document.getElementById('open-inbox-btn');
    if (inbox.style.display === 'none') {
        inbox.style.display = 'flex';
        openBtn.style.display = 'none';
    } else {
        inbox.style.display = 'none';
        openBtn.style.display = 'block';
    }
}

// データロード
async function loadData(projectId) {
    if(!projectId) return;
    try {
        const res = await fetch(`/api/data/${projectId}`);
        const data = await res.json();
        mapData = data.map;
        inboxData = data.inbox;
        renderInbox();
        const mapSvg = document.getElementById('mindmap-svg');
        if(mapSvg.parentElement.style.display !== 'none') {
            renderMap(mapData);
        }
    } catch(e) { console.error(e); }
}

async function deleteItem(id) {
    await fetch(`/api/inbox?id=${id}`, { method: 'DELETE' });
    loadData(currentProjectId);
}

// AI
async function organizeWithAI() {
    if(inboxData.length === 0) return alert("Inboxが空です");
    const btn = document.getElementById('ai-btn');
    const originalIcon = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const res = await fetch('/api/ai_organize', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ map_data: mapData, project_id: currentProjectId })
        });
        const result = await res.json();
        if (result.status === 'success') {
            mapData = result.new_map;
            loadData(currentProjectId);
            alert("マップを更新しました！");
        } else {
            alert('AIエラー: ' + result.message);
        }
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

function renderInbox() {
    const ul = document.getElementById('idea-ul');
    ul.innerHTML = '';
    if(inboxData.length === 0) {
        document.getElementById('empty-state').style.display = 'block';
    } else {
        document.getElementById('empty-state').style.display = 'none';
        inboxData.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${item.text}</span><button class="delete-btn" onclick="deleteItem(${item.id})"><i class="fa-solid fa-trash"></i></button>`;
            ul.appendChild(li);
        });
    }
}

// D3 Map (省略なし)
function renderMap(data) {
    const svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove();
    const container = document.getElementById('map-area');
    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr("width", width).attr("height", height);
    const g = svg.append("g");
    svg.call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)));
    const root = d3.hierarchy(data);
    const treeLayout = d3.tree().size([height - 100, width - 200]);
    treeLayout(root);
    g.selectAll(".link").data(root.links()).enter().append("path").attr("class", "link").attr("d", d3.linkHorizontal().x(d => d.y + 50).y(d => d.x + 50));
    const node = g.selectAll(".node").data(root.descendants()).enter().append("g").attr("class", "node").attr("transform", d => `translate(${d.y + 50},${d.x + 50})`);
    node.append("rect").attr("width", 120).attr("height", 40).attr("y", -20).attr("x", 0);
    node.append("text").attr("dy", 5).attr("x", 10).text(d => d.data.topic);
}

window.onload = loadProjects;
window.onresize = () => loadData(currentProjectId);
