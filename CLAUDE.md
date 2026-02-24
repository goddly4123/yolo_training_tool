# YOLOv12 어노테이션 & 학습 프로젝트

## 도구 및 환경

| 항목 | 값 |
|---|---|
| 언어 | Python 3.11.13 |
| 패키지 관리 | uv |
| 가상환경 | `.venv/` |
| 주요 패키지 | ultralytics, flask, torch, torchvision, opencv-python |

## 전체 데이터 흐름

```
[1] to_annotate/images/        ← 라벨링할 이미지를 여기에 넣기
         ↓  어노테이션 툴에서 바운딩 박스 작업
[2] to_annotate/labels/        ← 라벨 파일 자동 저장 (.txt)
         ↓  툴 사이드바 하단 "Save for Training" 클릭
[3] BASE_data/YYYY-MM-DD_HH-MM-SS/   ← 날짜별 영구 보관 폴더
         ↓  uv run train.py  (또는 툴 UI에서 Training 버튼)
[4] DATA/images/train+val      ← 학습 중 임시 사용 (8:2 자동 분할)
    DATA/labels/train+val
         ↓  학습 완료
[5] runs/YYYY-MM-DD_HH-MM-SS/weights/best.pt  ← 학습된 모델
         ↓  DATA/ 자동 정리 (빈 상태로 복원)
```

## 폴더 구조

```
프로젝트 루트/
├── to_annotate/
│   ├── images/        # 라벨링 작업 이미지 (원본 이미지 여기에 넣기)
│   ├── labels/        # 어노테이션 툴이 자동 저장하는 라벨 파일
│   └── .trash/        # 삭제한 이미지 임시 보관 (최대 10개, 복원 가능)
│       ├── images/
│       └── labels/
├── BASE_data/
│   └── YYYY-MM-DD_HH-MM-SS/   # "Save for Training" 클릭할 때마다 생성
│       ├── images/
│       └── labels/
├── DATA/              # 학습 중에만 임시 사용 (평소엔 비어있음)
│   ├── images/
│   │   ├── train/
│   │   └── val/
│   └── labels/
│       ├── train/
│       └── val/
├── runs/              # 학습 결과 저장
│   └── YYYY-MM-DD_HH-MM-SS/
│       └── weights/
│           ├── best.pt   # 최고 성능 모델
│           └── last.pt   # 마지막 에폭 모델
├── annotation/        # 라벨링 도구 (Flask + React)
│   ├── app.py         # Flask 백엔드 (port 5001)
│   ├── clipboard.json # 박스 복사/붙여넣기 영구 보관
│   └── frontend/      # React 프론트엔드 (port 3000)
│       ├── package.json
│       ├── vite.config.js
│       └── src/
│           ├── App.jsx                      # 메인 앱, 상태 관리, 키보드 단축키
│           ├── App.css
│           └── components/
│               ├── AnnotationCanvas.jsx     # 캔버스 드로잉, 박스 선택/편집
│               └── ThumbnailStrip.jsx       # 상단 이미지 썸네일 목록
├── train.py           # 학습 스크립트 (CLI 직접 실행용)
├── dataset.yaml       # 클래스 정의 및 DATA/ 경로 설정
├── pyproject.toml     # uv 의존성 정의
├── start.sh           # 어노테이션 툴 실행 스크립트
└── yolo12n.pt         # 기본 사전학습 모델 (5.3MB)
```

## 라벨 파일 포맷 (YOLO 포맷)

```
<class_id> <x_center> <y_center> <width> <height>
# 모든 값은 0~1 사이 정규화된 값
# 예: 0 0.5 0.5 0.3 0.4
```

## 작업 순서

```bash
# 1. to_annotate/images/ 에 이미지 넣기

# 2. 어노테이션 툴 실행
bash start.sh
# → 브라우저: http://localhost:3000

# 3. 툴에서 라벨 작업 → 사이드바 "Save for Training" 클릭
#    어노테이션된 이미지+라벨이 BASE_data/<날짜>/ 로 이동됨

# 4. (선택) train.py 상단 설정값 조정 후 CLI에서 학습
uv run train.py

# 또는 툴 UI에서 Training 버튼 → 설정 후 Start 클릭

# 5. 결과 모델 확인
# runs/<날짜시간>/weights/best.pt
```

## train.py 설정값 (환경변수로 오버라이드 가능)

| 변수 | 환경변수 | 기본값 | 설명 |
|---|---|---|---|
| `MODEL` | `TRAIN_MODEL` | `yolo12n.pt` | 기본 모델 (n/s/m/l/x) |
| `EPOCHS` | `TRAIN_EPOCHS` | `100` | 전체 데이터 반복 횟수 |
| `PATIENCE` | `TRAIN_PATIENCE` | `20` | 조기 종료 대기 에폭 (0=비활성) |
| `IMG_SIZE` | `TRAIN_IMG_SIZE` | `640` | 학습 이미지 크기 (픽셀) |
| `BATCH_SIZE` | `TRAIN_BATCH` | `16` | 배치 크기 |
| `DEVICE` | `TRAIN_DEVICE` | `""` (자동) | `""` 자동 / `"0"` GPU / `"cpu"` |

```bash
# 예: 환경변수로 설정 오버라이드
TRAIN_EPOCHS=50 TRAIN_BATCH=8 uv run train.py
```

## dataset.yaml

```yaml
path: ./DATA          # 데이터 루트 경로
train: images/train   # 학습 이미지
val: images/val       # 검증 이미지
nc: 1                 # 클래스 수 (툴에서 자동 업데이트됨)
names:
  0: AI               # 클래스 이름 (툴에서 편집 가능)
```

## YOLOv12 모델 종류

| 모델 | 특징 |
|---|---|
| `yolo12n.pt` | Nano - 가장 빠름, 데이터 적을 때 추천 |
| `yolo12s.pt` | Small - 빠른 속도, 보통 정확도 |
| `yolo12m.pt` | Medium - 속도·정확도 균형 (GPU 4GB+) |
| `yolo12l.pt` | Large - 높은 정확도 (GPU 8GB+) |
| `yolo12x.pt` | Extra - 최고 정확도, 최상위 사양 전용 |

---

## Annotation Tool

Flask(port 5001) + React(port 3000) 기반 라벨링 도구

### 실행

```bash
bash start.sh
# 로컬:    http://localhost:3000
# 네트워크: http://<IP>:3000
```

### 키보드 단축키

| 키 | 기능 |
|---|---|
| `←` `→` | 이전/다음 이미지 |
| `‹` `›` (사이드 버튼) | 미어노테이션 이미지로 건너뛰기 |
| `↓` `↑` | 선택된 박스의 클래스 +1/-1 (미선택 시 현재 클래스 변경) |
| `0`~`9` | 현재 클래스 직접 선택 |
| `드래그` | 바운딩 박스 그리기 |
| `클릭` | 박스 선택 |
| `Space` | 현재 이미지 라벨 저장 |
| `P` | 선택된 모델로 현재 이미지 자동 예측 |
| `Del` / `Backspace` | 선택 박스 삭제 (미선택 시 전체 삭제 확인) |
| `Shift+Del` | 현재 이미지 파일 삭제 (.trash 로 이동) |
| `Ctrl+Shift+Del` | 마지막 삭제 이미지 복원 |
| `Ctrl+Z` | 박스 편집 되돌리기 (최대 20단계) |
| `Ctrl+Shift+Z` | 박스 편집 다시 실행 |
| `Ctrl+C` | 선택된 박스 복사 (세션 간 유지) |
| `Ctrl+V` | 복사한 박스 붙여넣기 |

### 사이드바 기능

- **Classes**: 클래스 추가/삭제/이름 편집/색상 변경
- **Set Model**: 예측에 사용할 학습된 모델 선택 (Conf/IoU 임계값 설정)
- **Training**: 모델 학습 설정 및 실행 (로그 실시간 출력)
- **Zoom**: 캔버스 확대/축소 (마우스 스크롤로도 가능)
- **Save for Training**: 어노테이션 완료된 이미지를 BASE_data/ 로 이동

### Flask API

```
# 이미지 관리
GET    /api/images                  이미지 파일 목록
GET    /api/images/<file>           이미지 서빙
DELETE /api/images/<file>           이미지 .trash 이동
POST   /api/undo-delete             마지막 삭제 복원

# 라벨 관리
GET    /api/labels/<file>           라벨 조회
POST   /api/labels/<file>           라벨 저장 (자동저장)
DELETE /api/labels/<file>           라벨 삭제
GET    /api/annotations-status      전체 이미지 어노테이션 여부 목록

# 클래스 & 데이터셋
GET    /api/classes                 클래스 목록 (dataset.yaml 연동)
POST   /api/classes                 클래스 저장 → dataset.yaml 업데이트

# 클립보드 (박스 복사/붙여넣기)
GET    /api/clipboard               저장된 클립보드 조회
POST   /api/clipboard               클립보드 저장

# 학습용 저장
POST   /api/save-for-training       어노테이션 이미지 → BASE_data/<날짜>/ 이동

# 학습 결과 모델
GET    /api/runs                    runs/ 폴더 목록 (best.pt/last.pt 존재 여부)
DELETE /api/runs/<name>             학습 폴더 삭제
GET    /api/download-weight?path=   모델 파일(.pt) 다운로드

# 예측
POST   /api/predict                 현재 이미지에 모델 예측 실행

# 학습 실행 (UI에서 비동기)
POST   /api/train/start             학습 시작 (train.py를 서브프로세스로 실행)
GET    /api/train/log?offset=N      학습 로그 폴링 (offset 이후 새 줄 반환)
POST   /api/train/stop              학습 중단
```
