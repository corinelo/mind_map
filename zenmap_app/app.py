import os
import json
import re
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import google.generativeai as genai

app = Flask(__name__)

# --- 設定: Renderの環境変数DATABASE_URLがあればそれを使い、なければローカルSQLiteを使う ---
database_url = os.environ.get('DATABASE_URL')
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://") # Render仕様対応

app.config['SQLALCHEMY_DATABASE_URI'] = database_url or 'sqlite:///zenmap.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- Gemini API設定 ---
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("【警告】GEMINI_API_KEYが設定されていません！AI機能は動きません。")
else:
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-pro')

# --- データベースモデル ---
class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # リレーション
    items = db.relationship('InboxItem', backref='project', cascade="all, delete-orphan")
    mindmaps = db.relationship('MindMap', backref='project', cascade="all, delete-orphan")

class InboxItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)

class MindMap(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False) # JSON string
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)

# DB初期化（アプリ起動時）
with app.app_context():
    db.create_all()
    # デフォルトプロジェクトがない場合作成
    if not Project.query.first():
        default_proj = Project(name="マイ・アイデア")
        db.session.add(default_proj)
        db.session.commit()

# --- ルーティング ---

@app.route('/')
def index():
    return render_template('index.html')

# 1. プロジェクト一覧・作成・削除
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

# 2. データの取得・保存（プロジェクトID必須）
@app.route('/api/data/<int:project_id>', methods=['GET'])
def get_project_data(project_id):
    # 最新マップ
    latest_map = MindMap.query.filter_by(project_id=project_id).order_by(MindMap.id.desc()).first()
    map_data = json.loads(latest_map.content) if latest_map else {"id": "root", "topic": "Central Topic", "children": []}
    
    # Inboxアイテム
    items = InboxItem.query.filter_by(project_id=project_id).order_by(InboxItem.id.desc()).all()
    inbox_list = [{"id": i.id, "text": i.text} for i in items]
    
    return jsonify({"map": map_data, "inbox": inbox_list})

@app.route('/api/inbox', methods=['POST', 'DELETE'])
def handle_inbox():
    if request.method == 'POST':
        data = request.json
        text = data.get('text')
        project_id = data.get('project_id')
        if text and project_id:
            new_item = InboxItem(text=text, project_id=project_id)
            db.session.add(new_item)
            db.session.commit()
            return jsonify({"status": "success"})
            
    elif request.method == 'DELETE':
        item_id = request.args.get('id')
        item = InboxItem.query.get(item_id)
        if item:
            db.session.delete(item)
            db.session.commit()
            return jsonify({"status": "deleted"})
            
    return jsonify({"status": "error"})

# 3. AI処理（エラーハンドリング強化）
@app.route('/api/ai_organize', methods=['POST'])
def ai_organize():
    if not API_KEY:
        return jsonify({"status": "error", "message": "APIキーがサーバーに設定されていません"}), 500

    data = request.json
    current_map = data.get('map_data')
    project_id = data.get('project_id')
    
    # プロジェクトに紐づくInboxを取得
    items = InboxItem.query.filter_by(project_id=project_id).all()
    inbox_texts = [i.text for i in items]

    if not inbox_texts:
        return jsonify({"status": "error", "message": "Inboxが空です"}), 400

    prompt = f"""
    あなたはマインドマップ整理の達人です。
    以下の「現在のマインドマップ構造(JSON)」と、「新しい未整理のアイデアリスト」があります。
    未整理のアイデアを、文脈を理解してマインドマップの適切な枝に追加してください。
    
    【重要ルール】
    1. 出力は純粋なJSONデータのみにしてください。
    2. Markdown記法(```json ... ```)や挨拶文は一切不要です。
    3. JSONの構造は以下の形式を守ってください:
       {{ "id": "...", "topic": "...", "children": [ ... ] }}

    【現在のマインドマップ】
    {json.dumps(current_map, ensure_ascii=False)}

    【追加するアイデア】
    {", ".join(inbox_texts)}
    """

    try:
        response = model.generate_content(prompt)
        text_resp = response.text
        
        # ログにAIの返答を表示（デバッグ用）
        print(f"--- AI Response ---\n{text_resp}\n-------------------")

        match = re.search(r'\{.*\}', text_resp, re.DOTALL)
        if match:
            json_str = match.group(0)
            new_map = json.loads(json_str)
            
            # 保存
            new_map_record = MindMap(content=json.dumps(new_map), project_id=project_id)
            db.session.add(new_map_record)
            
            # Inboxを空にする
            for item in items:
                db.session.delete(item)
                
            db.session.commit()
            return jsonify({"status": "success", "new_map": new_map})
        else:
            raise ValueError("AIがJSON以外の形式を返しました")

    except Exception as e:
        print(f"AI Error Detail: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':

    app.run(debug=True, port=5000)
