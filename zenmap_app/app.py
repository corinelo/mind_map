import os
import json
import re
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import google.generativeai as genai

app = Flask(__name__)

# --- 設定 ---
database_url = os.environ.get('DATABASE_URL')
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://")

app.config['SQLALCHEMY_DATABASE_URI'] = database_url or 'sqlite:///zenmap.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# データベース接続が切れた時の再接続設定
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "pool_pre_ping": True,
}
db = SQLAlchemy(app)

# --- Gemini API設定 ---
API_KEY = os.environ.get("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)
    # 【修正】モデル名を変更 (Pro -> Flash)
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    print("【警告】APIキーがありません")

# --- モデル定義 (変更なし) ---
class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    items = db.relationship('InboxItem', backref='project', cascade="all, delete-orphan")
    mindmaps = db.relationship('MindMap', backref='project', cascade="all, delete-orphan")

class InboxItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)

class MindMap(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)

# --- DB初期化 ---
with app.app_context():
    db.create_all()
    # デフォルトプロジェクトの自動作成ロジック
    if not Project.query.first():
        print("Creating default project...")
        default_proj = Project(name="マイ・アイデア")
        db.session.add(default_proj)
        db.session.commit()

# --- ルーティング ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/projects', methods=['GET', 'POST', 'DELETE'])
def handle_projects():
    if request.method == 'POST':
        data = request.json
        name = data.get('name')
        if name:
            new_proj = Project(name=name)
            db.session.add(new_proj)
            db.session.commit()
            return jsonify({"status": "success", "id": new_proj.id})
    
    elif request.method == 'DELETE':
        proj_id = request.args.get('id')
        proj = Project.query.get(proj_id)
        if proj:
            db.session.delete(proj)
            db.session.commit()
            return jsonify({"status": "deleted"})

    projects = Project.query.order_by(Project.created_at).all()
    return jsonify([{"id": p.id, "name": p.name} for p in projects])

@app.route('/api/data/<int:project_id>', methods=['GET'])
def get_project_data(project_id):
    latest_map = MindMap.query.filter_by(project_id=project_id).order_by(MindMap.id.desc()).first()
    map_data = json.loads(latest_map.content) if latest_map else {"id": "root", "topic": "Central Topic", "children": []}
    
    items = InboxItem.query.filter_by(project_id=project_id).order_by(InboxItem.id.desc()).all()
    inbox_list = [{"id": i.id, "text": i.text} for i in items]
    
    return jsonify({"map": map_data, "inbox": inbox_list})

@app.route('/api/inbox', methods=['POST', 'DELETE'])
def handle_inbox():
    if request.method == 'POST':
        data = request.json
        text = data.get('text')
        project_id = data.get('project_id')
        
        # デバッグ用ログ
        print(f"Adding to inbox: {text}, Project ID: {project_id}")

        if text and project_id:
            try:
                new_item = InboxItem(text=text, project_id=project_id)
                db.session.add(new_item)
                db.session.commit()
                return jsonify({"status": "success"})
            except Exception as e:
                print(f"DB Error: {e}")
                return jsonify({"status": "error", "message": str(e)}), 500
        else:
             return jsonify({"status": "error", "message": "Missing text or project_id"}), 400
            
    elif request.method == 'DELETE':
        item_id = request.args.get('id')
        item = InboxItem.query.get(item_id)
        if item:
            db.session.delete(item)
            db.session.commit()
            return jsonify({"status": "deleted"})
            
    return jsonify({"status": "error"})

# --- 修正版のAI処理 ---
@app.route('/api/ai_organize', methods=['POST'])
def ai_organize():
    if not API_KEY:
        return jsonify({"status": "error", "message": "API Key missing"}), 500

    data = request.json
    current_map = data.get('map_data')
    project_id = data.get('project_id')
    
    items = InboxItem.query.filter_by(project_id=project_id).all()
    inbox_texts = [i.text for i in items]

    if not inbox_texts:
        return jsonify({"status": "error", "message": "Inbox is empty"}), 400

    prompt = f"""
    あなたはマインドマップ整理の達人です。
    以下の「現在のマインドマップ構造(JSON)」と、「新しい未整理のアイデアリスト」があります。
    未整理のアイデアを、文脈を理解してマインドマップの適切な枝に追加してください。
    出力は純粋なJSONデータのみにしてください。Markdown記法は不要です。

    【現在のマインドマップ】
    {json.dumps(current_map, ensure_ascii=False)}

    【追加するアイデア】
    {", ".join(inbox_texts)}
    """

    try:
        # 最新モデルを指定
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        text_resp = response.text
        
        # ログにAIの返答を表示（デバッグ用）
        print(f"--- AI Response ---\n{text_resp}\n-------------------")

        match = re.search(r'\{.*\}', text_resp, re.DOTALL)
        if match:
            new_map = json.loads(match.group(0))
            new_map_record = MindMap(content=json.dumps(new_map), project_id=project_id)
            db.session.add(new_map_record)
            for item in items:
                db.session.delete(item)
            db.session.commit()
            return jsonify({"status": "success", "new_map": new_map})
        else:
            raise ValueError("Invalid JSON from AI")

    except Exception as e:
        print(f"AI Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# 4. マップの手動保存 API (新規追加)
@app.route('/api/save_map', methods=['POST'])
def save_map():
    data = request.json
    project_id = data.get('project_id')
    map_content = data.get('map_data')

    if not project_id or not map_content:
        return jsonify({"status": "error", "message": "Missing data"}), 400

    try:
        # 最新のマップとして保存
        new_record = MindMap(content=json.dumps(map_content), project_id=project_id)
        db.session.add(new_record)
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# （これより下の ai_organize や main ブロックは変更なし）
# ...

if __name__ == '__main__':
    app.run(debug=True, port=5000)

