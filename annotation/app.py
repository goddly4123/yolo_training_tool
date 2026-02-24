from flask import Flask, jsonify, send_file, request, abort
from pathlib import Path
from datetime import datetime
import shutil
import time
import yaml
import json
import subprocess
import threading
import sys

app = Flask(__name__)

BASE_DIR = Path(__file__).parent.parent
IMAGES_DIR     = BASE_DIR / "to_annotate" / "images"
LABELS_DIR     = BASE_DIR / "to_annotate" / "labels"
TRASH_DIR      = BASE_DIR / "to_annotate" / ".trash"
DATASET_YAML   = BASE_DIR / "dataset.yaml"
CLIPBOARD_FILE = Path(__file__).parent / "clipboard.json"
RUNS_DIR       = BASE_DIR / "runs"
VALID_EXT      = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

MAX_TRASH = 10
# Each entry: {'original': str, 'trash_img': Path, 'trash_label': Path | None}
_trash_stack: list[dict] = []


def _evict_oldest():
    """Permanently delete the oldest item when trash exceeds MAX_TRASH."""
    if len(_trash_stack) >= MAX_TRASH:
        old = _trash_stack.pop(0)
        old['trash_img'].unlink(missing_ok=True)
        if old['trash_label']:
            old['trash_label'].unlink(missing_ok=True)


@app.route('/api/images')
def list_images():
    if not IMAGES_DIR.exists():
        return jsonify([])
    files = sorted(
        f.name for f in IMAGES_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in VALID_EXT
    )
    return jsonify(files)


@app.route('/api/images/<path:filename>')
def get_image(filename):
    path = IMAGES_DIR / filename
    if not path.exists() or not path.is_file():
        abort(404)
    return send_file(path)


@app.route('/api/labels/<path:filename>', methods=['GET'])
def get_labels(filename):
    label_path = LABELS_DIR / (Path(filename).stem + '.txt')
    if not label_path.exists():
        return jsonify([])
    boxes = []
    for line in label_path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) == 5:
            try:
                boxes.append({
                    'class_id': int(parts[0]),
                    'x': float(parts[1]),
                    'y': float(parts[2]),
                    'w': float(parts[3]),
                    'h': float(parts[4]),
                })
            except ValueError:
                continue
    return jsonify(boxes)


@app.route('/api/labels/<path:filename>', methods=['DELETE'])
def delete_labels(filename):
    label_path = LABELS_DIR / (Path(filename).stem + '.txt')
    if label_path.exists():
        label_path.unlink()
    return jsonify({'status': 'ok'})


@app.route('/api/labels/<path:filename>', methods=['POST'])
def save_labels(filename):
    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    boxes = request.get_json() or []
    label_path = LABELS_DIR / (Path(filename).stem + '.txt')
    lines = [
        f"{b['class_id']} {b['x']:.6f} {b['y']:.6f} {b['w']:.6f} {b['h']:.6f}"
        for b in boxes
    ]
    label_path.write_text('\n'.join(lines) + ('\n' if lines else ''))
    return jsonify({'status': 'ok'})


@app.route('/api/images/<path:filename>', methods=['DELETE'])
def delete_image(filename):
    img_path = IMAGES_DIR / filename
    label_path = LABELS_DIR / (Path(filename).stem + '.txt')
    if not img_path.exists() or not img_path.is_file():
        abort(404)

    trash_img_dir = TRASH_DIR / 'images'
    trash_lbl_dir = TRASH_DIR / 'labels'
    trash_img_dir.mkdir(parents=True, exist_ok=True)
    trash_lbl_dir.mkdir(parents=True, exist_ok=True)

    prefix = str(int(time.time() * 1000))
    stem = Path(filename).stem
    ext  = Path(filename).suffix

    trash_img   = trash_img_dir / f"{prefix}_{stem}{ext}"
    trash_label = None

    img_path.rename(trash_img)

    if label_path.exists():
        trash_label = trash_lbl_dir / f"{prefix}_{stem}.txt"
        label_path.rename(trash_label)

    _evict_oldest()
    _trash_stack.append({
        'original':    filename,
        'trash_img':   trash_img,
        'trash_label': trash_label,
    })

    return jsonify({'status': 'ok', 'trash_count': len(_trash_stack)})


@app.route('/api/undo-delete', methods=['POST'])
def undo_delete():
    if not _trash_stack:
        return jsonify({'status': 'empty'}), 200

    entry = _trash_stack.pop()
    original  = entry['original']
    trash_img = entry['trash_img']
    trash_lbl = entry['trash_label']

    dest_img = IMAGES_DIR / original
    dest_lbl = LABELS_DIR / (Path(original).stem + '.txt')

    if not dest_img.exists():
        trash_img.rename(dest_img)
    else:
        trash_img.unlink(missing_ok=True)

    if trash_lbl and not dest_lbl.exists():
        trash_lbl.rename(dest_lbl)
    elif trash_lbl:
        trash_lbl.unlink(missing_ok=True)

    return jsonify({'status': 'ok', 'filename': original, 'trash_count': len(_trash_stack)})


@app.route('/api/save-for-training', methods=['POST'])
def save_for_training():
    if not IMAGES_DIR.exists():
        return jsonify({'status': 'error', 'message': '이미지 폴더가 없습니다'}), 400

    def has_valid_annotations(lbl_path):
        """라벨 파일에 유효한 YOLO 어노테이션(클래스+좌표)이 1개 이상 있는지 확인."""
        if not lbl_path.exists():
            return False
        for line in lbl_path.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) == 5:
                try:
                    int(parts[0])
                    float(parts[1]); float(parts[2]); float(parts[3]); float(parts[4])
                    return True
                except ValueError:
                    continue
        return False

    pairs = [
        (f, LABELS_DIR / (f.stem + '.txt'))
        for f in IMAGES_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in VALID_EXT
    ]
    pairs = [(img, lbl) for img, lbl in pairs if has_valid_annotations(lbl)]
    if not pairs:
        return jsonify({'status': 'nodata', 'message': 'No annotated images found'}), 400

    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    dest_dir = BASE_DIR / 'BASE_data' / timestamp
    dest_images = dest_dir / 'images'
    dest_labels = dest_dir / 'labels'
    dest_images.mkdir(parents=True, exist_ok=True)
    dest_labels.mkdir(parents=True, exist_ok=True)

    moved = 0
    for img, lbl in pairs:
        shutil.move(str(img), str(dest_images / img.name))
        shutil.move(str(lbl), str(dest_labels / lbl.name))
        moved += 1

    return jsonify({'status': 'ok', 'moved': moved, 'folder': timestamp})


@app.route('/api/annotations-status')
def annotations_status():
    if not IMAGES_DIR.exists():
        return jsonify({})
    result = {}
    for f in IMAGES_DIR.iterdir():
        if f.is_file() and f.suffix.lower() in VALID_EXT:
            label_path = LABELS_DIR / (f.stem + '.txt')
            result[f.name] = label_path.exists()
    return jsonify(result)


@app.route('/api/clipboard', methods=['GET'])
def get_clipboard():
    if not CLIPBOARD_FILE.exists():
        return jsonify({})
    try:
        return jsonify(json.loads(CLIPBOARD_FILE.read_text(encoding='utf-8')))
    except Exception:
        return jsonify({})


@app.route('/api/clipboard', methods=['POST'])
def save_clipboard():
    data = request.get_json() or {}
    try:
        CLIPBOARD_FILE.write_text(json.dumps(data), encoding='utf-8')
    except Exception:
        pass
    return jsonify({'status': 'ok'})


@app.route('/api/classes', methods=['GET'])
def get_classes():
    if not DATASET_YAML.exists():
        return jsonify({})
    with open(DATASET_YAML) as f:
        data = yaml.safe_load(f) or {}
    names = data.get('names', {})
    if isinstance(names, list):
        result = {str(i): n for i, n in enumerate(names)}
    else:
        result = {str(k): v for k, v in names.items()}
    return jsonify(result)


@app.route('/api/classes', methods=['POST'])
def save_classes():
    classes = request.get_json() or {}
    if DATASET_YAML.exists():
        with open(DATASET_YAML) as f:
            data = yaml.safe_load(f) or {}
    else:
        data = {'path': './DATA', 'train': 'images/train', 'val': 'images/val'}
    names = {int(k): v for k, v in classes.items()}
    data['names'] = dict(sorted(names.items()))
    data['nc'] = len(names)
    with open(DATASET_YAML, 'w') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    return jsonify({'status': 'ok'})


@app.route('/api/runs')
def list_runs():
    if not RUNS_DIR.exists():
        return jsonify([])
    result = []
    for d in sorted(RUNS_DIR.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        best = d / 'weights' / 'best.pt'
        last = d / 'weights' / 'last.pt'
        if best.exists():
            result.append({'name': d.name, 'weight': str(best), 'weight_type': 'best'})
        elif last.exists():
            result.append({'name': d.name, 'weight': str(last), 'weight_type': 'last'})
    return jsonify(result)


@app.route('/api/download-weight', methods=['GET'])
def download_weight():
    weight_path = request.args.get('path', '')
    pt_file = Path(weight_path)
    if not pt_file.exists() or pt_file.suffix != '.pt':
        return jsonify({'status': 'error', 'message': '파일 없음'}), 404
    # Only allow files inside RUNS_DIR for safety
    try:
        pt_file.resolve().relative_to(RUNS_DIR.resolve())
    except ValueError:
        return jsonify({'status': 'error', 'message': '접근 불가'}), 403
    return send_file(str(pt_file), as_attachment=True, download_name=pt_file.name)


@app.route('/api/runs/<name>', methods=['DELETE'])
def delete_run(name):
    run_dir = RUNS_DIR / name
    try:
        run_dir.resolve().relative_to(RUNS_DIR.resolve())
    except ValueError:
        return jsonify({'status': 'error', 'message': '접근 불가'}), 403
    if not run_dir.exists() or not run_dir.is_dir():
        return jsonify({'status': 'error', 'message': '폴더 없음'}), 404
    shutil.rmtree(str(run_dir))
    return jsonify({'status': 'ok'})


@app.route('/api/predict', methods=['POST'])
def run_predict():
    data = request.get_json() or {}
    filename = data.get('filename')
    weight   = data.get('weight')
    conf     = float(data.get('conf', 0.25))
    iou      = float(data.get('iou',  0.45))
    if not filename or not weight:
        return jsonify({'status': 'error', 'message': '파라미터 누락'}), 400
    img_path = IMAGES_DIR / filename
    if not img_path.exists():
        return jsonify({'status': 'error', 'message': '이미지 없음'}), 404
    try:
        from ultralytics import YOLO
        model   = YOLO(weight)
        results = model.predict(str(img_path), conf=conf, iou=iou, verbose=False)
        boxes   = []
        for r in results:
            for box in r.boxes:
                xc, yc, w, h = box.xywhn[0].tolist()
                boxes.append({
                    'class_id': int(box.cls[0]),
                    'x': round(xc, 6),
                    'y': round(yc, 6),
                    'w': round(w,  6),
                    'h': round(h,  6),
                })
        return jsonify({'status': 'ok', 'boxes': boxes})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


_train_state = {
    'status': 'idle',   # 'idle' | 'running' | 'done' | 'error' | 'stopped'
    'lines':  [],
    'process': None,
}
_train_lock = threading.Lock()


def _run_training(env: dict):
    train_script = BASE_DIR / 'train.py'
    full_env = {**__import__('os').environ, **env}
    try:
        proc = subprocess.Popen(
            [sys.executable, str(train_script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=full_env,
        )
        with _train_lock:
            _train_state['process'] = proc
        for line in proc.stdout:
            with _train_lock:
                _train_state['lines'].append(line.rstrip())
        proc.wait()
        with _train_lock:
            _train_state['process'] = None
            _train_state['status'] = 'done' if proc.returncode == 0 else 'error'
    except Exception as e:
        with _train_lock:
            _train_state['lines'].append(f'[error] {e}')
            _train_state['process'] = None
            _train_state['status'] = 'error'


@app.route('/api/train/start', methods=['POST'])
def train_start():
    with _train_lock:
        if _train_state['status'] == 'running':
            return jsonify({'status': 'error', 'message': 'Already running'}), 409
        _train_state['status'] = 'running'
        _train_state['lines'] = []
        _train_state['process'] = None

    data = request.get_json() or {}
    env = {}
    for key, envvar in [
        ('model',     'TRAIN_MODEL'),
        ('epochs',    'TRAIN_EPOCHS'),
        ('patience',  'TRAIN_PATIENCE'),
        ('imgSize',   'TRAIN_IMG_SIZE'),
        ('batchSize', 'TRAIN_BATCH'),
        ('device',    'TRAIN_DEVICE'),
    ]:
        if key in data and str(data[key]).strip() != '':
            env[envvar] = str(data[key])

    t = threading.Thread(target=_run_training, args=(env,), daemon=True)
    t.start()
    return jsonify({'status': 'ok'})


@app.route('/api/train/log')
def train_log():
    offset = int(request.args.get('offset', 0))
    with _train_lock:
        lines  = _train_state['lines'][offset:]
        status = _train_state['status']
        total  = len(_train_state['lines'])
    return jsonify({'status': status, 'lines': lines, 'total': total})


@app.route('/api/train/stop', methods=['POST'])
def train_stop():
    with _train_lock:
        proc = _train_state['process']
        if proc:
            proc.terminate()
            _train_state['status'] = 'stopped'
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    print("Flask 서버: http://localhost:5001")
    app.run(debug=True, port=5001, host='0.0.0.0')
