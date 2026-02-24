"""
YOLOv12 학습 스크립트
사용법: uv run train.py

데이터 흐름:
  1. BASE_data/<날짜시간>/images+labels 에서 전체 데이터 수집
  2. 셔플 후 8:2 분할 → DATA/images/train+val, DATA/labels/train+val 로 복사
  3. 학습 실행
  4. 학습 완료(또는 오류) 후 DATA/ 임시 파일 자동 정리
"""
import os
import random
import shutil
from datetime import datetime
from pathlib import Path

from ultralytics import YOLO

# =============================================
# 설정 - 여기만 수정하면 됩니다 (환경변수로 오버라이드 가능)
# =============================================

MODEL      = os.environ.get('TRAIN_MODEL',    "yolo12n.pt")  # 기본 모델 (n/s/m/l/x)
DATA_YAML  = "dataset.yaml"

EPOCHS     = int(os.environ.get('TRAIN_EPOCHS',   100))
PATIENCE   = int(os.environ.get('TRAIN_PATIENCE',  20))   # 조기 종료 (0 = 비활성화)
IMG_SIZE   = int(os.environ.get('TRAIN_IMG_SIZE', 640))
BATCH_SIZE = int(os.environ.get('TRAIN_BATCH',     16))
DEVICE     = os.environ.get('TRAIN_DEVICE',       "")      # "" = 자동, "cpu", "0" = GPU
PROJECT    = "runs"

# =============================================

BASE_DIR  = Path(__file__).parent
BASE_DATA = BASE_DIR / "BASE_data"
DATA_DIR  = BASE_DIR / "DATA"
VALID_EXT = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}


# ── 데이터 수집 ───────────────────────────────────────────────────────────────

def collect_pairs() -> list[tuple[Path, Path | None]]:
    """BASE_data/ 하위 모든 배치에서 (이미지, 라벨|None) 쌍 수집."""
    pairs: list[tuple[Path, Path | None]] = []
    if not BASE_DATA.exists():
        return pairs
    for batch in sorted(BASE_DATA.iterdir()):
        if not batch.is_dir():
            continue
        img_dir = batch / 'images'
        lbl_dir = batch / 'labels'
        if not img_dir.exists():
            continue
        for img in sorted(img_dir.iterdir()):
            if img.is_file() and img.suffix.lower() in VALID_EXT:
                lbl = lbl_dir / (img.stem + '.txt')
                pairs.append((img, lbl if lbl.exists() else None))
    return pairs


# ── DATA/ 복사 ────────────────────────────────────────────────────────────────

def _unique_copy(src: Path, dest_dir: Path) -> Path:
    """src 를 dest_dir 로 복사. 이름 충돌 시 _1, _2 … 접미사 추가."""
    dest = dest_dir / src.name
    if dest.exists():
        n = 1
        while True:
            candidate = dest_dir / f"{src.stem}_{n}{src.suffix}"
            if not candidate.exists():
                dest = candidate
                break
            n += 1
    shutil.copy2(src, dest)
    return dest


def prepare_data(pairs: list) -> tuple[int, int]:
    """셔플 → 8:2 분할 → DATA/ 복사. (n_train, n_val) 반환."""
    random.shuffle(pairs)
    split = max(1, int(len(pairs) * 0.8))
    train_pairs = pairs[:split]
    val_pairs   = pairs[split:]

    dirs = {
        'train_img': DATA_DIR / 'images' / 'train',
        'val_img':   DATA_DIR / 'images' / 'val',
        'train_lbl': DATA_DIR / 'labels' / 'train',
        'val_lbl':   DATA_DIR / 'labels' / 'val',
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    for img, lbl in train_pairs:
        dest_img = _unique_copy(img, dirs['train_img'])
        if lbl:
            dest_lbl = dirs['train_lbl'] / (dest_img.stem + '.txt')
            shutil.copy2(lbl, dest_lbl)

    for img, lbl in val_pairs:
        dest_img = _unique_copy(img, dirs['val_img'])
        if lbl:
            dest_lbl = dirs['val_lbl'] / (dest_img.stem + '.txt')
            shutil.copy2(lbl, dest_lbl)

    return len(train_pairs), len(val_pairs)


# ── 정리 ──────────────────────────────────────────────────────────────────────

def cleanup_data():
    """DATA/images/train+val, DATA/labels/train+val 의 파일만 삭제."""
    for subdir in ['images', 'labels']:
        for split in ['train', 'val']:
            d = DATA_DIR / subdir / split
            if d.exists():
                for f in d.iterdir():
                    if f.is_file():
                        f.unlink()
    print("DATA/ 임시 파일 정리 완료")


# ── 메인 ──────────────────────────────────────────────────────────────────────

MIN_SAMPLES = 10


def main():
    name = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    pairs = collect_pairs()
    if not pairs:
        print("오류: BASE_data/ 에 학습할 데이터가 없습니다.")
        print("어노테이션 툴에서 '학습용 저장' 버튼을 먼저 눌러주세요.")
        return

    if len(pairs) < MIN_SAMPLES:
        print("=" * 50)
        print(f"학습 취소: 데이터가 {len(pairs)}개뿐입니다.")
        print(f"최소 {MIN_SAMPLES}개 이상의 어노테이션된 이미지가 필요합니다.")
        print("DATA/ 폴더는 변경되지 않았습니다.")
        print("=" * 50)
        return

    print("=" * 50)
    print("YOLOv12 학습 시작")
    print(f"  수집된 데이터 : {len(pairs)}개")

    n_train, n_val = prepare_data(pairs)
    print(f"  학습 / 검증   : {n_train} / {n_val}")
    print(f"  모델          : {MODEL}")
    print(f"  에폭          : {EPOCHS}")
    print(f"  이미지 크기   : {IMG_SIZE}x{IMG_SIZE}")
    print(f"  배치          : {BATCH_SIZE}")
    print("=" * 50)

    try:
        model = YOLO(MODEL)
        model.train(
            data=DATA_YAML,
            epochs=EPOCHS,
            imgsz=IMG_SIZE,
            batch=BATCH_SIZE,
            device=DEVICE,
            patience=PATIENCE,
            project=str(BASE_DIR / PROJECT),
            name=name,
            plots=True,
            save=True,
            verbose=True,
        )
        print("\n" + "=" * 50)
        print("학습 완료!")
        print(f"최적 모델: {BASE_DIR / PROJECT / name}/weights/best.pt")
        print("=" * 50)
    finally:
        cleanup_data()


if __name__ == "__main__":
    main()
